# Architecture

## Why Matrix is in the middle

Buzz stores signed Nostr events and exposes NIP-29 channels. mautrix-slack implements a Matrix
application service. Neither project exposes an adapter surface that can be connected directly to
the other, so a private Matrix homeserver is the smallest stable compatibility boundary that uses
mautrix-slack without forking it.

The components have narrow ownership:

- **mautrix-slack** owns Slack authentication, Slack WebSocket/API behavior, ghost users, portal
  rooms, and Slack-specific conversion.
- **Synapse** owns appservice delivery and the Matrix rooms used as the integration bus.
- **The adapter** owns protocol translation, explicit channel mappings, loop prevention, cursors,
  and the visible cross-network sender label.
- **Buzz** remains authoritative for Buzz membership and Nostr event validation.

## Event flow

### Slack to Buzz

1. mautrix-slack writes the Slack event into its Matrix portal room using a ghost sender.
2. The adapter's `/sync` loop reads the event and resolves the ghost's display name.
3. It creates a signed kind `9`, `7`, or `5` Buzz event with the mapped `h` channel tag.
4. The exact signed event is placed in a SQLite outbox before publication.
5. After a Buzz acknowledgement, the adapter atomically stores the cross-network event mapping and
   removes the outbox item.

If the process fails between steps 4 and 5, it republishes the exact Nostr event ID. A duplicate relay
acknowledgement is treated as successful completion.

### Buzz to Slack

1. The adapter authenticates with NIP-42 and subscribes to mapped NIP-29 channels.
2. It ignores its own bridge pubkey and events already present in the mapping table.
3. It converts the event into a Matrix message/reaction/redaction.
4. It uses `buzz_<event-id>` as the Matrix transaction ID, making a retry idempotent.
5. mautrix-slack sends the Matrix event to Slack as the linked existing Slack user.

The Buzz subscription timestamp and Matrix sync token are durable. Filters overlap the last two Buzz
seconds after reconnect; event IDs and mappings make the overlap safe and avoid same-second gaps.

## Relations

- Matrix `m.thread` and `m.in_reply_to` targets are looked up in the mapping table and emitted as
  NIP-10 `e` tags with the `reply` marker.
- NIP-10 replies become Matrix `m.thread` relations with a fallback reply target.
- Matrix `m.annotation` reactions become NIP-25 kind `7` events and vice versa.
- A Matrix redaction can delete a Buzz event only when that target originated in Matrix and is
  therefore authored by the bridge key. This prevents the bridge from attempting to delete a Buzz
  user's own event.

## Deliberate limitations

- **Edits:** Buzz kind `40003` is Buzz-specific, while Matrix uses `m.replace`. Until their semantic
  differences are explicitly reconciled, edits are ignored.
- **Media:** secure translation needs authenticated Matrix media download plus Buzz Blossom upload,
  MIME policy, size limits, and durable upload state. It should be implemented as its own pipeline.
- **Encryption:** the adapter does not participate in Matrix E2EE. Portal rooms must be unencrypted.
- **End-to-end puppeting:** a single credential on each destination network limits secret sprawl and
  provides an obvious audit identity, at the cost of native per-user authorship.
- **Historical import:** the first Matrix sync is a cutover point. Existing Slack history is not
  replayed into Buzz.
