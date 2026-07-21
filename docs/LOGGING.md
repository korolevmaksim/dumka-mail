# Application Logging

Dumka Mail stores structured application events locally in the same SQLite database as the mailbox cache. The feature does not create a text log file and does not upload events.

Open **Settings -> Logging** and choose **Show Logs** to inspect the live event stream. The viewer supports:

- `Info`, `Warning`, and `Error` severity filters;
- source filtering for subsystems such as Mailbox Sync, Action Sync, Semantic Index, and MCP;
- message search, pause/resume, refresh, and older-event pagination;
- expandable structured details;
- explicit local-log clearing.

## Retention

Settings exposes both a time retention period and a maximum record count. A record is removed when either limit is exceeded. Cleanup runs on application startup, after a logging-settings change, and periodically while new events are written. The default is 14 days with a 25,000-record ceiling.

## Privacy

Log messages are bounded and normalized before persistence. Credential-shaped fields, bearer tokens, and API-key patterns are always removed. With **Privacy -> Redact Logs** enabled (the default), email addresses and home-directory usernames are masked. Diagnostic events should contain operational counts, durations, states, and stable subsystem names; they must not include message bodies, prompts, access tokens, OAuth payloads, or raw provider responses.

The renderer receives logs only through narrow context-isolated IPC methods. IPC handlers validate the sender before returning or clearing local records.
