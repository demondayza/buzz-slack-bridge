import { finalizeEvent, getPublicKey, type Event as NostrEvent } from "nostr-tools";

export const BUZZ_KIND = {
  deletion: 5,
  message: 9,
  profile: 0,
  reaction: 7,
} as const;

export function privateKeyBytes(privateKey: string): Uint8Array {
  const bytes = new Uint8Array(privateKey.length / 2);
  for (let index = 0; index < privateKey.length; index += 2) {
    bytes[index / 2] = Number.parseInt(privateKey.slice(index, index + 2), 16);
  }
  return bytes;
}

export function publicKeyFor(privateKey: Uint8Array): string {
  return getPublicKey(privateKey);
}

export function signBuzzEvent(
  privateKey: Uint8Array,
  kind: number,
  content: string,
  tags: string[][],
  createdAt = Math.floor(Date.now() / 1000),
): NostrEvent {
  return finalizeEvent({ content, created_at: createdAt, kind, tags }, privateKey);
}

export function firstTagValue(event: NostrEvent, tagName: string): string | undefined {
  return event.tags.find((tag) => tag[0] === tagName)?.[1];
}

export function replyTarget(event: NostrEvent): string | undefined {
  const markedReply = event.tags.find((tag) => tag[0] === "e" && tag[3] === "reply")?.[1];
  if (markedReply) return markedReply;
  return event.tags.find((tag) => tag[0] === "e")?.[1];
}
