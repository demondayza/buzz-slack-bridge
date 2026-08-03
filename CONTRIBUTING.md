# Contributing

Keep the three protocol boundaries independent: Slack-specific behavior belongs upstream in
mautrix-slack, generic Matrix transport belongs in `matrix-client.ts`, and Nostr wire behavior belongs
in `buzz-client.ts`. Cross-network policy and formatting belong in `conversion.ts` and `bridge.ts`.

Before opening a pull request:

```bash
npm install
npm run check
docker build -t buzz-slack-bridge:test .
docker compose config --quiet
```

Add focused tests for every conversion rule. Never add production credentials or generated
appservice configuration to fixtures.
