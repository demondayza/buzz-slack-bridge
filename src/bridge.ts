import type { Event as NostrEvent } from "nostr-tools";
import { BuzzClient } from "./buzz-client.js";
import { buzzToMatrix, matrixToBuzz } from "./conversion.js";
import { logger } from "./logger.js";
import { MatrixClient } from "./matrix-client.js";
import {
  BUZZ_KIND,
  firstTagValue,
  privateKeyBytes,
  publicKeyFor,
  signBuzzEvent,
} from "./nostr-event.js";
import { BridgeStore } from "./store.js";
import type { BridgeConfig, ChannelMapping, MatrixEvent } from "./types.js";

export class Bridge {
  readonly #buzz: BuzzClient;
  readonly #buzzPublicKey: string;
  readonly #config: BridgeConfig;
  readonly #matrix: MatrixClient;
  readonly #privateKey: Uint8Array;
  readonly #profiles = new Map<string, string>();
  readonly #roomMappings: Map<string, ChannelMapping>;
  readonly #channelMappings: Map<string, ChannelMapping>;
  readonly #store: BridgeStore;
  #matrixReady = false;

  constructor(config: BridgeConfig) {
    this.#config = config;
    this.#privateKey = privateKeyBytes(config.buzz.privateKey);
    this.#buzzPublicKey = publicKeyFor(this.#privateKey);
    this.#store = new BridgeStore(config.databasePath);
    const storedBuzzSince = Number(this.#store.getMetadata("buzz_since"));
    const initialBuzzSince =
      Number.isFinite(storedBuzzSince) && storedBuzzSince > 0
        ? storedBuzzSince
        : Math.floor(Date.now() / 1000) - 5;
    this.#buzz = new BuzzClient(
      config.buzz.relayUrl,
      this.#privateKey,
      config.channels.map((mapping) => mapping.buzzChannelId),
      initialBuzzSince,
    );
    this.#matrix = new MatrixClient(
      config.matrix.homeserverUrl,
      config.matrix.accessToken,
      config.matrix.userId,
    );
    this.#roomMappings = new Map(config.channels.map((mapping) => [mapping.matrixRoomId, mapping]));
    this.#channelMappings = new Map(
      config.channels.map((mapping) => [mapping.buzzChannelId, mapping]),
    );
  }

  get healthy(): boolean {
    return this.#buzz.connected && this.#matrixReady;
  }

  async run(signal: AbortSignal): Promise<void> {
    await this.#matrix.assertAuthenticated();
    this.#matrixReady = true;
    logger.info("Authenticated to Matrix homeserver", { userId: this.#config.matrix.userId });

    const buzzTask = this.#buzz.run(async (event) => {
      await this.#handleBuzzEvent(event);
      const previous = Number(this.#store.getMetadata("buzz_since")) || 0;
      this.#store.setMetadata("buzz_since", String(Math.max(previous, event.created_at)));
    }, signal);
    const matrixTask = this.#runMatrixLoop(signal);
    const profileTask = this.#publishBridgeProfile();
    try {
      await Promise.all([buzzTask, matrixTask, profileTask]);
    } finally {
      this.#store.close();
    }
  }

  async #publishBridgeProfile(): Promise<void> {
    const event = signBuzzEvent(
      this.#privateKey,
      BUZZ_KIND.profile,
      JSON.stringify({
        about: "Messages relayed from Slack through mautrix-slack",
        display_name: this.#config.buzz.profileName,
        name: this.#config.buzz.profileName,
      }),
      [["client", "buzz-slack-bridge"]],
    );
    await this.#buzz.publish(event);
  }

  async #runMatrixLoop(signal: AbortSignal): Promise<void> {
    let since = this.#store.getMetadata("matrix_since");
    let coldStart = !since;
    while (!signal.aborted) {
      const result = await this.#matrix.sync(since, signal);
      if (!result) break;
      if (!coldStart) {
        for (const batch of result.batches) {
          const mapping = this.#roomMappings.get(batch.roomId);
          if (!mapping) continue;
          for (const event of batch.events) {
            await this.#handleMatrixEvent(event, mapping);
          }
        }
      } else {
        logger.info("Established Matrix sync position without importing history");
        coldStart = false;
      }
      since = result.nextBatch;
      this.#store.setMetadata("matrix_since", since);
    }
  }

  async #handleMatrixEvent(event: MatrixEvent, mapping: ChannelMapping): Promise<void> {
    if (event.sender === this.#config.matrix.userId) return;
    if (this.#store.getBuzzEventForMatrix(event.event_id)) return;

    let buzzEvent = this.#store.getOutboxEvent(event.event_id);
    if (!buzzEvent) {
      const sender = await this.#matrix.displayName(event.sender);
      const converted = matrixToBuzz(event, mapping.buzzChannelId, sender, (eventId) =>
        this.#store.getBuzzEventForMatrix(eventId),
      );
      if (!converted) return;
      buzzEvent = signBuzzEvent(
        this.#privateKey,
        converted.kind,
        converted.content,
        converted.tags,
      );
      this.#store.saveMatrixOutbox(event.event_id, mapping.matrixRoomId, buzzEvent);
    }

    await this.#buzz.publish(buzzEvent);
    this.#store.completeMatrixToBuzz({
      buzzEventId: buzzEvent.id,
      buzzKind: buzzEvent.kind,
      direction: "matrix",
      matrixEventId: event.event_id,
      roomId: mapping.matrixRoomId,
    });
    logger.info("Bridged Matrix event to Buzz", {
      buzzEventId: buzzEvent.id,
      matrixEventId: event.event_id,
      room: mapping.label,
    });
  }

  async #handleBuzzEvent(event: NostrEvent): Promise<void> {
    if (event.kind === BUZZ_KIND.profile) {
      this.#cacheProfile(event);
      return;
    }
    if (event.pubkey === this.#buzzPublicKey) return;
    if (this.#store.getMatrixEventForBuzz(event.id)) return;

    const channelId = firstTagValue(event, "h");
    const targetEventId = firstTagValue(event, "e");
    const targetMapping = targetEventId
      ? this.#store.getMatrixEventForBuzz(targetEventId)
      : undefined;
    const mapping = channelId
      ? this.#channelMappings.get(channelId)
      : targetMapping
        ? this.#roomMappings.get(targetMapping.roomId)
        : undefined;
    if (!mapping) return;

    const converted = buzzToMatrix(event, this.#displayNameFor(event.pubkey), (eventId) =>
      this.#store.getMatrixEventForBuzz(eventId),
    );
    if (!converted) return;

    const transactionId = `buzz_${event.id}`;
    const matrixEventId = converted.redacts
      ? await this.#matrix.redact(mapping.matrixRoomId, converted.redacts, transactionId)
      : await this.#matrix.sendEvent(
          mapping.matrixRoomId,
          converted.eventType,
          converted.content,
          transactionId,
        );
    this.#store.saveBuzzToMatrix({
      buzzEventId: event.id,
      buzzKind: event.kind,
      direction: "buzz",
      matrixEventId,
      roomId: mapping.matrixRoomId,
    });
    logger.info("Bridged Buzz event to Matrix", {
      buzzEventId: event.id,
      matrixEventId,
      room: mapping.label,
    });
  }

  #cacheProfile(event: NostrEvent): void {
    try {
      const profile = JSON.parse(event.content) as { display_name?: unknown; name?: unknown };
      const name = [profile.display_name, profile.name].find(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      );
      if (name) this.#profiles.set(event.pubkey, name.trim().slice(0, 100));
    } catch {
      logger.debug("Ignored malformed Buzz profile", { pubkey: event.pubkey });
    }
  }

  #displayNameFor(pubkey: string): string {
    return this.#profiles.get(pubkey) ?? `${pubkey.slice(0, 8)}…`;
  }
}
