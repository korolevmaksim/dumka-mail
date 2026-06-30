# Contributing

Thanks for taking the time to improve Dumka Mail.

## Development setup

```bash
npm install
npm run dev
```

## Checks

Run these before opening a pull request:

```bash
npm test
npm run build
npm audit --audit-level=moderate
```

There is no configured linter yet. Type errors are caught by `npm run build`.

## Privacy and fixtures

Do not commit:

- Real mailbox content.
- Screenshots that show real email subjects, senders, or bodies.
- OAuth client files, refresh tokens, cookies, API keys, or `.env` files.
- SQLite databases or generated app caches.

Use neutral fixture names and reserved domains such as `example.com`.

## Git metadata

Public commits should use the GitHub noreply author address configured for this repository:

```bash
git config user.name "Maksim Korolyov"
git config user.email "4609340+korolevmaksim@users.noreply.github.com"
```
