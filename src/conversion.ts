import type { Event as NostrEvent } from "nostr-tools";
import { BUZZ_KIND, firstTagValue, replyTarget } from "./nostr-event.js";
import type { EventMapping } from "./store.js";
import type { MatrixEvent } from "./types.js";

export interface UnsignedBuzzEvent {
  content: string;
  kind: number;
  tags: string[][];
}

export interface MatrixOutboundEvent {
  content: Record<string, unknown>;
  eventType: string;
  redacts?: string;
}

export function matrixToBuzz(
  event: MatrixEvent,
  channelId: string,
  senderName: string,
  findTarget: (matrixEventId: string) => EventMapping | undefined,
): UnsignedBuzzEvent | undefined {
  if (event.type === "m.room.message") {
    const body = stringValue(event.content.body);
    const msgtype = stringValue(event.content.msgtype);
    if (!body || !["m.emote", "m.notice", "m.text"].includes(msgtype ?? "")) return undefined;
    if (relation(event.content)?.rel_type === "m.replace") return undefined;

    const tags = baseTags(channelId, event.event_id);
    const replyEventId = matrixReplyTarget(event.content);
    const target = replyEventId ? findTarget(replyEventId) : undefined;
    if (target) tags.push(["e", target.buzzEventId, "", "reply"]);
    const text = msgtype === "m.emote" ? `_${senderName} ${body}_` : body;
    return {
      content: `**Slack · ${inlineLabel(senderName)}**\n${text}`,
      kind: BUZZ_KIND.message,
      tags,
    };
  }

  if (event.type === "m.reaction") {
    const relatesTo = relation(event.content);
    const key = stringValue(relatesTo?.key);
    const matrixTarget = stringValue(relatesTo?.event_id);
    const target = matrixTarget ? findTarget(matrixTarget) : undefined;
    if (!key || !target) return undefined;
    return {
      content: key,
      kind: BUZZ_KIND.reaction,
      tags: [...baseTags(channelId, event.event_id), ["e", target.buzzEventId]],
    };
  }

  if (event.type === "m.room.redaction") {
    const matrixTarget = event.redacts ?? stringValue(event.content.redacts);
    const target = matrixTarget ? findTarget(matrixTarget) : undefined;
    if (target?.direction !== "matrix") return undefined;
    return {
      content: "Deleted in Slack",
      kind: BUZZ_KIND.deletion,
      tags: [...baseTags(channelId, event.event_id), ["e", target.buzzEventId]],
    };
  }

  return undefined;
}

export function buzzToMatrix(
  event: NostrEvent,
  senderName: string,
  findTarget: (buzzEventId: string) => EventMapping | undefined,
): MatrixOutboundEvent | undefined {
  if (event.kind === BUZZ_KIND.message) {
    const target = replyTarget(event);
    const matrixTarget = target ? findTarget(target) : undefined;
    const relatesTo = matrixTarget
      ? {
          "m.in_reply_to": { event_id: matrixTarget.matrixEventId },
          event_id: matrixTarget.matrixEventId,
          is_falling_back: true,
          rel_type: "m.thread",
        }
      : undefined;
    return {
      content: {
        body: `Buzz · ${senderName}\n${event.content}`,
        msgtype: "m.text",
        ...(relatesTo ? { "m.relates_to": relatesTo } : {}),
      },
      eventType: "m.room.message",
    };
  }

  if (event.kind === BUZZ_KIND.reaction) {
    const target = firstTagValue(event, "e");
    const matrixTarget = target ? findTarget(target) : undefined;
    if (!matrixTarget || !event.content) return undefined;
    return {
      content: {
        "m.relates_to": {
          event_id: matrixTarget.matrixEventId,
          key: event.content,
          rel_type: "m.annotation",
        },
      },
      eventType: "m.reaction",
    };
  }

  if (event.kind === BUZZ_KIND.deletion) {
    const target = firstTagValue(event, "e");
    const matrixTarget = target ? findTarget(target) : undefined;
    if (!matrixTarget) return undefined;
    return {
      content: {},
      eventType: "m.room.redaction",
      redacts: matrixTarget.matrixEventId,
    };
  }

  return undefined;
}

function baseTags(channelId: string, matrixEventId: string): string[][] {
  return [
    ["h", channelId],
    ["client", "buzz-slack-bridge"],
    ["matrix_event_id", matrixEventId],
  ];
}

function inlineLabel(value: string): string {
  return value
    .replace(/[\r\n*_`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

function matrixReplyTarget(content: Record<string, unknown>): string | undefined {
  const relatesTo = relation(content);
  if (!relatesTo) return undefined;
  if (relatesTo.rel_type === "m.thread") return stringValue(relatesTo.event_id);
  const inReplyTo = objectValue(relatesTo["m.in_reply_to"]);
  return stringValue(inReplyTo?.event_id);
}

function relation(content: Record<string, unknown>): Record<string, unknown> | undefined {
  return objectValue(content["m.relates_to"]);
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
