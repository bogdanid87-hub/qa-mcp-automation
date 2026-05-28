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
<!-- rules-end -->
