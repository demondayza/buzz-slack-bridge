import { getPublicKey } from "nostr-tools";

const secret = process.env.BUZZ_PRIVATE_KEY;
if (!secret || !/^[0-9a-f]{64}$/i.test(secret)) {
  throw new Error("BUZZ_PRIVATE_KEY must be 64 hexadecimal characters");
}
const bytes = Uint8Array.from(secret.match(/.{2}/g).map((byte) => Number.parseInt(byte, 16)));
console.log(getPublicKey(bytes));
