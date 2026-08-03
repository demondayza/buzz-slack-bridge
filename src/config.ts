import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { BridgeConfig } from "./types.js";

const channelId = z.string().uuid("Buzz channel IDs must be UUIDs");
const matrixRoomId = z.string().regex(/^![^:]+:.+$/, "Matrix room IDs must look like !id:server");
const privateKey = z.string().regex(/^[0-9a-f]{64}$/i, "BUZZ_PRIVATE_KEY must be 64 hex chars");

const fileSchema = z.strictObject({
  buzz: z.strictObject({
    profileName: z.string().trim().min(1).max(100).default("Slack Bridge"),
    relayUrl: z.url().refine((url) => url.startsWith("ws://") || url.startsWith("wss://"), {
      message: "Buzz relay URL must use ws:// or wss://",
    }),
  }),
  channels: z
    .array(
      z.strictObject({
        buzzChannelId: channelId,
        label: z.string().trim().min(1).max(100),
        matrixRoomId,
      }),
    )
    .min(1),
  databasePath: z.string().trim().min(1).default("./data/bridge.db"),
  health: z
    .strictObject({
      host: z.string().trim().min(1).default("0.0.0.0"),
      port: z.number().int().min(1).max(65535).default(8787),
    })
    .default({ host: "0.0.0.0", port: 8787 }),
  matrix: z.strictObject({
    homeserverUrl: z.url(),
    userId: z.string().regex(/^@[^:]+:.+$/, "Matrix user IDs must look like @user:server"),
  }),
});

function assertUniqueMappings(channels: BridgeConfig["channels"]): void {
  const rooms = new Set<string>();
  const buzzChannels = new Set<string>();
  for (const channel of channels) {
    if (rooms.has(channel.matrixRoomId)) {
      throw new Error(`Matrix room ${channel.matrixRoomId} is mapped more than once`);
    }
    if (buzzChannels.has(channel.buzzChannelId)) {
      throw new Error(`Buzz channel ${channel.buzzChannelId} is mapped more than once`);
    }
    rooms.add(channel.matrixRoomId);
    buzzChannels.add(channel.buzzChannelId);
  }
}

export async function loadConfig(
  filePath = process.env.BRIDGE_CONFIG ?? "./config.json",
  env = process.env,
): Promise<BridgeConfig> {
  const file = fileSchema.parse(JSON.parse(await readFile(resolve(filePath), "utf8")));
  const accessToken = z
    .string()
    .min(1, "MATRIX_ACCESS_TOKEN is required")
    .parse(env.MATRIX_ACCESS_TOKEN);
  const buzzPrivateKey = privateKey.parse(env.BUZZ_PRIVATE_KEY);

  const config: BridgeConfig = {
    ...file,
    buzz: { ...file.buzz, privateKey: buzzPrivateKey },
    matrix: { ...file.matrix, accessToken },
  };
  assertUniqueMappings(config.channels);
  return config;
}
