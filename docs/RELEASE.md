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
