# Release Builds

Dumka Mail has two macOS release paths:

- Local unsigned builds for development and QA.
- Signed and notarized builds for distribution.

## Local unsigned builds

Use these commands for local validation without Apple credentials:

```bash
npm run package:mac
npm run dist:mac
```

These commands set `CSC_IDENTITY_AUTO_DISCOVERY=false` so electron-builder does not try to auto-select a local signing identity during normal development.

Windows and Linux package commands are also available:

```bash
npm run package:win
npm run dist:win
npm run package:linux
npm run dist:linux
```

Windows/Linux packages are not code-signed by default.

## Gmail quota regression checks

Gmail can return a temporary quota failure as HTTP 403 with `rateLimitExceeded`,
`userRateLimitExceeded`, or `RATE_LIMIT_EXCEEDED`, as well as HTTP 429. These
failures keep optimistic mail actions in `pending_sync` with a cooldown instead
of rolling them back. Ordinary permission and daily-limit 403 responses remain
distinct. Existing actions already marked `failed` are not replayed automatically.

History backfill requests pages of 20 threads with one detail request at a time,
at least three seconds between requests per account. Full threads currently cost
120 quota units against the 6,000-unit per-user/minute quota, so this reserves
most of the budget for current mail and user actions. Mutations run immediately
and suspend backfill while active and for five seconds afterwards. A quota
response starts a shared per-account cooldown (at least one minute, increasing
on repeated failures, with jitter and support for `Retry-After`). Mutations
during cooldown are queued locally without another remote request. A failed
backfill detail request leaves the page cursor unchanged; only HTTP 404 threads
may be skipped.

References: [Gmail quotas](https://developers.google.com/workspace/gmail/api/reference/quota)
and [Gmail error handling](https://developers.google.com/workspace/gmail/api/guides/handle-errors).

Run `tests/actionReconciler.test.ts`, `tests/gmailBackgroundTraffic.test.ts`, and
`tests/gmailBackfillQuota.test.ts` before the full test suite and production build.
They cover quota parking/replay, permanent permission failures, cooldowns,
foreground priority, and preserving pagination after incomplete backfill pages.

## Calendar release QA

Calendar changes require an existing-profile migration check plus installed-app verification. Reauthorize Calendar after upgrading so the CalendarList read scope is granted, verify at least one secondary calendar and a read-only calendar, then test cached restart, all six views, create/edit/delete and recurring scopes, `.ics` preview import/export, mail-to-event/source-mail navigation, offline queue replay, and a native reminder. Unsigned macOS development packages may have OS-level notification limitations; release evidence should use the installed application rather than only the Vite renderer.

## Signed and notarized macOS build

Run preflight before a distribution build:

```bash
npm run release:preflight:mac
```

Required signing environment:

- `CSC_LINK` or `CSC_NAME`
- `CSC_KEY_PASSWORD` when `CSC_LINK` is used

Required notarization environment, one of:

- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
- `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`

Build the signed and notarized DMG:

```bash
npm run dist:mac:signed
```

The signed build uses `build/electron-builder.signed.cjs`, hardened runtime, and the entitlement files in `build/`.

Do not commit certificates, app-specific passwords, API keys, provisioning files, or notarization logs containing account data.

## Auto-updates

Dumka Mail uses Electron's built-in `autoUpdater` module and does not ship a bundled update service. Update checks are disabled unless a feed base URL is provided at runtime:

```bash
DUMKA_UPDATE_FEED_URL=https://updates.example.com npm run dist:mac:signed
```

At runtime the app builds the feed URL as:

```text
<DUMKA_UPDATE_FEED_URL>/update/<platform>/<version>
```

The feed URL also supports explicit templates:

```text
https://updates.example.com/{platform}/feed/{version}
```

Electron's built-in updater supports macOS and Windows. Linux builds should be updated through the package manager or installer channel. macOS automatic updates require a signed distribution build.
