# Learned Rules

Rules discovered by investigating real test failures.
Each rule is injected into the system prompt automatically.

<!-- rules-start -->
## Rule 001 — dialog handler must use page.on, not page.once or Promise.all([waitForEvent, click])
**Problem class**: Using `page.once('dialog', handler)` or `Promise.all([page.waitForEvent('dialog'), click()])` silently fails to catch the confirm dialog when a fixture-level route handler is active.
**Rule**: Always register dialog handlers with `page.on('dialog', handler)` before the triggering click, then call `await this.page.waitForTimeout(3000)` to let the AJAX response settle. Never use `page.once` or `waitForEvent('dialog')` for form-submit confirm dialogs.

## Rule 002 — strict-mode violation on ambiguous Home link
**Problem class**: After a successful form submission, the page shows both a nav "Home" link and a green `btn-success` "Home" button. `getByRole('link', { name: /home/i })` matches both and throws a strict-mode violation.
**Rule**: When a page has multiple links with the same accessible name, always use a more specific selector. For the post-submission Home button on automationexercise.com use `page.locator('a.btn-success[href="/"]')` rather than a role-based locator.

## Rule 003 — Bootstrap 3 carousel slides are hidden to Playwright's visibility check
**Problem class**: On automationexercise.com, the `#slider` carousel wraps all `.item` slide elements inside a `.carousel-inner` container with `overflow: hidden`. Playwright's `toBeVisible()` reports every `.item` as hidden because the overflow clip makes them appear outside the visible area, even the active one during a CSS transition.
**Rule**: Never assert `toBeVisible()` on Bootstrap 3 carousel `.item` or `.item.active` elements. To verify the carousel loaded, check the container is visible (`#slider`) and use `toBeAttached()` on the slide images: `expect(page.locator('#slider .item img').first()).toBeAttached()`.

## Rule 004 — #slider .active causes strict-mode violation due to carousel indicators
**Problem class**: The `.active` class is applied to both the currently visible carousel slide div AND the matching indicator `<li>` dot. Locating `#slider .active` therefore resolves to two elements and throws a Playwright strict-mode violation.
**Rule**: Never use `#slider .active` as a locator. To target a specific slide element, include the tag or a distinguishing class, e.g. `#slider .item.active` or `#slider div.active`. Better still, avoid the active-state check entirely and use `toBeAttached()` on slide images (see Rule 003).

## Rule 005 — Calling a method on a POM class that does not define it causes a runtime TypeError
**Problem class**: Calling a method on a POM class that does not define it causes a runtime TypeError.
**Rule**: Before calling any POM method in a test, verify the method is actually defined in the corresponding page class. When adding new test scenarios that rely on shared page objects, ensure all required methods (e.g. verifyLoaded, proceedToCheckout) are present in the POM class.

## Rule 006 — waitForLoadState('load') consistently times out on automationexercise.com
**Problem class**: automationexercise.com serves third-party analytics and ad scripts that are not fully blocked by the ad-blocker fixture. The browser `load` event therefore never fires within Playwright's 30-second timeout, causing any `waitForLoadState('load')` or `page.goto(url)` without `waitUntil` to time out even when the page is fully interactive.
**Rule**: On automationexercise.com, use `'domcontentloaded'` instead of `'load'` in all `waitForLoadState()` calls inside POM methods, and pass `{ waitUntil: 'domcontentloaded' }` to any direct `page.goto()` call inside spec files. Rule 001 (always wait for a load state after navigation) still applies — only the event name changes for this site.
**Critical distinction**: `{ waitUntil: 'domcontentloaded' }` is an options object for `page.goto()` only. Never pass it to `this.navigate()` — BasePage.navigate() has the signature `navigate(path: string, dismissOnLoad?: boolean)` and handles waitForLoadState internally. Passing an object as the second argument is a type error. Correct: `await this.navigate('/products');` Wrong: `await this.navigate('/products', { waitUntil: 'domcontentloaded' });`

## Rule 007 — automationexercise.com API always returns HTTP 200 — never assert a non-200 HTTP status code
**Problem class**: API tests asserting HTTP status codes other than 200 fail because automationexercise.com always returns HTTP 200 at the transport level. Error codes are embedded in the JSON response body as responseCode.
**Rule**: For all automationexercise.com API endpoints, always assert expect(response.status()).toBe(200) at the HTTP level, then check the application-level status inside the body: const body = await response.json(); expect(body.responseCode).toBe(405). Never assert response.status() to be 400, 404, 405, or 201 — these values only appear as body.responseCode. The only exception: POST /api/createAccount has body.responseCode 201 but still returns HTTP 200.

## Rule 008 — .toBeOneOf() does not exist in Playwright or Jest
**Problem class**: Using a non-existent custom matcher (toBeOneOf) that is not part of Playwright's or Jest's built-in assertion library.
**Rule**: Never use `.toBeOneOf()` — it is not a built-in Playwright/Jest matcher. To assert a value is one of several allowed values, use `expect([...allowedValues]).toContain(actualValue)` instead.

## Rule 009 — test.describe() requires a callback function, not a plain object
**Problem class**: Passing a plain object instead of a callback function to `test.describe()`, causing a runtime TypeError.
**Rule**: Always pass a callback function (arrow function or named function) as the second argument to `test.describe()`. Never pass a plain object of test functions — each test must be registered inside the callback via individual `test()` calls.

## Rule 010 — Never include markdown fences in TypeScript source files
**Problem class**: Markdown code fences (```typescript ... ```) embedded as literal content inside a .ts file cause immediate TypeScript parse errors because they are not valid TypeScript syntax.
**Rule**: API test files must contain only valid TypeScript — never include markdown fences, prose explanations, or any non-TypeScript content in .ts files.

## Rule 011 — API auth tests must create a real account before testing valid login
**Problem class**: Using invented or placeholder credentials in a test that calls /api/verifyLogin expecting success causes a 404 response because those accounts do not exist on the live site.
**Rule**: Any test verifying successful login MUST create a real test account via POST /api/createAccount in test.beforeAll, use those credentials in the test, and delete the account in test.afterAll. Never use hardcoded or invented credentials against a live site.

## Rule 012 — The automationexercise.com getUserDetailByEmail response uses birth_day not birth_date
**Problem class**: Asserting the field name birth_date in the getUserDetailByEmail API response fails because the actual field name returned by the server is birth_day.
**Rule**: When asserting fields in the automationexercise.com GET /api/getUserDetailByEmail response, use birth_day (not birth_date). Always verify exact field names against a real response before writing assertions.

## Rule 013 — product.category in automationexercise.com API is a nested object, not a string
**Problem class**: Calling String() or .toLowerCase() directly on body.products[n].category fails because the field is a nested object { usertype: { usertype: "Women" }, category: "Tops" }, not a primitive string.
**Rule**: Never treat product.category as a string. To read the category name, use product.category.category. When asserting search results, do not validate each product's category text — assert only that the array is non-empty.

## Rule 014 — The duplicate email registration error message is "Email already exists!" with a trailing s
**Problem class**: The automationexercise.com POST /api/createAccount endpoint returns the message "Email already exists!" (with an s at the end) when the email is already registered.
**Rule**: When asserting the duplicate-email error from /api/createAccount, always use the exact string: expect(body.message).toBe('Email already exists!') — note the trailing s.

## Rule 015 — Wrong relative path from test file to shared test-data directory causes ENOENT at runtime
**Problem class**: Wrong relative path from test file to shared test-data directory causes ENOENT at runtime.
**Rule**: When resolving paths to shared test fixtures (uploads, test data files), always count the directory depth from the spec file to the project root correctly. Spec files in `tests/ui/` are two levels deep, so the path to `test-data/` at the project root requires `../../test-data/`, not `../test-data/`.

## Rule 016 — Never use waitForTimeout to wait for element state changes
**Problem class**: Using `page.waitForTimeout(N)` to wait for an element to disappear, appear, or change state causes flaky tests — the hardcoded delay is either too short on slow runners or wastes time on fast ones.
**Rule**: Always use the element's own `.waitFor({ state: 'detached' | 'hidden' | 'visible' })` method instead. For example, after removing a cart row: `await row.waitFor({ state: 'detached' })`. Only use `waitForTimeout` for the specific dialog-handling pattern documented in the system prompt.

## Rule 017 — Always validate DOM text before parsing numbers
**Problem class**: Calling `parseInt(textContent.replace(/[^\d]/g, ''), 10)` on text that is empty, null, or non-numeric (e.g. "Out of stock") silently returns `NaN`. Assertions then fail with confusing messages like "Expected NaN to be greater than 0".
**Rule**: Before calling `parseInt` or `parseFloat` on text extracted from the DOM, validate it matches the expected format. Use a guard: `if (!text.match(/\d+/)) throw new Error(\`Unexpected price format: "${text}"\`);` This converts silent NaN failures into clear, actionable errors.

## Rule 018 — A required setup step throws a hard error when optional environment variables are absent
**Problem class**: A required setup step throws a hard error when optional environment variables are absent, causing the entire setup suite to fail even for tests that don't need those credentials.
**Rule**: When a setup step depends on optional environment variables (e.g. credentials for a logged-in session), gracefully skip or degrade rather than throwing — write a fallback empty storage state file and log a warning, so the setup suite as a whole can still complete for tests that don't require that state.

## Rule 019 — Missing import statements cause ReferenceError for test and expect in spec files
**Problem class**: Missing import statements cause ReferenceError for `test` and `expect` in spec files.
**Rule**: Every spec file must start with `import { test, expect } from '../../fixtures';` (adjusting the relative path to the project root). Never reference `test` or `expect` without importing them, even in API test files.

## Rule 020 — Asserting the wrong field name on an API response object
**Problem class**: Asserting the wrong field name on an API response object without verifying the actual response shape first.
**Rule**: Before asserting specific field names on an API response, inspect a real response to confirm the exact field names. For the automationexercise.com `/api/brandsList` endpoint, each brand object uses the field `brand` (not `name`) to hold the brand name string.

## Rule 021 — Confirm nav/counter elements exist before testing them
**Problem class**: Generating tests for nav badge or counter elements that may not exist on the specific site under test.
**Rule**: Before writing assertions against nav counters, cart badges, or notification indicators, use inspect_page to confirm the element exists in the live DOM. Standard e-commerce badge patterns don't apply universally — always verify with real DOM output first.

## Rule 022 — API tests must use requestWithRetry for all setup calls in beforeAll
**Problem class**: Demo/practice sites return transient 503 (Service Unavailable), 521/522 (Cloudflare origin unreachable), or redirect loops under CI load. A single failed `request.post` in `beforeAll` cascades to all dependent tests because Playwright's per-test retry does not re-run `beforeAll`.
**Rule**: Every `request.post` / `request.put` / `request.delete` call inside `beforeAll` must be wrapped with a `requestWithRetry` helper. Redirect loops throw exceptions rather than returning a status code, so the helper must use try/catch, not just status code checks. Always add `test.describe.configure({ timeout: 120_000 })` to any describe block with a `beforeAll` that creates accounts. Include this helper at the top of every API spec file:
```typescript
const TRANSIENT_CODES = new Set([502, 503, 521, 522, 524]);
async function requestWithRetry(requestFn: () => Promise<APIResponse>, maxAttempts = 3): Promise<APIResponse> {
  let lastErr: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await requestFn();
      if (!TRANSIENT_CODES.has(response.status()) || attempt === maxAttempts) return response;
    } catch (err: any) {
      lastErr = err; // catches redirect loops, connection resets, etc.
      if (attempt === maxAttempts) throw err;
    }
    await new Promise(r => setTimeout(r, 2000 * attempt));
  }
  throw lastErr ?? new Error('unreachable');
}
```

## Rule 023 — Visual tests must wait for images to be fully loaded before taking screenshots
**Problem class**: On CI, images inside the screenshot region may not have finished loading when the `waitFor({ state: 'visible' })` check passes. An unloaded image has incorrect height, which shifts surrounding layout and produces a different structural baseline.
**Rule**: Before calling `toHaveScreenshot()`, always wait for all images in the target region to be `complete` and have a non-zero `naturalHeight`:
```typescript
await page.waitForFunction(() =>
  [...document.querySelectorAll('#target-region img')].every(
    img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalHeight > 0
  )
);
```
Replace `#target-region` with the actual screenshot locator selector.

## Rule 024 — CSS selector confusion between an element having a class vs an element being a descendant of a class
**Problem class**: CSS selector confusion between an element having a class vs an element being a descendant of a class
**Rule**: When the target element is a child of the element bearing a specific class, always use a descendant selector (`.parent-class child-tag`) rather than a compound selector (`child-tag.parent-class`). Before writing any class-based locator, inspect the DOM to confirm which element actually carries the class.
<!-- rules-end -->
