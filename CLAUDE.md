# Project context

Read `AGENTS.md` first. The core design is a protocol chain, not a fork of Buzz or mautrix-slack:

`Slack ⇄ mautrix-slack ⇄ Synapse ⇄ adapter ⇄ Buzz`.

Slack messages are signed in Buzz by one dedicated bridge key. Buzz messages are posted to Slack by
the existing Slack user linked through mautrix-slack, with the Buzz display name carried in the
message body. This is not end-to-end identity mirroring. Preserve the durable outbox/transaction-id
strategy and explicit channel mapping model when adding features.

Primary validation is `npm run check`. Deployment validation also requires
`docker compose config --quiet` and a successful Docker build.
