# Dumka Mail

Dumka Mail is a local-first desktop Gmail client built with Electron, React, TypeScript, Tailwind CSS, and SQLite.

The app syncs Gmail metadata and messages into a local SQLite cache, applies mailbox actions optimistically, and uses optional AI providers for triage, summaries, drafting, and rewrites. Provider keys and OAuth refresh tokens are stored outside the repository and outside the bundled app.

## Status

This project is early alpha software. It is useful for local development and experimentation, but it is not yet a signed or notarized production distribution.

## Features

- Local SQLite mail cache with full-text search.
- Gmail OAuth onboarding with macOS Keychain token storage.
- Optional incremental Google Calendar and Google Contacts authorization from settings.
- Split inbox categories, saved views, reminders, and action history.
- Offline-first mailbox mutations with background reconciliation, including archive, trash, spam, ignore, and nested Gmail labels.
- Address book sync with local contact notes, display-name edits, mailing groups, and compose autocomplete.
- Compose, reply, forward, signatures, snippets, attachments, and sent mail sync.
- Right-panel mini-calendar and agenda, local availability suggestions, calendar invite cards, add-to-calendar/RSVP actions, and scheduling-link insertion.
- Optional AI providers: OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, and OpenAI-compatible endpoints.
- Secure Electron defaults: context isolation, sandboxed renderer, disabled Node integration, and typed preload IPC.

## Requirements

- macOS for the current desktop build and Keychain integration.
- Node.js 22 or newer.
- npm 10 or newer.
- A Google OAuth desktop client JSON file with Gmail API access. Calendar and Contacts scopes are requested later from Settings only when those integrations are enabled.

## Setup

Install dependencies:

```bash
npm install
```

Place the Google OAuth client JSON here:

```text
~/.config/dumka-mail-agy/google-oauth-client.json
```

Optional AI provider settings are read from:

```text
~/.config/dumka-mail-agy/openai.env
```

Example values:

```bash
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.4-mini
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-sonnet-4.6
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=~openai/gpt-latest
```

Do not commit local OAuth files, provider keys, refresh tokens, SQLite databases, logs, or app exports.

## Development

Run the app in development mode:

```bash
npm run dev
```

Run tests:

```bash
npm test
```

Run the production build and TypeScript check:

```bash
npm run build
```

Build a local macOS app directory:

```bash
npm run package:mac
```

Install the locally built app into `/Applications`:

```bash
npm run install-app
```

## Privacy

Dumka Mail has no hosted backend in this repository. Mail data, settings, sync state, drafts, and action history are stored locally on the user's machine. See [docs/PRIVACY.md](./docs/PRIVACY.md) for details.

## Security

Please do not open public issues with secrets, tokens, real email content, or OAuth artifacts. See [SECURITY.md](./SECURITY.md).

## License

MIT. See [LICENSE](./LICENSE).
