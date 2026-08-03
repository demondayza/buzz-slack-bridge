import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import type { Event as NostrEvent } from "nostr-tools";

export interface EventMapping {
  buzzEventId: string;
  buzzKind: number;
  direction: "buzz" | "matrix";
  matrixEventId: string;
  roomId: string;
}

export class BridgeStore {
  readonly #database: Database.Database;

  constructor(filePath: string) {
    const absolutePath = resolve(filePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    this.#database = new Database(absolutePath);
    this.#database.pragma("journal_mode = WAL");
    this.#database.pragma("foreign_keys = ON");
    this.#migrate();
  }

  close(): void {
    this.#database.close();
  }

  getBuzzEventForMatrix(matrixEventId: string): EventMapping | undefined {
    const row = this.#database
      .prepare(
        `SELECT matrix_event_id, buzz_event_id, buzz_kind, direction, room_id
         FROM event_mappings WHERE matrix_event_id = ?`,
      )
      .get(matrixEventId) as StoredMapping | undefined;
    return row ? toMapping(row) : undefined;
  }

  getMatrixEventForBuzz(buzzEventId: string): EventMapping | undefined {
    const row = this.#database
      .prepare(
        `SELECT matrix_event_id, buzz_event_id, buzz_kind, direction, room_id
         FROM event_mappings WHERE buzz_event_id = ?`,
      )
      .get(buzzEventId) as StoredMapping | undefined;
    return row ? toMapping(row) : undefined;
  }

  getMetadata(key: string): string | undefined {
    const row = this.#database.prepare("SELECT value FROM metadata WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  getOutboxEvent(matrixEventId: string): NostrEvent | undefined {
    const row = this.#database
      .prepare("SELECT event_json FROM matrix_to_buzz_outbox WHERE matrix_event_id = ?")
      .get(matrixEventId) as { event_json: string } | undefined;
    return row ? (JSON.parse(row.event_json) as NostrEvent) : undefined;
  }

  saveBuzzToMatrix(mapping: EventMapping): void {
    this.#insertMapping(mapping);
  }

  saveMatrixOutbox(matrixEventId: string, roomId: string, event: NostrEvent): void {
    this.#database
      .prepare(
        `INSERT INTO matrix_to_buzz_outbox(matrix_event_id, room_id, event_json)
         VALUES (?, ?, ?)
         ON CONFLICT(matrix_event_id) DO NOTHING`,
      )
      .run(matrixEventId, roomId, JSON.stringify(event));
  }

  completeMatrixToBuzz(mapping: EventMapping): void {
    const complete = this.#database.transaction(() => {
      this.#insertMapping(mapping);
      this.#database
        .prepare("DELETE FROM matrix_to_buzz_outbox WHERE matrix_event_id = ?")
        .run(mapping.matrixEventId);
    });
    complete();
  }

  setMetadata(key: string, value: string): void {
    this.#database
      .prepare(
        `INSERT INTO metadata(key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  #insertMapping(mapping: EventMapping): void {
    this.#database
      .prepare(
        `INSERT INTO event_mappings(matrix_event_id, buzz_event_id, buzz_kind, direction, room_id)
         VALUES (@matrixEventId, @buzzEventId, @buzzKind, @direction, @roomId)
         ON CONFLICT DO NOTHING`,
      )
      .run(mapping);
  }

  #migrate(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS event_mappings (
        matrix_event_id TEXT PRIMARY KEY,
        buzz_event_id TEXT NOT NULL UNIQUE,
        buzz_kind INTEGER NOT NULL,
        direction TEXT NOT NULL CHECK(direction IN ('buzz', 'matrix')),
        room_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS matrix_to_buzz_outbox (
        matrix_event_id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        event_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }
}

interface StoredMapping {
  buzz_event_id: string;
  buzz_kind: number;
  direction: "buzz" | "matrix";
  matrix_event_id: string;
  room_id: string;
}

function toMapping(row: StoredMapping): EventMapping {
  return {
    buzzEventId: row.buzz_event_id,
    buzzKind: row.buzz_kind,
    direction: row.direction,
    matrixEventId: row.matrix_event_id,
    roomId: row.room_id,
  };
}
