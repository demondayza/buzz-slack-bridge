import { setTimeout as delay } from "node:timers/promises";
import { type Event as NostrEvent, verifyEvent } from "nostr-tools";
import WebSocket, { type RawData } from "ws";
import { logger } from "./logger.js";
import { BUZZ_KIND, signBuzzEvent } from "./nostr-event.js";

interface PendingPublish {
  reject: (error: Error) => void;
  resolve: () => void;
  timeout: NodeJS.Timeout;
}

export class BuzzClient {
  readonly #channelIds: string[];
  readonly #privateKey: Uint8Array;
  readonly #relayUrl: string;
  #authenticated = false;
  #authEventId?: string;
  #eventChain = Promise.resolve();
  #handler: (event: NostrEvent) => Promise<void> = async () => {};
  #lastSeen: number;
  #pendingPublishes = new Map<string, PendingPublish>();
  #readyWaiters = new Set<() => void>();
  #socket?: WebSocket;

  constructor(
    relayUrl: string,
    privateKey: Uint8Array,
    channelIds: string[],
    initialSince: number,
  ) {
    this.#relayUrl = relayUrl;
    this.#privateKey = privateKey;
    this.#channelIds = channelIds;
    this.#lastSeen = initialSince;
  }

  get connected(): boolean {
    return this.#authenticated && this.#socket?.readyState === WebSocket.OPEN;
  }

  async publish(event: NostrEvent): Promise<void> {
    await this.#waitUntilReady();
    const socket = this.#socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("Buzz relay disconnected before publish");
    }

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pendingPublishes.delete(event.id);
        reject(new Error(`Timed out waiting for Buzz relay acknowledgement for ${event.id}`));
      }, 15_000);
      this.#pendingPublishes.set(event.id, { reject, resolve, timeout });
      socket.send(JSON.stringify(["EVENT", event]));
    });
  }

  async run(handler: (event: NostrEvent) => Promise<void>, signal: AbortSignal): Promise<void> {
    this.#handler = handler;
    let backoffMs = 1_000;
    while (!signal.aborted) {
      try {
        await this.#runSession(signal);
        backoffMs = 1_000;
      } catch (error) {
        if (signal.aborted) break;
        logger.error("Buzz relay session failed", { error: errorMessage(error) });
      }
      if (!signal.aborted) {
        await delay(backoffMs, undefined, { signal }).catch(() => undefined);
        backoffMs = Math.min(backoffMs * 2, 30_000);
      }
    }
  }

  async #runSession(signal: AbortSignal): Promise<void> {
    this.#authenticated = false;
    const socket = new WebSocket(this.#relayUrl);
    this.#socket = socket;

    return new Promise<void>((resolve, reject) => {
      const onAbort = () => socket.close(1000, "bridge stopping");
      signal.addEventListener("abort", onAbort, { once: true });

      socket.on("open", () => logger.info("Connected to Buzz relay"));
      socket.on("message", (data) => this.#onMessage(data));
      socket.on("error", (error) => {
        socket.close(1011, "websocket error");
        reject(error);
      });
      socket.on("close", (code, reason) => {
        signal.removeEventListener("abort", onAbort);
        this.#authenticated = false;
        this.#rejectPendingPublishes(new Error(`Buzz relay disconnected (${code} ${reason})`));
        if (this.#socket === socket) this.#socket = undefined;
        resolve();
      });
    });
  }

  #onMessage(data: RawData): void {
    let frame: unknown;
    try {
      frame = JSON.parse(data.toString());
    } catch {
      logger.warn("Ignored non-JSON Buzz relay frame");
      return;
    }
    if (!Array.isArray(frame) || typeof frame[0] !== "string") return;

    switch (frame[0]) {
      case "AUTH":
        this.#handleAuthChallenge(frame[1]);
        break;
      case "OK":
        this.#handleAcknowledgement(frame);
        break;
      case "EVENT":
        this.#queueEvent(frame[2]);
        break;
      case "NOTICE":
        logger.warn("Buzz relay notice", { notice: String(frame[1] ?? "") });
        break;
    }
  }

  #handleAuthChallenge(challenge: unknown): void {
    if (typeof challenge !== "string" || !this.#socket) return;
    const authEvent = signBuzzEvent(this.#privateKey, 22_242, "", [
      ["relay", this.#relayUrl],
      ["challenge", challenge],
    ]);
    this.#authEventId = authEvent.id;
    this.#socket.send(JSON.stringify(["AUTH", authEvent]));
  }

  #handleAcknowledgement(frame: unknown[]): void {
    const eventId = frame[1];
    const accepted = frame[2];
    const message = String(frame[3] ?? "");
    if (typeof eventId !== "string" || typeof accepted !== "boolean") return;

    if (eventId === this.#authEventId) {
      if (!accepted) {
        this.#socket?.close(4003, "authentication rejected");
        logger.error("Buzz relay rejected authentication", { message });
        return;
      }
      this.#authenticated = true;
      this.#subscribe();
      for (const ready of this.#readyWaiters) ready();
      this.#readyWaiters.clear();
      logger.info("Authenticated to Buzz relay");
      return;
    }

    const pending = this.#pendingPublishes.get(eventId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.#pendingPublishes.delete(eventId);
    if (accepted || message.toLowerCase().includes("duplicate")) {
      pending.resolve();
    } else {
      pending.reject(new Error(`Buzz relay rejected ${eventId}: ${message}`));
    }
  }

  #subscribe(): void {
    this.#socket?.send(
      JSON.stringify([
        "REQ",
        "buzz-slack-bridge",
        {
          kinds: [BUZZ_KIND.deletion, BUZZ_KIND.message, BUZZ_KIND.reaction],
          "#h": this.#channelIds,
          since: Math.max(0, this.#lastSeen - 2),
        },
        { kinds: [BUZZ_KIND.profile], limit: 1_000 },
      ]),
    );
  }

  #queueEvent(value: unknown): void {
    if (!isNostrEvent(value) || !verifyEvent(value)) {
      logger.warn("Ignored invalid Buzz event");
      return;
    }
    this.#eventChain = this.#eventChain
      .then(async () => {
        await this.#handler(value);
        this.#lastSeen = Math.max(this.#lastSeen, value.created_at);
      })
      .catch((error) => {
        logger.error("Failed to bridge Buzz event; reconnecting for replay", {
          error: errorMessage(error),
          eventId: value.id,
        });
        this.#socket?.close(4000, "event handler failure");
      });
  }

  async #waitUntilReady(): Promise<void> {
    if (this.connected) return;
    await new Promise<void>((resolve) => this.#readyWaiters.add(resolve));
  }

  #rejectPendingPublishes(error: Error): void {
    for (const pending of this.#pendingPublishes.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pendingPublishes.clear();
  }
}

function isNostrEvent(value: unknown): value is NostrEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<NostrEvent>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.pubkey === "string" &&
    typeof candidate.kind === "number" &&
    typeof candidate.created_at === "number" &&
    typeof candidate.content === "string" &&
    Array.isArray(candidate.tags) &&
    typeof candidate.sig === "string"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
