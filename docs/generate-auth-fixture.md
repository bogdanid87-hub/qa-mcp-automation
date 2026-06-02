# generate\_auth\_fixture

Generates a Playwright auth fixture for a login flow. Produces:

1. A new setup task in `tests/global.setup.ts` that authenticates and saves browser
   storage state to `test-data/.auth/<name>.json`
2. A named fixture entry in `fixtures/index.ts` (e.g. `loggedInPage`) that any test
   can use to start pre-authenticated
3. A `.gitignore` entry for the storage state file

Run this once per auth role your tests need (e.g. `loggedIn`, `admin`, `premiumUser`).

---

## Why this matters

Without this tool, tests that need a logged-in user must repeat the login flow inside
the test body — slow, brittle, and hard to maintain as auth changes. Storing auth
state once in `global.setup.ts` and sharing it via a fixture means the login happens
once per test run, and tests stay focused on what they're actually testing.

---

## Usage

### From Claude Code

```
Generate an auth fixture for the login page at /login.
The email input is [data-qa="login-email"], password is [data-qa="login-password"],
submit is [data-qa="login-button"]. Call the fixture "loggedIn".
Store credentials in TEST_EMAIL and TEST_PASSWORD env vars.
```

### From the terminal

```bash
# Interactive (prompts for missing values)
npm run generate_auth

# Non-interactive
npm run generate_auth -- \
  --type form \
  --name loggedIn \
  --login-url /login \
  --email-selector '[data-qa="login-email"]' \
  --password-selector '[data-qa="login-password"]' \
  --submit-selector '[data-qa="login-button"]' \
  --success '/dashboard' \
  --username-env TEST_EMAIL \
  --password-env TEST_PASSWORD
```

Run `npm run generate_auth -- --help` for all options.

---

## Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `type` | no | `form` (default) or `oauth` |
| `name` | yes | Fixture name, e.g. `loggedIn`, `admin` — becomes `<name>Page` in tests |
| `loginUrl` | yes | Login page path or full URL |
| `emailSelector` | no | CSS / data-qa selector for the email or username input |
| `passwordSelector` | no | CSS / data-qa selector for the password input |
| `submitSelector` | no | CSS / data-qa selector for the submit button |
| `successIndicator` | no | URL pattern or selector confirming successful login |
| `usernameEnvVar` | no | Env var holding the username, e.g. `TEST_EMAIL` |
| `passwordEnvVar` | no | Env var holding the password, e.g. `TEST_PASSWORD` |
| `notes` | no | Extra context — e.g. "login form is inside an iframe", "MFA step shown after password" |

---

## What gets generated

### `tests/global.setup.ts` — new task appended

```typescript
setup('save loggedIn storage state', async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('/login');
  await page.locator('[data-qa="login-email"]').fill(process.env.TEST_EMAIL!);
  await page.locator('[data-qa="login-password"]').fill(process.env.TEST_PASSWORD!);
  await page.locator('[data-qa="login-button"]').click();
  await page.waitForLoadState('domcontentloaded');

  await context.storageState({ path: 'test-data/.auth/loggedIn.json' });
  await browser.close();
});
```

### `fixtures/index.ts` — fixture entry added

```typescript
loggedInPage: async ({ browser }, use) => {
  const context = await browser.newContext({
    storageState: 'test-data/.auth/loggedIn.json',
  });
  const page = await context.newPage();
  await use(page);
  await context.close();
},
```

### `.env` additions

```
TEST_EMAIL=your-test-account@example.com
TEST_PASSWORD=your-test-password
```

---

## After generation

1. Add the env vars to your `.env` file (never commit credentials)
2. Run the setup to generate the storage state file:
   ```bash
   npx playwright test --project=setup
   ```
3. Use the fixture in tests:
   ```typescript
   test('should show dashboard', async ({ loggedInPage }) => {
     // already logged in — no login step needed
     await expect(loggedInPage).toHaveURL(/dashboard/);
   });
   ```

---

## Notes

- Storage state files are automatically gitignored
- Credentials are always read from env vars — never hardcoded
- The setup task name must be unique from `'save guest storage state'`
- If the login page uses OAuth redirect, set `type: oauth` and describe the flow
  in `notes` — Claude will generate the appropriate redirect-handling setup
