# Buzz Slack Bridge

This bridge connects a Buzz channel to an existing Slack conversation. People in Slack can keep
using Slack, while people in Buzz can reply from Buzz. Messages travel in both directions.

There is no Slack app to install and no bot account to invite. The person setting up the bridge
links an existing Slack login through
[mautrix-slack](https://github.com/mautrix/slack). Messages sent from Buzz appear in Slack under that
linked account, with the Buzz sender identified in the message body.

```text
Slack <-> mautrix-slack <-> private Synapse <-> adapter <-> Buzz relay
```

Matrix is plumbing here. Your team does not need to move to Matrix or use it day to day.

## What it does

| Feature | Behaviour |
| --- | --- |
| Text messages | Sent in both directions with the source and display name attached |
| Threads | Slack and Matrix thread relations map to Buzz replies |
| Reactions | Matrix annotations map to NIP-25 reaction events |
| Deletions | Passed through when the source author is allowed to delete the target |
| Restarts | Cursors, mappings, and an outbox prevent ordinary replay duplicates |
| More than one channel | Each Slack portal room is mapped to one Buzz channel UUID |

The bridge does not currently handle edits, files, calls, typing indicators, read receipts, or
encrypted Matrix rooms. It also starts at the point when the adapter first connects. Old Slack
history is not copied into Buzz.

## How identity works

Slack messages reach Matrix through mautrix ghost users, so Buzz can show the original Slack
author's name. One dedicated Nostr key signs those messages on the Buzz side.

Messages going the other way are posted to Slack by the linked Slack user. The body starts with a
label such as `Buzz · 3c72addb...`, which makes it clear that the message came from Buzz. This is a
channel bridge, not one-to-one identity mirroring. Buzz users do not need Slack accounts.

The linked Slack user is delegating their ability to post in every mapped conversation. Use an
account whose owner understands that. A separate service account may be safer in some workplaces,
but it is optional.

## Before you start

You will need:

- Docker with Compose v2
- Node.js 22.5 or newer
- a Buzz relay URL and the UUID of each Buzz channel you want to connect
- an existing Slack user who can open the Slack conversations you want to connect
- a 32-byte Nostr secret key for the bridge, written as 64 lowercase hexadecimal characters
- a Matrix client for the one-time Slack login and portal-room setup

The included Synapse deployment is private, non-federated, and intended for a single host. Read the
[operations guide](docs/operations.md) before using it for a production workspace.

## Quick start

Generate the local Synapse and mautrix configuration, then create the Matrix user:

```bash
./scripts/setup.sh
docker compose up -d synapse mautrix-slack
./scripts/create-matrix-user.sh
npm install
```

The user-creation script prints a Matrix password and access token. Put the access token in `.env`.
Add the bridge's Nostr secret key there too:

```dotenv
MATRIX_ACCESS_TOKEN=...
BUZZ_PRIVATE_KEY=...
```

Sign in to the local Matrix server as `@buzzbridge:matrix.localhost`, open a private conversation
with `@slackbot:matrix.localhost`, and link the existing Slack user with:

```text
login token <xoxc-token> <xoxd-cookie>
```

This is a Slack browser-session login. It does not use `xoxb` or `xapp` bot credentials. Accept the
Matrix invitations for the Slack conversations you want to connect, then list the joined rooms:

```bash
set -a
source .env
set +a
npm run rooms
```

Add each Matrix room and Buzz channel pair to `deploy/generated/bridge/config.json`, authorize the
bridge's Nostr public key in those Buzz channels, and start the adapter:

```bash
npm run buzz-pubkey
docker compose up -d --build adapter
docker compose logs -f adapter
```

[Follow the full getting-started guide](docs/getting-started.md) for the Slack session values, Buzz
authorization, and a test message in each direction.

## Configuration

Generated runtime configuration lives in `deploy/generated/` and is ignored by git. Start from
[config.example.json](config.example.json) when preparing a configuration outside the bundled setup.

| Setting | Purpose |
| --- | --- |
| `buzz.relayUrl` | Buzz Nostr WebSocket URL (`ws://` or `wss://`) |
| `buzz.profileName` | Profile name published for the bridge's Buzz identity |
| `matrix.homeserverUrl` | Matrix Client-Server URL as seen by the adapter |
| `matrix.userId` | Matrix account associated with the linked Slack user |
| `channels` | Explicit Matrix room and Buzz channel pairs |
| `databasePath` | SQLite state and outbox path |
| `BUZZ_PRIVATE_KEY` | Dedicated Nostr secret key, supplied through the environment |
| `MATRIX_ACCESS_TOKEN` | Matrix access token, supplied through the environment |

Mappings are always explicit. The adapter never assumes that two channels with the same name belong
together.

## Documentation

- [Getting started](docs/getting-started.md) covers a complete local setup.
- [Architecture](docs/architecture.md) explains event flow, durability, and protocol boundaries.
- [Operations](docs/operations.md) covers backups, upgrades, recovery, and troubleshooting.
- [Security](SECURITY.md) lists the credentials and trust boundaries that matter.
- [Contributing](CONTRIBUTING.md) has the development checks used by this repository.

## Development

```bash
npm install
npm run check
docker build -t buzz-slack-bridge:test .
docker compose config --quiet
```

The adapter is MIT licensed. mautrix-slack is AGPL-3.0 and runs as a separately distributed
container; this repository does not copy or link its source.
