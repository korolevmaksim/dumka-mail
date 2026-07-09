# Privacy Notes

Dumka Mail is designed as a local-first desktop app.

## Local storage

The app stores mailbox metadata, cached messages, message headers, drafts, reminders, action history, settings, sync state, AI conversation history, Reply Pipeline lifecycle state, optional agent draft previews, security analysis snapshots, and optional semantic-search vectors in a local SQLite database under the user's application support directory.

## Credentials

Runtime credentials are not stored in the repository.

- Google OAuth client config is read from `~/.config/dumka-mail/google-oauth-client.json`.
- Optional AI provider credentials can be configured from Settings -> AI Configuration and are read from OS-backed credential storage or `~/.config/dumka-mail/ai.env`.
- OAuth refresh tokens are stored in the macOS Keychain on macOS. On Windows/Linux they are stored with Electron safeStorage under the app user-data directory when OS encryption is available; otherwise the app falls back to memory-only storage for that runtime.
- AI provider keys, built-in search provider keys, and custom MCP server environment/header values are stored outside SQLite when Keychain storage is enabled. SQLite stores only placeholders for those secrets.

## Network requests

The app talks directly to Gmail and to the AI provider selected by the user. If the user enables Calendar or Contacts in settings, the app also talks directly to Google Calendar and Google People APIs for the selected account. Mail content is only sent to an AI provider when the user enables AI features and allows the relevant context to be included. Interactive assistant chats can use a read-only local mailbox search tool; that tool searches only accounts in the current Operator scope and passes bounded result snippets/source metadata to the selected AI provider, not the full mailbox by default. A manually submitted chat may ask the provider to prepare typed reply-draft, reminder, archive, or existing-user-label proposals. Proposal mode exposes only read-only local mailbox search, even when external MCP tools are otherwise enabled. The main process accepts proposals only when they cite an exact source returned in the same request, rebuilds display data from the local cache, and places them in the durable Agent Review Queue. Proposal generation does not mutate Gmail, create an action-history entry, or send a drafted reply; approval and offline replay recheck the account, source message, latest thread state, and label before using the existing action path. The OpenAI Responses endpoint currently cannot bind proposals to mailbox-search tool output, so the app returns a capability warning and creates no proposals for that transport. Private Daily Briefing generation uses the local mail cache, local security analysis, and cached source snippets; it does not call an AI completion provider in the first implementation. The Today workspace consolidates local briefing, review queue, reply pipeline, calendar, cleanup, automation simulation, and action-history state without adding a new remote service. Its latest briefing, pending review plan, selection state, and reply lifecycle are persisted locally in SQLite; automatic refresh runs from the local cache after a successful Gmail sync and explicitly disables semantic/provider calls. Follow-up Radar is computed from the local Sent cache and feeds the Reply Pipeline together with inbound Daily Briefing signals. Preparing a pipeline draft calls the selected automation model only when proactive drafts and mail-body context are explicitly enabled; otherwise it creates a local deterministic template. Prepared replies are stored as ordinary local drafts, are never overwritten after user editing, and are never auto-sent. The mail rules simulator dry-runs cached threads locally and does not execute forward or auto-reply actions during simulation. Rules added manually or promoted from approved work start in shadow mode: matching is recorded in the local action history for monitoring, but no mailbox mutation or message send occurs until the user explicitly changes the rule to active. The Agent Review Queue turns local triage and briefing evidence into proposed actions that require explicit user approval before mailbox changes are applied. Approved queue actions flow through the existing local action history with source, risk, confidence, and citation metadata. If semantic search and the briefing semantic boost are both enabled, briefing generation can use the configured embeddings provider to query the local vector index. Proactive draft generation and semantic-search embeddings are disabled by default because they can use paid provider tokens. Semantic search uses the embeddings provider configured in Settings, supports local and cloud providers, and stores vectors locally. The local vector index is keyed by provider, model, endpoint, and dimensions; changing those settings does not reuse incompatible vectors, and Settings exposes controls to reindex or delete old vector rows. MCP and external search tools are disabled for AI requests by default; when the user opts in, they are available only to non-proposal interactive assistant requests, not background triage or proactive draft jobs.

## Google scopes

Initial account onboarding requests Gmail modify access plus Google profile/email scopes. Calendar and Contacts are incremental opt-ins:

- Calendar uses `https://www.googleapis.com/auth/calendar.events` for agenda sync, invite RSVP, and Google Meet event creation. Availability suggestions are calculated locally from cached calendar events.
- Contacts uses `https://www.googleapis.com/auth/contacts.readonly` for address-book sync. Local contact display-name edits, notes, and groups are stored in SQLite and are not written back to Google.

## Remote images

HTML mail may reference sender-hosted remote images. The app exposes a privacy setting for remote image loading, strips likely tracking pixels from rendered HTML, and stores local warning snapshots for suspicious tracking or phishing signals.

## Diagnostics

Diagnostics are disabled by default. Logs should not include secrets or raw tokens.
