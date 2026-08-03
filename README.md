# Buzz ↔ Slack Bridge

Run a bidirectional bridge between [Buzz](https://github.com/block/buzz) channels and an
existing Slack workspace. This repository uses the upstream
[mautrix-slack](https://github.com/mautrix/slack) bridge and adds the missing Buzz adapter.

Buzz and mautrix-slack do not speak the same protocol: Buzz is a Nostr/NIP-29 client and
mautrix-slack is a Matrix application service. The private Matrix homeserver in this deployment is
an integration bus, not another chat product your team needs to adopt.

```text
Slack ⇄ mautrix-slack ⇄ private Synapse ⇄ this adapter ⇄ Buzz relay
```

## What works

| Capability | Behavior |
| --- | --- |
| Text messages | Bidirectional, with the source network and display name prepended |
| Threads | Matrix `m.thread` relations map to Buzz NIP-10 `reply` tags |
| Reactions | Matrix annotations map to NIP-25 events |
| Deletions | Propagated when the source-side author is allowed to delete the target |
| Restarts | Durable cursors, event mappings, a Matrix transaction ID, and a Nostr outbox prevent loops and ordinary replay duplicates |
| Multiple channels/workspaces | Add one explicit Matrix room ↔ Buzz channel mapping per portal |

The MVP intentionally does not translate edits, encrypted Matrix rooms, files, calls, typing, read
receipts, or Slack/Buzz administration. Matrix edits are ignored instead of being duplicated as new
messages. See [Architecture](docs/architecture.md) for the boundary decisions.

## Prerequisites

- Docker with Compose v2
- A running Buzz relay and the UUID of each destination Buzz channel
- A dedicated Slack account that may join the channels being bridged
- A dedicated 32-byte Nostr secret key, represented as 64 hexadecimal characters
- Node.js 22+ for local development and the room-list helper

The included deployment is single-host and non-federated. For production scale, point mautrix-slack
and the adapter at an existing hardened Matrix deployment instead of using the bundled SQLite-based
Synapse.

## Quick start

### 1. Generate private Matrix and appservice configuration

```bash
./scripts/setup.sh
docker compose up -d synapse mautrix-slack
./scripts/create-matrix-user.sh
```

The final command prints the Matrix account, generated password, and access token. Store the token
in `.env` as `MATRIX_ACCESS_TOKEN`. Generated appservice tokens and signing material live under
`deploy/generated/`, which is gitignored.

### 2. Log the bridge account into Slack

Use a Matrix client pointed at `http://127.0.0.1:8008`, sign in as
`@buzzbridge:matrix.localhost`, and start a conversation with
`@slackbot:matrix.localhost`. Follow the bot's `login` flow using a Slack account dedicated to this
bridge. The supported authentication methods are maintained by
[mautrix-slack](https://docs.mau.fi/bridges/go/slack/authentication.html); review your Slack
workspace policy before supplying credentials.

After login, let mautrix-slack create/sync the portal rooms for the Slack channels that account can
access. Do not enable encryption on those rooms: this adapter intentionally uses the standard Matrix
Client-Server API and does not hold Matrix encryption keys.

### 3. Collect channel identifiers

Load the Matrix token and list the account's joined portal rooms:

```bash
set -a
source .env
set +a
npm install
npm run rooms
```

Use `buzz channels list` (from the Buzz CLI) to get Buzz channel UUIDs. Add each pair to
`deploy/generated/bridge/config.json`:

```json
{
  "label": "general",
  "matrixRoomId": "!portalRoomId:matrix.localhost",
  "buzzChannelId": "167b27a6-12aa-4f25-a86a-7f306de1c11e"
}
```

Mappings are deliberately explicit. The adapter never guesses that two channels with the same name
should share messages.

### 4. Authorize the Buzz bridge identity

Put the bridge's 64-character secret key in `.env` as `BUZZ_PRIVATE_KEY`, then print its public key:

```bash
npm run buzz-pubkey
```

If the Buzz relay requires relay membership, add that public key with `buzz-admin`. Add the same
identity to every mapped Buzz channel. With `nak`, a channel owner can emit the NIP-29 add-user event:

```bash
nak event -k 9000 \
  --tag "h=<buzz-channel-uuid>" \
  --tag "p=<bridge-public-key>" \
  --auth --sec <owner-secret-key> \
  wss://buzz.example.com
```

For an open channel, the bridge identity may instead send a kind `9021` join request signed with its
own key. Authorization happens in Buzz; this repository never modifies the Buzz database directly.

### 5. Start the adapter

```bash
docker compose up -d --build adapter
docker compose logs -f adapter
```

Readiness is available at `http://adapter:8787/readyz` inside the Compose network. On the first run,
the adapter establishes a Matrix sync position without importing old room history. It resumes from
durable cursors after that cutover.

## Configuration

Non-secret settings live in `deploy/generated/bridge/config.json`; secrets are environment variables.
Start from [config.example.json](config.example.json).

| Setting | Purpose |
| --- | --- |
| `buzz.relayUrl` | Buzz Nostr WebSocket URL (`ws://` or `wss://`) |
| `buzz.profileName` | Display name published for the single Slack-side Buzz identity |
| `matrix.homeserverUrl` | Matrix Client-Server base URL as seen by the adapter |
| `matrix.userId` | Matrix account that is logged into Slack through mautrix-slack |
| `channels` | Explicit Matrix room ↔ Buzz channel mappings |
| `databasePath` | SQLite state/outbox path |
| `BUZZ_PRIVATE_KEY` | Dedicated Nostr secret key; environment only |
| `MATRIX_ACCESS_TOKEN` | Dedicated Matrix access token; environment only |

## Identity model

Slack users arrive in Matrix as mautrix ghost users, so their display names can be retained in the
Buzz message body. They are signed on Buzz by one dedicated bridge key. In the other direction,
Buzz messages are sent by one Matrix/Slack service account and carry `Buzz · display name` in their
body. This avoids storing one Slack credential per Buzz user and makes the trust boundary visible.

Do not present the bridge key or Slack service account as a human. Both identities have the combined
ability to speak into every mapped channel.

## Development

```bash
npm install
npm run check
npm run dev
```

The checks run Biome, strict TypeScript, unit tests, and a production build. CI also builds the
container and validates the Compose model.

## Operations and security

See [Operations](docs/operations.md) for backups, upgrades, and incident behavior, and
[SECURITY.md](SECURITY.md) for credential and disclosure guidance. `mautrix-slack` is AGPL-3.0;
this repository consumes its separately distributed container image and does not copy or link its
source code.
