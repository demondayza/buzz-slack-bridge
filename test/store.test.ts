import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { finalizeEvent, generateSecretKey } from "nostr-tools";
import { BridgeStore } from "../src/store.js";

describe("BridgeStore", () => {
  it("atomically moves an acknowledged event from outbox to mappings", async () => {
    const directory = await mkdtemp(join(tmpdir(), "buzz-slack-store-"));
    const store = new BridgeStore(join(directory, "bridge.db"));
    const event = finalizeEvent(
      { content: "hello", created_at: 1_700_000_000, kind: 9, tags: [["h", crypto.randomUUID()]] },
      generateSecretKey(),
    );

    store.saveMatrixOutbox("$matrix-event", "!room:example.com", event);
    assert.equal(store.getOutboxEvent("$matrix-event")?.id, event.id);

    store.completeMatrixToBuzz({
      buzzEventId: event.id,
      buzzKind: event.kind,
      direction: "matrix",
      matrixEventId: "$matrix-event",
      roomId: "!room:example.com",
    });

    assert.equal(store.getOutboxEvent("$matrix-event"), undefined);
    assert.equal(store.getBuzzEventForMatrix("$matrix-event")?.buzzEventId, event.id);
    assert.equal(store.getMatrixEventForBuzz(event.id)?.matrixEventId, "$matrix-event");
    store.close();
  });

  it("upserts durable cursors", async () => {
    const directory = await mkdtemp(join(tmpdir(), "buzz-slack-store-"));
    const store = new BridgeStore(join(directory, "bridge.db"));
    store.setMetadata("matrix_since", "s1");
    store.setMetadata("matrix_since", "s2");
    assert.equal(store.getMetadata("matrix_since"), "s2");
    store.close();
  });
});
