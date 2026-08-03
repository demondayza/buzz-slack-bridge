import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { loadConfig } from "../src/config.js";

const validFile = {
  buzz: { relayUrl: "wss://buzz.example.com" },
  channels: [
    {
      buzzChannelId: "167b27a6-12aa-4f25-a86a-7f306de1c11e",
      label: "general",
      matrixRoomId: "!general:matrix.example.com",
    },
  ],
  matrix: {
    homeserverUrl: "https://matrix.example.com",
    userId: "@buzzbridge:matrix.example.com",
  },
};

describe("loadConfig", () => {
  it("loads secrets from environment instead of the config file", async () => {
    const path = await configFile(validFile);
    const config = await loadConfig(path, {
      BUZZ_PRIVATE_KEY: "11".repeat(32),
      MATRIX_ACCESS_TOKEN: "secret-token",
    });
    assert.equal(config.buzz.privateKey, "11".repeat(32));
    assert.equal(config.matrix.accessToken, "secret-token");
    assert.equal(config.buzz.profileName, "Slack Bridge");
  });

  it("rejects duplicate room mappings", async () => {
    const path = await configFile({
      ...validFile,
      channels: [validFile.channels[0], validFile.channels[0]],
    });
    await assert.rejects(
      loadConfig(path, {
        BUZZ_PRIVATE_KEY: "22".repeat(32),
        MATRIX_ACCESS_TOKEN: "secret-token",
      }),
      /mapped more than once/,
    );
  });
});

async function configFile(value: unknown): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "buzz-slack-bridge-"));
  const path = join(directory, "config.json");
  await writeFile(path, JSON.stringify(value));
  return path;
}
