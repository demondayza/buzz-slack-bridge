import { setTimeout as delay } from "node:timers/promises";
import { logger } from "./logger.js";
import type { MatrixEvent, MatrixSyncResult } from "./types.js";

interface MatrixSyncResponse {
  next_batch: string;
  rooms?: {
    join?: Record<string, { timeline?: { events?: MatrixEvent[] } }>;
  };
}

export class MatrixClient {
  readonly #accessToken: string;
  readonly #baseUrl: string;
  readonly #displayNames = new Map<string, string>();
  readonly userId: string;

  constructor(baseUrl: string, accessToken: string, userId: string) {
    this.#baseUrl = baseUrl.replace(/\/$/, "");
    this.#accessToken = accessToken;
    this.userId = userId;
  }

  async assertAuthenticated(): Promise<void> {
    const response = await this.#request<{ user_id: string }>(
      "GET",
      "/_matrix/client/v3/account/whoami",
    );
    if (response.user_id !== this.userId) {
      throw new Error(
        `Matrix token belongs to ${response.user_id}, but config expects ${this.userId}`,
      );
    }
  }

  async displayName(userId: string): Promise<string> {
    const cached = this.#displayNames.get(userId);
    if (cached) return cached;
    try {
      const profile = await this.#request<{ displayname?: string }>(
        "GET",
        `/_matrix/client/v3/profile/${encodeURIComponent(userId)}/displayname`,
      );
      const name = profile.displayname?.trim() || localpart(userId);
      this.#displayNames.set(userId, name);
      return name;
    } catch (error) {
      logger.warn("Could not resolve Matrix display name", {
        error: errorMessage(error),
        userId,
      });
      return localpart(userId);
    }
  }

  async redact(roomId: string, eventId: string, transactionId: string): Promise<string> {
    const response = await this.#request<{ event_id: string }>(
      "PUT",
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/redact/${encodeURIComponent(eventId)}/${transactionId}`,
      { reason: "Deleted in bridged network" },
    );
    return response.event_id;
  }

  async sendEvent(
    roomId: string,
    eventType: string,
    content: Record<string, unknown>,
    transactionId: string,
  ): Promise<string> {
    const response = await this.#request<{ event_id: string }>(
      "PUT",
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/${encodeURIComponent(eventType)}/${transactionId}`,
      content,
    );
    return response.event_id;
  }

  async sync(
    since: string | undefined,
    signal: AbortSignal,
  ): Promise<MatrixSyncResult | undefined> {
    const filter = JSON.stringify({
      room: {
        ephemeral: { types: [] },
        state: { lazy_load_members: true, types: [] },
        timeline: {
          limit: 100,
          types: ["m.room.message", "m.reaction", "m.room.redaction"],
        },
      },
    });
    const query = new URLSearchParams({
      filter,
      set_presence: "offline",
      timeout: "30000",
    });
    if (since) query.set("since", since);

    let backoffMs = 1_000;
    while (!signal.aborted) {
      try {
        const response = await this.#request<MatrixSyncResponse>(
          "GET",
          `/_matrix/client/v3/sync?${query}`,
          undefined,
          signal,
        );
        return {
          batches: Object.entries(response.rooms?.join ?? {}).map(([roomId, room]) => ({
            events: room.timeline?.events ?? [],
            roomId,
          })),
          nextBatch: response.next_batch,
        };
      } catch (error) {
        if (signal.aborted) return undefined;
        logger.error("Matrix sync failed", { error: errorMessage(error) });
        await delay(backoffMs, undefined, { signal }).catch(() => undefined);
        backoffMs = Math.min(backoffMs * 2, 30_000);
      }
    }
    return undefined;
  }

  async #request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await fetch(`${this.#baseUrl}${path}`, {
      body: body ? JSON.stringify(body) : undefined,
      headers: {
        Authorization: `Bearer ${this.#accessToken}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      method,
      signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `Matrix ${method} ${path} failed (${response.status}): ${text.slice(0, 500)}`,
      );
    }
    return JSON.parse(text) as T;
  }
}

function localpart(userId: string): string {
  return userId.replace(/^@/, "").split(":", 1)[0] ?? userId;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
