# Getting started

This guide connects one existing Slack conversation to one Buzz channel on a local installation.
Once that works, you can add more explicit room and channel pairs to the same configuration.

## What you need

- Docker with Compose v2
- Node.js 22.5 or newer
- an existing Slack account with access to the conversation you want to bridge
- a Matrix client that can connect to a custom homeserver
- the WebSocket URL of your Buzz relay
- the UUID of the destination Buzz channel

The Slack account is a normal user identity. You do not need to create a Slack app or install a bot.
Buzz messages will be posted to Slack by this linked user, so choose the account deliberately and
check your workspace policy before continuing.

## 1. Generate the local configuration

From the repository root, run:

```bash
./scripts/setup.sh
docker compose up -d synapse mautrix-slack
./scripts/create-matrix-user.sh
npm install
```

The setup script creates `.env`. The user-creation script then prints credentials for
`@buzzbridge:matrix.localhost`. Save the password long enough to complete the Matrix login, and copy
the access token into `.env`:

```dotenv
MATRIX_ACCESS_TOKEN=the-token-from-create-matrix-user
BUZZ_PRIVATE_KEY=
```

Files under `deploy/generated/` contain appservice secrets and are ignored by git. Do not copy them
into an issue, chat message, or commit.

## 2. Link the existing Slack user

Point your Matrix client at `http://127.0.0.1:8008` and sign in as
`@buzzbridge:matrix.localhost`. Start a private conversation with
`@slackbot:matrix.localhost`.

mautrix-slack authenticates with two values from the user's current Slack browser session:

- the `xoxc-` token stored in Slack's `localConfig_v2`
- the `xoxd-` value from Slack's `d` cookie

In the Slack web app, open the browser developer tools. The token is available in the console as
`JSON.parse(localStorage.localConfig_v2).teams.YOUR_TEAM_ID_HERE.token`. Find the `d` cookie for the
Slack domain under the browser's application or storage panel. Do not paste either value into a
shell command or repository file.

Send the values to the mautrix management room:

```text
login token <xoxc-token> <xoxd-cookie>
```

The Slack bot replies when the login has succeeded. This browser-session method uses neither a
Slack bot token (`xoxb-`) nor an app-level token (`xapp-`). Slack may invalidate the session after a
password change, security reset, or workspace policy change. If that happens, repeat this step with
fresh values.

For browser-specific details, see the upstream
[mautrix-slack authentication guide](https://docs.mau.fi/bridges/go/slack/authentication.html).

## 3. Accept the Slack portal room

After login, mautrix-slack creates portal rooms for recent Slack conversations and invites
`@buzzbridge:matrix.localhost` to them. Accept the invitation for the conversation you want to
bridge. Keep the portal room unencrypted because this adapter does not implement Matrix end-to-end
encryption.

Load the access token and list the joined Matrix rooms:

```bash
set -a
source .env
set +a
npm run rooms
```

Copy the room ID for the Slack portal. It has the form
`!opaqueRoomId:matrix.localhost`. The room ID, rather than its display name, is what belongs in the
bridge configuration.

## 4. Prepare the Buzz identity

Generate a dedicated 32-byte Nostr secret key:

```bash
openssl rand -hex 32
```

Put the resulting 64 lowercase hexadecimal characters in `.env` as `BUZZ_PRIVATE_KEY`. Then print
the corresponding public key:

```bash
npm run buzz-pubkey
```

Authorize that public key in the Buzz relay and in the destination NIP-29 channel. The exact admin
command depends on how the relay is operated. With `nak`, a channel owner can publish an add-user
event like this:

```bash
nak event -k 9000 \
  --tag "h=<buzz-channel-uuid>" \
  --tag "p=<bridge-public-key>" \
  --auth --sec <owner-secret-key> \
  wss://buzz.example.com
```

For an open channel, the bridge identity can instead send a kind `9021` join request. Keep channel
owner keys out of this repository and out of shell history where possible.

## 5. Map the conversation

Open `deploy/generated/bridge/config.json`. Set `buzz.relayUrl` to the relay WebSocket URL, then add
the Matrix portal room and Buzz channel UUID to `channels`:

```json
{
  "buzz": {
    "relayUrl": "wss://buzz.example.com",
    "profileName": "Slack bridge"
  },
  "matrix": {
    "homeserverUrl": "http://synapse:8008",
    "userId": "@buzzbridge:matrix.localhost"
  },
  "channels": [
    {
      "label": "general",
      "matrixRoomId": "!opaqueRoomId:matrix.localhost",
      "buzzChannelId": "167b27a6-12aa-4f25-a86a-7f306de1c11e"
    }
  ],
  "databasePath": "/data/bridge.sqlite3"
}
```

The label is only for logs. Room and channel IDs must be unique. The adapter will not infer a match
from two rooms having the same name.

## 6. Start and verify the bridge

Build and start the adapter:

```bash
docker compose up -d --build adapter
docker compose logs -f adapter
```

The logs should show successful Matrix authentication and a connected Buzz relay. You can also
check readiness from inside the Compose network:

```bash
docker compose exec adapter node -e \
  "fetch('http://127.0.0.1:8787/readyz').then(async r => { console.log(r.status, await r.text()); process.exit(r.ok ? 0 : 1) })"
```

Now test both directions with messages that contain unique text:

1. Send a message in Slack and confirm that it appears in the mapped Buzz channel with the Slack
   author's display name.
2. Send a different message in Buzz and confirm that it appears in Slack under the linked Slack
   user, prefixed with the Buzz sender label.

The adapter establishes its first Matrix cursor when it starts. Messages sent before that initial
sync are not imported as history.

## Add another conversation

Accept the second Slack portal room invitation and run `npm run rooms` again. Add another entry to
`channels`, authorize the same bridge public key in the new Buzz channel, then restart the adapter:

```bash
docker compose restart adapter
```

Every mapping is one Matrix room to one Buzz channel. A room or channel cannot appear twice.

For backups, upgrades, credential rotation, and common failures, continue with the
[operations guide](operations.md). The [architecture guide](architecture.md) explains the event
flow and durability rules, while [SECURITY.md](../SECURITY.md) covers credentials and trust
boundaries.
