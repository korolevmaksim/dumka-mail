# Dependency maintenance

Verified against npm registry metadata on 2026-11-13. Direct packages are pinned
exactly, with the complete resolution committed in `package-lock.json`. No
prerelease packages are selected. Refresh the lockfile when changing versions;
use `npm ci` for CI and release builds.

## Selected versions

The table records manifest versions before and after this update. Release dates
are the selected version's npm publication dates (UTC).

| Package / registry source | Previous manifest | Selected stable | Published |
| --- | --- | --- | --- |
| [@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk) | 1.29.0 | 1.32.2 | 2026-10-23 |
| [better-sqlite3](https://www.npmjs.com/package/better-sqlite3) | 12.11.1 | 13.1.1 | 2026-11-11 |
| [@tailwindcss/vite](https://www.npmjs.com/package/@tailwindcss/vite) | 4.3.1 | 4.3.5 | 2026-11-06 |
| [@types/better-sqlite3](https://www.npmjs.com/package/@types/better-sqlite3) | 7.6.12 | 9.6.0 | 2026-08-01 |
| [@types/node](https://www.npmjs.com/package/@types/node) | 26.0.0 | 24.19.2 | 2026-10-09 |
| [@types/react](https://www.npmjs.com/package/@types/react) | 19.0.10 | 19.3.0 | 2026-09-09 |
| [@types/react-dom](https://www.npmjs.com/package/@types/react-dom) | 19.0.10 | 19.3.0 | 2026-09-09 |
| [@vitejs/plugin-react](https://www.npmjs.com/package/@vitejs/plugin-react) | 6.0.3 | 6.3.0 | 2026-11-09 |
| [electron](https://www.npmjs.com/package/electron) | 42.5.0 | 45.3.2 | 2026-11-13 |
| [electron-builder](https://www.npmjs.com/package/electron-builder) | 26.15.3 | 26.18.0 | 2026-10-20 |
| [lucide-react](https://www.npmjs.com/package/lucide-react) | 1.21.0 | 1.72.0 | 2026-11-11 |
| [react](https://www.npmjs.com/package/react) | 19.2.7 | 19.3.1 | 2026-10-14 |
| [react-dom](https://www.npmjs.com/package/react-dom) | 19.2.7 | 19.3.1 | 2026-10-14 |
| [tailwindcss](https://www.npmjs.com/package/tailwindcss) | 4.3.1 | 4.3.5 | 2026-11-06 |
| [typescript](https://www.npmjs.com/package/typescript) | 6.0.3 | 7.0.2 | 2026-07-08 |
| [vite](https://www.npmjs.com/package/vite) | 8.1.0 | 8.3.8 | 2026-11-11 |
| [vite-plugin-electron](https://www.npmjs.com/package/vite-plugin-electron) | 1.1.0 | 1.2.0 | 2026-10-31 |
| [vite-plugin-electron-renderer](https://www.npmjs.com/package/vite-plugin-electron-renderer) | 1.0.0 | 1.0.0 | 2026-05-31 |
| [vitest](https://www.npmjs.com/package/vitest) | 4.1.9 | 5.1.0 | 2026-11-02 |

`@types/node` stays on the latest Node 24 line, matching Electron's embedded
Node runtime and CI, rather than describing Node 26 APIs that may not exist at
runtime. Development requires Node >=22.12; CI uses Node 24.

The obsolete `@types/eventsource` and the direct `eventsource` package are
removed. The MCP SDK imports its own EventSource dependency in its SSE
transport; Dumka no longer overwrites the Node global. Real loopback SSE and
Streamable HTTP tests cover initialization, tool discovery and tool invocation.

## Security resolution

The initial full audit reported 27 vulnerable packages (11 moderate, 15 high,
1 critical). The updated full and production-only audits report zero known
vulnerabilities at verification time. This is a registry snapshot, not a promise
about future advisories.

The old `@hono/node-server: 2.0.11` override was removed because it prevented
normal resolution to a patched version. Compatible transitive packages were
refreshed with the lockfile, including the MCP HTTP/authentication and validation
dependencies.

The latest stable electron-builder still requests vulnerable minimatch 9/10.
A scoped version selector overrides only `minimatch@>=7.0.0 <11.0.1` to
**11.0.8**, published **2026-11-11**. It preserves the different callable API in
minimatch 3/5 used by older packaging helpers. Remove this override when upstream
constraints permit patched versions without it. Do not use `npm audit fix
--force`: its proposed downgrade to electron-builder 25 does not modernize the
build chain.

References: [minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249),
[minimatch release](https://github.com/isaacs/minimatch/releases/tag/v11.0.8).
Some older transitive packaging helpers are deprecated but retained by the
latest stable electron-builder; no audit exception or suppression is configured.

## Compatibility and validation

- Electron 45 removes Node module shims from sandboxed preload scripts. Our
  preload uses Electron IPC and browser-safe code; context isolation and the
  sandbox remain enabled. macOS 13 or newer is required by this Electron line.
- better-sqlite3 13 uses Node-API prebuilds. Validate database opening in both
  host Node and the packaged Electron runtime; no per-Electron ABI rebuild is
  required for this package. The application still packages it outside ASAR.
- TypeScript 7 uses the native compiler. `baseUrl` and its deprecation escape
  were removed; `paths` targets are relative. Vite aliases remain equivalent.
- Normal builds clear generated `dist` and `dist-electron` directories first,
  preventing obsolete hashed SDK chunks from surviving a dependency upgrade.
- Vite config uses `import.meta.dirname` instead of the config bundler's
  injected `__dirname`.

Run `npm ci`, `npm test`, `npm run build`, `npm run release:preflight`,
`npm audit --audit-level=moderate`, and `npm audit --omit=dev --audit-level=moderate`.
Before installation, package the exact pushed commit, verify native database
access and the artifact inventory, then launch the installed app. UI, SQLite
migrations and workers must work with existing profiles.

Upstream migration references:
[Electron 45](https://www.electronjs.org/blog/electron-45-0),
[better-sqlite3 13](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.0),
[TypeScript 7](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/),
[Vitest 5](https://vitest.dev/guide/migration/).
