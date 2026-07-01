# Security Policy

## Supported versions

Dumka Mail is currently early alpha software. Security fixes are handled on the default branch.

## Reporting a vulnerability

Please do not include secrets, OAuth refresh tokens, provider API keys, real mailbox content, or private account data in public issues.

Use GitHub private vulnerability reporting if it is enabled for the repository. If private vulnerability reporting is not available yet, open a public issue with a minimal description and ask for a private disclosure path without posting sensitive details.

## Local secrets

The repository must not contain runtime secrets. Local configuration is read from the user's home directory:

```text
~/.config/dumka-mail/google-oauth-client.json
~/.config/dumka-mail/openai.env
```

OAuth refresh tokens are stored in the macOS Keychain when available. AI provider keys are kept out of SQLite and out of committed source.
