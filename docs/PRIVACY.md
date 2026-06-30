# Privacy Notes

Dumka Mail is designed as a local-first desktop app.

## Local storage

The app stores mailbox metadata, cached messages, drafts, reminders, action history, settings, sync state, and AI conversation history in a local SQLite database under the user's application support directory.

## Credentials

Runtime credentials are not stored in the repository.

- Google OAuth client config is read from `~/.config/dumka-mail-agy/google-oauth-client.json`.
- Optional AI provider settings are read from `~/.config/dumka-mail-agy/openai.env`.
- OAuth refresh tokens are stored in the macOS Keychain when available.
- AI provider keys are stored outside SQLite when Keychain storage is enabled.

## Network requests

The app talks directly to Gmail and to the AI provider selected by the user. Mail content is only sent to an AI provider when the user enables AI features and allows the relevant context to be included.

## Remote images

HTML mail may reference sender-hosted remote images. The app exposes a privacy setting for remote image loading.

## Diagnostics

Diagnostics are disabled by default. Logs should not include secrets or raw tokens.
