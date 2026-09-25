# Repository guide

This repository bridges Slack to Buzz by composing three systems:

1. mautrix-slack translates Slack into Matrix portal rooms.
2. a private Synapse instance delivers those events through the Matrix Client-Server API.
3. the TypeScript adapter translates Matrix events into Buzz NIP-29/Nostr events and back.

## Code map

- `src/bridge.ts` — orchestration, identity filtering, cursor updates, and channel selection
- `src/conversion.ts` — pure message/thread/reaction/deletion conversion
- `src/buzz-client.ts` — NIP-42 WebSocket session, subscriptions, validation, and reconnects
- `src/matrix-client.ts` — authenticated Matrix REST and sync transport
- `src/store.ts` — SQLite outbox, durable cursors, and cross-network event mappings
- `compose.yaml` and `scripts/setup.sh` — pinned local deployment and generated configuration

## Invariants

- Channel mappings are explicit one-to-one pairs; never infer them by channel name.
- Ignore the bridge's own Buzz pubkey and Matrix user to prevent loops.
- Persist a signed Nostr event before publishing it; retry the exact event ID.
- Use the Buzz event ID as the Matrix transaction ID.
- Never advance a source cursor before every event in its batch succeeds.
- Matrix redactions may delete only Buzz events originally authored by the bridge.
- Keep credentials in environment/generated state, never repository configuration or logs.
- Keep the mautrix database and linked Slack session in the `mautrix-data` volume.
- Portal rooms are not encrypted because the adapter does not implement Matrix E2EE.

Run `npm run check`, a container build, and `docker compose config --quiet` before committing. Update
this file and `CLAUDE.md` when architecture or operator workflow changes.

## Testing rules

- Never write unit tests after writing the code.
- Prefer end-to-end (E2E) tests as the main way to test. Use them to check that complex features work.
- Make E2E tests produce an artifact that can be checked and reproduced.
- If you need to test a system in isolation, first list all the ways it could fail. Then write the code.
- For complex features, use realistic E2E scenarios with medium or high complexity. Don't test only the simplest successful case.
- Avoid tautological tests that only confirm what the code already says.
- Avoid tests that only detect whether code changed.
- For bug fixes, add a regression test only when existing behavior tests leave a real gap.
- Clean up old junk tests: when you touch a test suite, delete tautological, change-detector, duplicate, and obsolete tests instead of maintaining them.
