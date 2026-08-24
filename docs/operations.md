# Operations

## State and backups

Back up these paths together:

- `deploy/generated/synapse/` — Synapse database, signing key, media, and generated secret
- `deploy/generated/mautrix-slack/` — mautrix configuration and appservice tokens
- the `mautrix-data` Docker volume — mautrix database and linked Slack session
- the `adapter-data` Docker volume — event mappings, cursors, and the Nostr outbox
- `.env` and `deploy/generated/bridge/config.json` — bridge credentials and channel mappings

Everything in this list contains sensitive data. Encrypt backups and test restoration on an
isolated host. Never commit `deploy/generated/` or `.env`.

## Health and failure behavior

- `/healthz` is process liveness.
- `/readyz` is ready only after Matrix authentication and a live authenticated Buzz WebSocket.
- Matrix sync and Buzz WebSocket connections retry with bounded exponential backoff.
- A failed Buzz-to-Matrix handler closes and reopens the Buzz subscription so the overlapping cursor
  can replay the event.
- Matrix sync tokens advance only after all mapped timeline events in the response are processed.

Inspect structured logs with `docker compose logs adapter`. Event IDs and mapping labels are logged;
message bodies and credentials are not.

## Upgrades

The Compose file pins Synapse and mautrix-slack by both release tag and image digest. Upgrade one
component at a time:

1. Read its release notes and back up all state.
2. Update the tag and digest in both `compose.yaml` and `scripts/setup.sh`.
3. Run `docker compose pull` and `docker compose config --quiet`.
4. Start Synapse, then mautrix-slack, then the adapter.
5. Verify `/readyz`, a message in each direction, a thread reply, and a reaction.

Generated mautrix configuration belongs to its pinned version. For a major bridge upgrade, generate
a clean config in a temporary directory and compare it with `deploy/generated/mautrix-slack/config.yaml`.

## Channel changes

Stop the adapter before changing mappings. A Matrix room and Buzz channel may appear only once in the
config; startup rejects duplicates. Keep existing mapping rows in the adapter database so relations
to older bridged events continue to resolve.

## Credential rotation

- **Matrix token:** log the bridge account out, create a new token, update `.env`, and restart only
  the adapter. Confirm that the linked Slack user remains logged in through mautrix-slack.
- **Slack credential:** use the mautrix management room's logout/login commands. No adapter config
  changes are required.
- **Buzz key:** treat rotation as a new Buzz user. Authorize it in every channel, update `.env`, and
  restart. Old Slack-originated events remain authored by the previous key and cannot be deleted by
  the new key.

## Troubleshooting

### mautrix reports `No user logins found`

The Matrix account has not linked a Slack browser session, or the session was lost. Open the private
management room with `@slackbot:matrix.localhost` and run
`login token <xoxc-token> <xoxd-cookie>` again. The mautrix database and linked session live in the
`mautrix-data` volume, so check that the volume is mounted before replacing credentials.

### Matrix returns `M_FORBIDDEN`

Confirm that `matrix.userId` matches the account that accepted the portal invitation. Run
`npm run rooms` with the token from `.env`; the configured `matrixRoomId` must appear in that list.
If it does not, accept the invitation in the Matrix client before restarting the adapter.

### `/readyz` returns 503

Read `docker compose logs adapter`. Readiness remains false until the Matrix token has authenticated
and the Buzz WebSocket is connected and authenticated. Common causes are a stale Matrix token, the
wrong relay URL, or a Buzz bridge key that has not been authorized by the relay.

### An older Slack message did not appear in Buzz

On its first start, the adapter records the current Matrix sync position. It does not backfill room
history. Send a new message after the adapter reports ready. Later restarts resume from the saved
cursor in the `adapter-data` volume.

### Slack messages stop crossing the bridge

The linked browser session may have expired. Check the mautrix logs and its management room. A Slack
password change, session reset, or workspace policy can invalidate `xoxc-` and `xoxd-` credentials.
Log in again with fresh values; no adapter configuration change is needed.

### mautrix cannot open its SQLite database

Stop mautrix before restoring its volume, and restore the whole `mautrix-data` volume rather than a
single SQLite file. The container initializes the volume for mautrix's UID on startup. If the error
follows a manual copy, check that the restored files are writable by UID 1337.

## Production hardening

The bundled Synapse uses SQLite and binds to loopback for a single-host deployment. Production
operators should use PostgreSQL, TLS, firewalling, resource limits, monitoring, encrypted backups,
and an externally managed secret store. Keep Matrix federation disabled unless the integration bus
has a deliberate federation requirement.
