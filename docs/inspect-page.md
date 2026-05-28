# inspect\_page

Navigates to one or more pages headlessly and extracts every meaningful DOM element
with its best Playwright locator. Use this to understand what's on a page before
deciding what to test or how to build a POM.

---

## When to use it

- You're about to write a test for a page you're not familiar with and want to see
  what elements and locators are available
- You're debugging a locator failure and want to see what the page actually contains
- You want to check whether a `data-qa` attribute exists before writing a locator

> **If you're about to call `generate_test`**, you don't need to call `inspect_page`
> separately — pass the pages via `page_paths` and the tool inspects them
> automatically as part of generation.

---

## What it returns

For each page, the output includes:

- **Headings** — all `h1`–`h4` text, useful for understanding page structure
- **Forms** — id, action, method for each `<form>`
- **Elements** — every element with a `data-qa` attribute or `id`, plus nav links,
  alert/status elements, and file inputs; each entry shows its best locator and
  relevant attributes

Example output for `/login`:

```
## DOM snapshot: /login (Automation Exercise - Login)

### Headings
  - H2: "Login to your account"
  - H2: "New User Signup!"

### Forms
  - id="—" action="https://automationexercise.com/login" method="post"

### Elements (use these for locators — listed in priority order)
  - [data-qa="login-email"] [input] | type="email" | placeholder="Email Address"
  - [data-qa="login-password"] [input] | type="password" | placeholder="Password"
  - [data-qa="login-button"] [button] | text="Login"
  - [data-qa="signup-name"] [input] | placeholder="Name"
  - [data-qa="signup-email"] [input] | type="email" | placeholder="Email Address"
  - [data-qa="signup-button"] [button] | text="Signup"
```

---

## Usage

### From Claude Code

```
Inspect the page at /login
Inspect /login and /checkout
Inspect /products
```

### Parameter

| Parameter | Required | Description |
|-----------|----------|-------------|
| `paths` | yes | Page paths to inspect, e.g. `["/login", "/checkout"]` |

### There is no terminal CLI for this tool

`inspect_page` is only available through the MCP server (Claude Code chat). If you
want the raw DOM output in the terminal, you can run the underlying Playwright
inspection directly — but in practice `generate_pom` and `generate_test` cover the
common cases.

---

## Locator priority

The tool lists elements in the order you should prefer when writing locators:

1. `[data-qa="..."]` — always first; the site uses these consistently
2. `#id`
3. Named inputs, buttons, links without `data-qa`
4. Alert/status elements (`.alert-success`, etc.)
5. Nav links (`<a>` in navbar/header)
