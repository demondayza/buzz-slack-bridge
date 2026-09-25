# Project context

Read `AGENTS.md` first. The core design is a protocol chain, not a fork of Buzz or mautrix-slack:

`Slack ⇄ mautrix-slack ⇄ Synapse ⇄ adapter ⇄ Buzz`.

Slack messages are signed in Buzz by one dedicated bridge key. Buzz messages are posted to Slack by
the existing Slack user linked through mautrix-slack, with the Buzz display name carried in the
message body. This is not end-to-end identity mirroring. Preserve the durable outbox/transaction-id
strategy and explicit channel mapping model when adding features.

Primary validation is `npm run check`. Deployment validation also requires
`docker compose config --quiet` and a successful Docker build.

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
