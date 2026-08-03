# Operations

## State and backups

Back up these paths together:

- `deploy/generated/synapse/` — Synapse database, signing key, media, and generated secret
- `deploy/generated/mautrix-slack/` — mautrix database, Slack credentials, and appservice tokens
- the `adapter-data` Docker volume — event mappings, cursors, and the Nostr outbox
- `.env` and `deploy/generated/bridge/config.json` — bridge credentials and channel mappings

All four contain sensitive data. Encrypt backups and test restoration on an isolated host. Never
commit `deploy/generated/` or `.env`.

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
  the adapter. Confirm that the account remains logged into Slack through mautrix-slack.
- **Slack credential:** use the mautrix management room's logout/login commands. No adapter config
  changes are required.
- **Buzz key:** treat rotation as a new Buzz user. Authorize it in every channel, update `.env`, and
  restart. Old Slack-originated events remain authored by the previous key and cannot be deleted by
  the new key.

## Production hardening

The bundled Synapse uses SQLite and binds to loopback for a single-host deployment. Production
operators should use PostgreSQL, TLS, firewalling, resource limits, monitoring, encrypted backups,
and an externally managed secret store. Keep Matrix federation disabled unless the integration bus
has a deliberate federation requirement.
