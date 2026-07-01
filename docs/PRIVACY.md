# Privacy Notes

Dumka Mail is designed as a local-first desktop app.

## Local storage

The app stores mailbox metadata, cached messages, message headers, drafts, reminders, action history, settings, sync state, AI conversation history, optional agent draft previews, security analysis snapshots, and optional semantic-search vectors in a local SQLite database under the user's application support directory.

## Credentials

Runtime credentials are not stored in the repository.

- Google OAuth client config is read from `~/.config/dumka-mail/google-oauth-client.json`.
- Optional AI provider credentials are read from `~/.config/dumka-mail/openai.env` or the macOS Keychain.
- OAuth refresh tokens are stored in the macOS Keychain when available.
- AI provider keys are stored outside SQLite when Keychain storage is enabled.

## Network requests

The app talks directly to Gmail and to the AI provider selected by the user. If the user enables Calendar or Contacts in settings, the app also talks directly to Google Calendar and Google People APIs for the selected account. Mail content is only sent to an AI provider when the user enables AI features and allows the relevant context to be included. Proactive draft generation and semantic-search embeddings are disabled by default because they can use paid provider tokens. Semantic search uses the embeddings provider configured in Settings, supports local and cloud providers, and stores vectors locally. The local vector index is keyed by provider, model, endpoint, and dimensions; changing those settings does not reuse incompatible vectors, and Settings exposes controls to reindex or delete old vector rows.

## Google scopes

Initial account onboarding requests Gmail modify access plus Google profile/email scopes. Calendar and Contacts are incremental opt-ins:

- Calendar uses `https://www.googleapis.com/auth/calendar.events` for agenda sync, invite RSVP, and Google Meet event creation. Availability suggestions are calculated locally from cached calendar events.
- Contacts uses `https://www.googleapis.com/auth/contacts.readonly` for address-book sync. Local contact display-name edits, notes, and groups are stored in SQLite and are not written back to Google.

## Remote images

HTML mail may reference sender-hosted remote images. The app exposes a privacy setting for remote image loading, strips likely tracking pixels from rendered HTML, and stores local warning snapshots for suspicious tracking or phishing signals.

## Diagnostics

Diagnostics are disabled by default. Logs should not include secrets or raw tokens.
