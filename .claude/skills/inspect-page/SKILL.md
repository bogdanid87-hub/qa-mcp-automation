---
name: inspect-page
description: Navigates to pages headlessly and extracts DOM elements with their best Playwright locators (inspect_page MCP tool). Load before writing a POM/test for an unfamiliar page, or when debugging a locator failure.
---

# inspect_page

Navigates to one or more pages headlessly and extracts every meaningful DOM
element with its best Playwright locator. Use this to understand what's on a page
before deciding what to test or how to build a POM.

## When to use it

- About to write a test for a page you're not familiar with and want to see what
  elements/locators are available
- Debugging a locator failure and want to see what the page actually contains
- Checking whether a `data-qa` attribute exists before writing a locator

> **If you're about to call `generate_test`**, you don't need to call
> `inspect_page` separately — pass the pages via `page_paths` and the tool
> inspects them automatically as part of generation (see
> [generate-test](../generate-test/SKILL.md)).

## Usage

MCP only — no terminal equivalent:

```
Inspect the page at /login
Inspect /login and /checkout
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `paths` | yes | Page paths to inspect, e.g. `["/login", "/checkout"]` |

## What it returns

Headings (`h1`–`h4`), forms (id/action/method), and every element with a
`data-qa` attribute or `id`, plus nav links, alert/status elements, and file
inputs — each with its best locator.

```
## DOM snapshot: /login (Automation Exercise - Login)

### Elements (use these for locators — listed in priority order)
  - [data-qa="login-email"] [input] | type="email" | placeholder="Email Address"
  - [data-qa="login-password"] [input] | type="password" | placeholder="Password"
  - [data-qa="login-button"] [button] | text="Login"
```

## Locator priority in the output

1. `[data-qa="..."]` — always first; the site uses these consistently
2. `#id`
3. Named inputs, buttons, links without `data-qa`
4. Alert/status elements (`.alert-success`, etc.)
5. Nav links (`<a>` in navbar/header)

This matches [qa-conventions](../qa-conventions/SKILL.md#locators)'s locator
priority order.

## Verifying locator uniqueness before using one

`inspect_page` snapshots ONE page and lists each element once — it does not tell
you whether a selector also matches elements in OTHER regions of the same page
(e.g. a carousel slide vs. carousel indicator, or a form's success alert vs. the
footer subscription alert, both `.alert-success.alert`). A locator that looks
unique in the snapshot can still collide at runtime.

Before finalizing a class-based or compound-class locator from this output:
- Apply [qa-conventions](../qa-conventions/SKILL.md#locators)'s "compound class
  can still collide" rule — scope to a unique ancestor container if there's any
  doubt (e.g. `#review-form .alert-success.alert`, not `.alert-success.alert`).
- When in doubt, check with `page.locator(selector).count()` against the live
  page rather than assuming the snapshot's single listing means single match.

The same check applies to locators written during `generate_test` — see
[generate-test](../generate-test/SKILL.md#locator-uniqueness).

Full guide: [docs/inspect-page.md](../../../docs/inspect-page.md)
