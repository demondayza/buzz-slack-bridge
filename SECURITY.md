# Security policy

## Supported versions

Security fixes are applied to the current `main` branch. The upstream Synapse and mautrix-slack
images are pinned; operators are responsible for following their advisories and upgrading pins.

## Secrets

The Slack session stored by mautrix-slack, Matrix access token, Synapse/appservice secrets, and Buzz
private key all grant message access. Keep them out of git, logs, chat, issue reports, and container
images. The generated deployment directory and `.env` are ignored by default.

Link only a Slack user who has explicitly authorized the bridge to send messages as them. A
dedicated, least-privileged Slack account is safer but optional; an existing human identity is
supported. Use a dedicated Buzz identity and do not reuse a human's Nostr key. Restrict the Matrix
listener and adapter health port at the network layer.

## Reporting a vulnerability

Do not open a public issue containing credentials, private message data, or an exploitable proof of
concept. Contact the repository owner privately with the affected revision, impact, reproduction,
and suggested remediation. For issues in Buzz, Synapse, or mautrix-slack themselves, use the upstream
project's security policy.
