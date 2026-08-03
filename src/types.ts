import type { Event as NostrEvent } from "nostr-tools";

export interface ChannelMapping {
  buzzChannelId: string;
  label: string;
  matrixRoomId: string;
}

export interface BridgeConfig {
  buzz: {
    privateKey: string;
    profileName: string;
    relayUrl: string;
  };
  channels: ChannelMapping[];
  databasePath: string;
  health: {
    host: string;
    port: number;
  };
  matrix: {
    accessToken: string;
    homeserverUrl: string;
    userId: string;
  };
}

export interface MatrixEvent {
  content: Record<string, unknown>;
  event_id: string;
  origin_server_ts: number;
  redacts?: string;
  room_id?: string;
  sender: string;
  type: string;
}

export interface MatrixTimelineBatch {
  events: MatrixEvent[];
  roomId: string;
}

export interface MatrixSyncResult {
  batches: MatrixTimelineBatch[];
  nextBatch: string;
}

export type BridgeEventHandler = (event: NostrEvent) => Promise<void>;
