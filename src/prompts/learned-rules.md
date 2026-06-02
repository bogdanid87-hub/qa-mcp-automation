# Learned Rules

Rules discovered by investigating real test failures.
Each rule is injected into the system prompt automatically.

<!-- rules-start -->
## Rule 001 — jQuery handler timing after link-click navigation
**Problem class**: Clicking a nav link to reach a page and then immediately interacting causes form JavaScript (e.g. jQuery submit handlers from inline `<script>` tags) to not be attached yet because the `load` event hasn't fired.
**Rule**: After any `click()` that triggers a full-page navigation (link clicks, button-driven navigation), always call `await this.page.waitForLoadState('load')` inside the POM method before returning — never rely on the next assertion to act as an implicit wait.

## Rule 002 — dialog handler must use page.on, not page.once or Promise.all([waitForEvent, click])
**Problem class**: Using `page.once('dialog', handler)` or `Promise.all([page.waitForEvent('dialog'), click()])` silently fails to catch the confirm dialog when a fixture-level route handler is active.
**Rule**: Always register dialog handlers with `page.on('dialog', handler)` before the triggering click, then call `await this.page.waitForTimeout(3000)` to let the AJAX response settle. Never use `page.once` or `waitForEvent('dialog')` for form-submit confirm dialogs.

## Rule 003 — strict-mode violation on ambiguous Home link
**Problem class**: After a successful form submission, the page shows both a nav "Home" link and a green `btn-success` "Home" button. `getByRole('link', { name: /home/i })` matches both and throws a strict-mode violation.
**Rule**: When a page has multiple links with the same accessible name, always use a more specific selector. For the post-submission Home button on automationexercise.com use `page.locator('a.btn-success[href="/"]')` rather than a role-based locator.

## Rule 004 — Bootstrap 3 carousel slides are hidden to Playwright's visibility check
**Problem class**: On automationexercise.com, the `#slider` carousel wraps all `.item` slide elements inside a `.carousel-inner` container with `overflow: hidden`. Playwright's `toBeVisible()` reports every `.item` as hidden because the overflow clip makes them appear outside the visible area, even the active one during a CSS transition.
**Rule**: Never assert `toBeVisible()` on Bootstrap 3 carousel `.item` or `.item.active` elements. To verify the carousel loaded, check the container is visible (`#slider`) and use `toBeAttached()` on the slide images: `expect(page.locator('#slider .item img').first()).toBeAttached()`.

## Rule 005 — #slider .active causes strict-mode violation due to carousel indicators
**Problem class**: The `.active` class is applied to both the currently visible carousel slide div AND the matching indicator `<li>` dot. Locating `#slider .active` therefore resolves to two elements and throws a Playwright strict-mode violation.
**Rule**: Never use `#slider .active` as a locator. To target a specific slide element, include the tag or a distinguishing class, e.g. `#slider .item.active` or `#slider div.active`. Better still, avoid the active-state check entirely and use `toBeAttached()` on slide images (see Rule 004).

## Rule 006 — Tests that assert negative behavior (e
**Problem class**: Tests that assert negative behavior (e.g. duplicate rejection) against a third-party site without first verifying the site actually enforces that constraint will fail when the site's real behavior differs from the assumption.
**Rule**: Before writing a test that asserts a site rejects or blocks a particular input (e.g. duplicate emails, invalid states), manually verify the site actually enforces that constraint; if it does not, write the test to document the real behavior instead of the assumed ideal behavior.

## Rule 007 — Calling a method on a POM class that does not define it causes a runtime TypeError
**Problem class**: Calling a method on a POM class that does not define it causes a runtime TypeError.
**Rule**: Before calling any POM method in a test, verify the method is actually defined in the corresponding page class. When adding new test scenarios that rely on shared page objects, ensure all required methods (e.g. verifyLoaded, proceedToCheckout) are present in the POM class.

## Rule 008 — Mismatched import style (default vs named export) causes the imported value to be undefined, breaking class inheritance
**Problem class**: Mismatched import style (default vs named export) causes the imported value to be undefined, breaking class inheritance.
**Rule**: Always match the import style to the export style: use `import { BasePage } from './BasePage'` for named exports and `import BasePage from './BasePage'` only for default exports. When BasePage uses a named export, all page classes must use the named import form.

## Rule 009 — waitForLoadState('load') consistently times out on automationexercise.com
**Problem class**: automationexercise.com serves third-party analytics and ad scripts that are not fully blocked by the ad-blocker fixture. The browser `load` event therefore never fires within Playwright's 30-second timeout, causing any `waitForLoadState('load')` or `page.goto(url)` without `waitUntil` to time out even when the page is fully interactive.
**Rule**: On automationexercise.com, use `'domcontentloaded'` instead of `'load'` in all `waitForLoadState()` calls inside POM methods, and pass `{ waitUntil: 'domcontentloaded' }` to any direct `page.goto()` call inside spec files. Rule 001 (always wait for a load state after navigation) still applies — only the event name changes for this site.

## Rule 010 — test.describe() name must be the feature area, not the test scenario
**Problem class**: When test_name was used as a hint for both the filename and the describe block, describe names became scenario-specific (e.g. "Place Order: Register while Checkout") and could not accommodate additional related tests without creating misleading groupings.
**Rule**: Name `test.describe()` with the broad feature area or user goal — "Place Order", "Cart", "Authentication" — not with the specific scenario being tested. The specific scenario belongs in the `test()` name. This allows multiple variants to share the same describe block and keeps the test hierarchy meaningful as the suite grows.


## Rule 011 — automationexercise.com API always returns HTTP 200 — never assert a non-200 HTTP status code
**Problem class**: API tests asserting HTTP status codes other than 200 (e.g. expect(response.status()).toBe(405)) fail because automationexercise.com always returns HTTP 200 at the transport level regardless of the outcome. Error codes are embedded in the JSON response body as responseCode.
**Rule**: For all automationexercise.com API endpoints, always assert expect(response.status()).toBe(200) at the HTTP level, then check the application-level status inside the body: const body = await response.json(); expect(body.responseCode).toBe(405). Never assert response.status() to be 400, 404, 405, or 201 — these values only appear as body.responseCode. The only exception: POST /api/createAccount has body.responseCode 201 but still returns HTTP 200.

## Rule 012 — .toBeOneOf() does not exist in Playwright or Jest
**Problem class**: Using a non-existent custom matcher (toBeOneOf) that is not part of Playwright's or Jest's built-in assertion library.
**Rule**: Never use `.toBeOneOf()` — it is not a built-in Playwright/Jest matcher. To assert a value is one of several allowed values, use `expect([...allowedValues]).toContain(actualValue)` instead.

## Rule 013 — test.describe() requires a callback function, not a plain object
**Problem class**: Passing a plain object instead of a callback function to `test.describe()`, causing a runtime TypeError.
**Rule**: Always pass a callback function (arrow function or named function) as the second argument to `test.describe()`. Never pass a plain object of test functions — each test must be registered inside the callback via individual `test()` calls.

## Rule 014 — Never include markdown fences in TypeScript source files
**Problem class**: Markdown code fences (```typescript ... ```) embedded as literal content inside a .ts file cause immediate TypeScript parse errors because they are not valid TypeScript syntax.
**Rule**: API test files must contain only valid TypeScript — never include markdown fences, prose explanations, or any non-TypeScript content in .ts files.

## Rule 015 — API auth tests must create a real account before testing valid login
**Problem class**: Using invented or placeholder credentials (e.g. 'adam@adam.com', 'valid@example.com') in a test that calls /api/verifyLogin expecting success causes a 404 response because those accounts do not exist on the live site.
**Rule**: Any test verifying successful login MUST create a real test account via POST /api/createAccount in test.beforeAll, use those credentials in the test, and delete the account in test.afterAll. Never use hardcoded or invented credentials against a live site.

## Rule 016 — The automationexercise.com getUserDetailByEmail response uses birth_day not birth_date
**Problem class**: Asserting the field name birth_date in the getUserDetailByEmail API response fails because the actual field name returned by the server is birth_day.
**Rule**: When asserting fields in the automationexercise.com GET /api/getUserDetailByEmail response, use birth_day (not birth_date). Always verify exact field names against a real response before writing assertions.
## Rule 017 — Using || between two expect() calls produces a TypeScript void error
**Problem class**: Writing `expect(a).toContain('x') || expect(b).toContain('x')` to express an OR assertion fails TypeScript compilation because expect() returns void, not boolean. `void || void` is not valid.
**Rule**: To assert "A or B", use a boolean expression: `expect(a.includes('x') || b.includes('x')).toBe(true)`. Never use `||` or `&&` between `expect()` calls — they return void and cannot be combined with logical operators.
## Rule 018 — product.category in automationexercise.com API is a nested object, not a string
**Problem class**: Calling String() or .toLowerCase() directly on body.products[n].category fails because the field is a nested object { usertype: { usertype: "Women" }, category: "Tops" }, not a primitive string. Stringifying it produces "[object object]".
**Rule**: Never treat product.category as a string. To read the category name, use product.category.category. When asserting search results, do not validate each product's category text — assert only that the array is non-empty.

## Rule 019 — The duplicate email registration error message is "Email already exists!" with a trailing s
**Problem class**: The automationexercise.com POST /api/createAccount endpoint returns the message "Email already exists!" (with an s at the end) when the email is already registered. Tests asserting "Email already exist!" (without the s) fail with a message mismatch.
**Rule**: When asserting the duplicate-email error from /api/createAccount, always use the exact string: expect(body.message).toBe('Email already exists!') — note the trailing s.

## Rule 020 — Wrong relative path from test file to shared test-data directory causes ENOENT at runtime
**Problem class**: Wrong relative path from test file to shared test-data directory causes ENOENT at runtime.
**Rule**: When resolving paths to shared test fixtures (uploads, test data files), always count the directory depth from the spec file to the project root correctly. Spec files in `tests/ui/` are two levels deep, so the path to `test-data/` at the project root requires `../../test-data/`, not `../test-data/`.
## Rule 021 — Never use waitForTimeout to wait for element state changes
**Problem class**: Using `page.waitForTimeout(N)` to wait for an element to disappear, appear, or change state causes flaky tests — the hardcoded delay is either too short on slow runners or wastes time on fast ones.
**Rule**: Always use the element's own `.waitFor({ state: 'detached' | 'hidden' | 'visible' })` method instead. For example, after removing a cart row: `await row.waitFor({ state: 'detached' })`. Only use `waitForTimeout` for the specific dialog-handling pattern documented in the system prompt.

## Rule 022 — Always validate DOM text before parsing numbers
**Problem class**: Calling `parseInt(textContent.replace(/[^\d]/g, ''), 10)` on text that is empty, null, or non-numeric (e.g. "Out of stock") silently returns `NaN`. Assertions then fail with confusing messages like "Expected NaN to be greater than 0".
**Rule**: Before calling `parseInt` or `parseFloat` on text extracted from the DOM, validate it matches the expected format. Use a guard: `if (!text.match(/\d+/)) throw new Error(\`Unexpected price format: "${text}"\`);` This converts silent NaN failures into clear, actionable errors.
<!-- rules-end -->
