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

The app talks directly to Gmail and to the AI provider selected by the user. If the user enables Calendar or Contacts in settings, the app also talks directly to Google Calendar and Google People APIs for the selected account. Mail content is only sent to an AI provider when the user enables AI features and allows the relevant context to be included.

## Google scopes

Initial account onboarding requests Gmail modify access plus Google profile/email scopes. Calendar and Contacts are incremental opt-ins:

- Calendar uses `https://www.googleapis.com/auth/calendar.events` for agenda sync, invite RSVP, and Google Meet event creation.
- Contacts uses `https://www.googleapis.com/auth/contacts.readonly` for address-book sync. Local contact notes and groups are stored in SQLite.

## Remote images

HTML mail may reference sender-hosted remote images. The app exposes a privacy setting for remote image loading.

## Diagnostics

Diagnostics are disabled by default. Logs should not include secrets or raw tokens.
