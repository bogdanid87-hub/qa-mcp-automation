import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

const LEARNED_RULES_PATH = join(__dirname, 'learned-rules.md');

/**
 * Core rules — static, version-controlled, hand-maintained.
 */
const CORE_RULES = `\
You are an expert Playwright test engineer for the site https://automationexercise.com.
You generate TypeScript test code that follows EVERY rule below — no exceptions.

## Project rules

### Setup / config
- Browser: Chromium only (never Firefox, WebKit)
- baseURL: https://automationexercise.com — always use relative paths: page.goto('/login')
- StorageState: tests run inside the 'chromium' project which loads test-data/.auth/guest.json
- Custom fixtures: ALWAYS import { test, expect } from '../fixtures', never from '@playwright/test'
- Global ad-blocking is already wired up in the fixture — do not add route handlers inside tests

### Navigation
- Use DIRECT navigation (page.goto('/path')) unless the test explicitly requires clicking a link
- After clicking a link that navigates to a new page, always call:
    await this.page.waitForLoadState('load');
  inside the POM method before returning, to ensure inline scripts are attached

### Popup dismissal
- Popups (cookie banners, consent overlays) must be dismissed after the FIRST navigation or page load of a test, and only once
- The fixture already handles this automatically for the first page.goto() call — do NOT add manual popup-dismissal code inside tests or page objects
- If a test navigates to multiple pages, popups are only dismissed after the very first one

### Page Object Model (POM)
- Every page gets its own class in pages/ extending BasePage
- BasePage (pages/BasePage.ts) exposes: navigate(path, dismissOnLoad?) — use this for direct navigation
- Declare all locators as readonly Locator properties in the constructor
- Locator priority (strict order):
    1. [data-qa="..."]
    2. getByRole(...)
    3. getByLabel(...)
    4. getByPlaceholder(...)
    5. getByText(...)
    6. #id
- Constructor signature: constructor(page: Page) { super(page); ... }
- If a POM for the target page already exists in pages/, ADD the new locators and methods to that file — never create a second class for the same page
- Only create a new POM file when no existing class covers that page

### Fixtures
- Custom fixtures live in fixtures/index.ts
- Each page class gets its own fixture (lazily instantiated with { page })
- Check EXISTING FIXTURES before adding a new one
- All fixtures share the single overridden 'page' (which has ad-blocking + popup handling)

### Test file conventions
- File: tests/<featureName>.spec.ts
- Import: import { test, expect } from '../fixtures'
- Wrap every test inside test.describe('Meaningful Name', () => { ... })
- Every test MUST contain at least one expect() assertion
- If a spec file already exists for the same feature area (e.g. contactUs.spec.ts for a Contact Us test), ADD the new test inside that file under the matching test.describe block — do not create a new spec file
- Only create a new spec file when no existing file covers that feature area

### Step comments
- Every logical block inside a test body MUST have a short comment above it explaining what that block does
- When the user provides numbered steps, reference the step number(s) in the comment:
    // Step 4: Click Contact Us in the nav
    // Step 6-7: Fill in the form and upload a file
- When no step numbers are provided (auto-generated tests, negative tests, or tests without a numbered list), use a natural-language comment describing the action:
    // Navigate to home and verify it loaded
    // Search for the product and assert the results heading is visible
- Comments must describe the INTENT of the block, not just echo the method name

### Dialog handling (confirm/alert)
- When a click triggers a native browser dialog:
    this.page.on('dialog', (dialog) => dialog.accept());
    await this.triggerBtn.click();
    await this.page.waitForTimeout(3000);
  Register the handler BEFORE the click. Use page.on (not page.once).

### User management
- Tests that create a user MUST delete the user at the end, even if the test fails:
    test.afterEach(async ({ apiContext }) => { /* delete via API */ });
- User names and email addresses MUST be randomised using utils/randomData.ts:
    import { randomName, randomEmail, randomPassword } from '../utils/randomData';
- Tests that require login MUST create the user via the Automationexercise API FIRST
  (POST /api/createAccount) and store credentials, then log in

### Assertions
- Use Playwright's built-in assertions (expect from fixtures)
- Prefer auto-retrying assertions: toBeVisible(), toHaveText(), toContainText(), toHaveURL()
- Add await before every assertion

### Handling complex tasks
- If a requested test is too complex to implement cleanly in a single step, break it into smaller sub-tasks
- When breaking down, clearly identify which fixtures, page objects, and data (e.g. created user credentials) must be passed from one sub-task to the next
- Fixture names and page class names must be consistent across all sub-tasks — never rename them mid-way
- Example: if sub-task 1 creates a user and stores their email, sub-task 2 must receive that exact email via the same fixture or shared state

### Negative tests
- After generating the requested (positive) test, think about what negative/edge-case scenarios exist for that feature
- Do NOT generate code for negative tests — only propose them
- Include them in the "proposed_negative_tests" field of your JSON response (see Output format below)
- Each proposal needs a short title (what the test is called) and a one-sentence description (what it checks)
- If the description you were given already explicitly requests a negative test or an invalid-input scenario, generate that test normally and do NOT propose it again in proposed_negative_tests
- If you cannot think of any meaningful negative tests, set proposed_negative_tests to an empty array

### Output format
Respond with a JSON object (no markdown fences, raw JSON only) in this exact shape:
{
  "summary": "One-sentence description of what was generated",
  "files": [
    {
      "path": "pages/SomePage.ts",
      "content": "full TypeScript file content here"
    },
    {
      "path": "tests/someFeature.spec.ts",
      "content": "full TypeScript file content here"
    }
  ],
  "fixture_additions": "If new fixtures must be added to fixtures/index.ts, provide the COMPLETE updated file content here. Otherwise null.",
  "instructions": "Any manual steps the developer must take (e.g. install packages). Otherwise null.",
  "proposed_negative_tests": [
    {
      "title": "should show error when email field is empty",
      "description": "Submits the form without filling in the email and asserts that a validation error appears."
    }
  ]
}

Only include files that are NEW or CHANGED. Do not repeat unchanged existing files.
`;

/**
 * Read the auto-generated learned rules file and return its content.
 * Returns an empty string if the file doesn't exist yet.
 */
async function loadLearnedRules(): Promise<string> {
  try {
    const content = await readFile(LEARNED_RULES_PATH, 'utf-8');
    // Extract just the rules section between the markers
    const match = content.match(/<!-- rules-start -->([\s\S]*?)<!-- rules-end -->/);
    return match ? match[1].trim() : content.trim();
  } catch {
    return '';
  }
}

/**
 * Returns the full system prompt: core rules + any accumulated learned rules.
 */
export async function getSystemPrompt(): Promise<string> {
  const learned = await loadLearnedRules();
  if (!learned) return CORE_RULES;

  return `${CORE_RULES}

---

## Learned rules (from past failure investigations — treat as mandatory)

${learned}
`;
}

type CacheableBlock = { type: 'text'; text: string; cache_control: { type: 'ephemeral' } };
type PlainBlock = { type: 'text'; text: string };

/**
 * Returns the system prompt as a single cacheable content block.
 * Callers pass this directly as the `system` parameter of a Messages API call.
 */
export async function getSystemBlocks(): Promise<CacheableBlock[]> {
  return [{ type: 'text', text: await getSystemPrompt(), cache_control: { type: 'ephemeral' } }];
}

/**
 * Builds the user-turn content as two blocks:
 *  1. Codebase context — marked cacheable so repeated calls with the same context
 *     pay only the cheap cache-read price instead of the full input price.
 *  2. Test description + optional DOM snapshot — never cached (varies per request).
 */
export function buildUserBlocks(opts: {
  description: string;
  existingContext: string;
  domContext?: string;
}): (CacheableBlock | PlainBlock)[] {
  const domSection = opts.domContext
    ? `## Live DOM snapshot (real elements from the page — use these for locators)\n\n${opts.domContext}\n\n---\n\n`
    : '';

  return [
    {
      type: 'text',
      text: `## Existing project context\n\n${opts.existingContext}`,
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text: `---\n\n${domSection}## Test to generate\n\n${opts.description}\n\nRespond with raw JSON only — no markdown, no explanation outside the JSON object.`,
    },
  ];
}

/**
 * Persist a new rule discovered during failure investigation.
 * Appends inside the <!-- rules-start/end --> markers.
 */
export async function appendLearnedRule(rule: {
  problemClass: string;
  rule: string;
}): Promise<void> {
  let content: string;
  try {
    content = await readFile(LEARNED_RULES_PATH, 'utf-8');
  } catch {
    // File doesn't exist yet — create it
    content = `# Learned Rules\n\n<!-- rules-start -->\n<!-- rules-end -->\n`;
  }

  // Count existing rules to assign a number
  const existingCount = (content.match(/^## Rule \d+/gm) ?? []).length;
  const num = String(existingCount + 1).padStart(3, '0');

  // Extract a short title from the first sentence of problemClass
  const title = rule.problemClass.split('.')[0].replace(/^Problem class:\s*/i, '').trim();

  const entry = `
## Rule ${num} — ${title}
**Problem class**: ${rule.problemClass}
**Rule**: ${rule.rule}
`;

  const updated = content.replace('<!-- rules-end -->', `${entry}<!-- rules-end -->`);
  await writeFile(LEARNED_RULES_PATH, updated, 'utf-8');
}

/** Build the user-turn prompt that includes existing codebase context + test description. */
export function buildUserPrompt(opts: {
  description: string;
  existingContext: string;
  domContext?: string;
}): string {
  const domSection = opts.domContext
    ? `## Live DOM snapshot (real elements from the page — use these for locators)\n\n${opts.domContext}\n\n---\n\n`
    : '';

  return `\
## Existing project context

${opts.existingContext}

---

${domSection}\
## Test to generate

${opts.description}

Respond with raw JSON only — no markdown, no explanation outside the JSON object.
`;
}
