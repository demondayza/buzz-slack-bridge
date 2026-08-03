import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { finalizeEvent, generateSecretKey } from "nostr-tools";
import { buzzToMatrix, matrixToBuzz } from "../src/conversion.js";
import type { EventMapping } from "../src/store.js";
import type { MatrixEvent } from "../src/types.js";

const mapping: EventMapping = {
  buzzEventId: "b".repeat(64),
  buzzKind: 9,
  direction: "matrix",
  matrixEventId: "$matrix-target",
  roomId: "!room:example.com",
};

describe("matrixToBuzz", () => {
  it("translates a Slack thread reply to a NIP-29/NIP-10 message", () => {
    const event = matrixEvent({
      body: "ship it",
      msgtype: "m.text",
      "m.relates_to": { event_id: "$matrix-target", rel_type: "m.thread" },
    });
    const converted = matrixToBuzz(event, "167b27a6-12aa-4f25-a86a-7f306de1c11e", "A*lice", (id) =>
      id === mapping.matrixEventId ? mapping : undefined,
    );

    assert.equal(converted?.kind, 9);
    assert.equal(converted?.content, "**Slack · A lice**\nship it");
    assert.deepEqual(converted?.tags.at(-1), ["e", mapping.buzzEventId, "", "reply"]);
  });

  it("ignores Matrix edits instead of duplicating them", () => {
    const event = matrixEvent({
      body: "edited",
      msgtype: "m.text",
      "m.relates_to": { event_id: "$old", rel_type: "m.replace" },
    });
    assert.equal(
      matrixToBuzz(event, crypto.randomUUID(), "Alice", () => undefined),
      undefined,
    );
  });

  it("only deletes messages originally authored by the bridge", () => {
    const event = { ...matrixEvent({}), redacts: "$matrix-target", type: "m.room.redaction" };
    assert.equal(
      matrixToBuzz(event, crypto.randomUUID(), "Alice", () => ({ ...mapping, direction: "buzz" })),
      undefined,
    );
  });
});

describe("buzzToMatrix", () => {
  it("translates a Buzz reply into a Matrix thread relation", () => {
    const event = finalizeEvent(
      {
        content: "looks good",
        created_at: 1_700_000_000,
        kind: 9,
        tags: [["e", mapping.buzzEventId, "", "reply"]],
      },
      generateSecretKey(),
    );
    const converted = buzzToMatrix(event, "Nora", (id) =>
      id === mapping.buzzEventId ? mapping : undefined,
    );

    assert.equal(converted?.eventType, "m.room.message");
    assert.equal(converted?.content.body, "Buzz · Nora\nlooks good");
    assert.deepEqual(converted?.content["m.relates_to"], {
      "m.in_reply_to": { event_id: mapping.matrixEventId },
      event_id: mapping.matrixEventId,
      is_falling_back: true,
      rel_type: "m.thread",
    });
  });
});

function matrixEvent(content: Record<string, unknown>): MatrixEvent {
  return {
    content,
    event_id: "$matrix-event",
    origin_server_ts: 1_700_000_000_000,
    sender: "@slack_alice:example.com",
    type: "m.room.message",
  };
}
