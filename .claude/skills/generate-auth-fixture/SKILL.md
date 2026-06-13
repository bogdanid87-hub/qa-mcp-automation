---
name: generate-auth-fixture
description: Generates a Playwright auth fixture (form or OAuth login) — adds a global.setup.ts task, saves storage state, and adds a named fixture (generate_auth_fixture MCP tool / npm run generate_auth). Load when setting up or discussing pre-authenticated test fixtures.
---

# generate_auth_fixture

Generates a Playwright auth fixture for a login flow: a new setup task in
`tests/global.setup.ts` that authenticates and saves storage state to
`test-data/.auth/<name>.json`, a named fixture in `fixtures/index.ts` (e.g.
`loggedInPage`) any test can use to start pre-authenticated, and a `.gitignore`
entry for the storage state file. Run once per auth role (`loggedIn`, `admin`,
`premiumUser`).

## Why this matters

Without it, tests needing a logged-in user repeat the login flow in the test
body — slow, brittle, hard to maintain as auth changes. Storing auth state once in
`global.setup.ts` and sharing it via a fixture means login happens once per test
run.

## Usage

```
Generate an auth fixture for the login page at /login.
The email input is [data-qa="login-email"], password is [data-qa="login-password"],
submit is [data-qa="login-button"]. Call the fixture "loggedIn".
Store credentials in TEST_EMAIL and TEST_PASSWORD env vars.
```

```bash
npm run generate_auth   # interactive — prompts for missing values

npm run generate_auth -- \
  --type form --name loggedIn --login-url /login \
  --email-selector '[data-qa="login-email"]' \
  --password-selector '[data-qa="login-password"]' \
  --submit-selector '[data-qa="login-button"]' \
  --success '/dashboard' \
  --username-env TEST_EMAIL --password-env TEST_PASSWORD
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `type` | no | `form` (default) or `oauth` |
| `name` | yes | Fixture name, e.g. `loggedIn` — becomes `<name>Page` in tests |
| `loginUrl` | yes | Login page path or full URL |
| `emailSelector` / `passwordSelector` / `submitSelector` | no | Selectors for the login form |
| `successIndicator` | no | URL pattern or selector confirming successful login |
| `usernameEnvVar` / `passwordEnvVar` | no | Env vars holding credentials, e.g. `TEST_EMAIL`/`TEST_PASSWORD` |
| `notes` | no | Extra context — e.g. "MFA step shown after password" |

## What gets updated automatically

| File | Change |
|---|---|
| `tests/global.setup.ts` | New setup task appended (shared imports, not duplicated) |
| `fixtures/index.ts` | New fixture property + `PageFixtures` type entry |
| `.gitignore` | Storage state path added |

Generated setup task uses `'domcontentloaded'` (per
[qa-conventions](../qa-conventions/SKILL.md#navigation)) and saves
`context.storageState({ path: 'test-data/.auth/<name>.json' })`. The fixture entry
creates a new browser context with that storage state.

## After generation

1. **Create a persistent test account** — credentials must survive between runs.
   If tests create/delete accounts in `beforeAll`, use a separate dedicated account
   for the auth fixture, not a throwaway one.
2. **Add credentials to `.env`** (never commit): `TEST_EMAIL=...`, `TEST_PASSWORD=...`
3. **Run the setup**: `npx playwright test --project=setup` — saves
   `test-data/.auth/<name>.json` (gitignored). Re-run when credentials change or
   the site clears sessions.
4. **Use the fixture**: `test('...', async ({ loggedInPage }) => { ... })` — already
   logged in, no login step needed.

## Notes

- Storage state files are automatically gitignored.
- Credentials are always read from env vars — `safeWrite`'s secret scan (see
  [docs/conventions.md](../../../docs/conventions.md#safe-writes--srclibsafe-writets))
  refuses to write generated `.ts`/`.tsx` files containing the literal value of
  `TEST_EMAIL`/`TEST_PASSWORD` as a backstop.
- The setup task name must be unique from `'save guest storage state'`.
- For OAuth redirect flows, set `type: oauth` and describe the flow in `notes`.

Full guide: [docs/generate-auth-fixture.md](../../../docs/generate-auth-fixture.md)
