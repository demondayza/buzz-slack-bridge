# Project context

Read `AGENTS.md` first. The core design is a protocol chain, not a fork of Buzz or mautrix-slack:

`Slack ⇄ mautrix-slack ⇄ Synapse ⇄ adapter ⇄ Buzz`.

The adapter intentionally uses one service identity per destination network and carries the original
display name in the body. It does not promise native end-to-end user puppeting. Preserve the durable
outbox/transaction-id strategy and explicit channel mapping model when adding features.

Primary validation is `npm run check`. Deployment validation also requires
`docker compose config --quiet` and a successful Docker build.
