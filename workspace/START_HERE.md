# Start Here

The quickest way to get a real automated test written and checked — no coding
required. For a deeper walkthrough, see docs/getting-started.md.

## 1. Describe the test you want, in plain English

Open `workspace/my-test.txt` and replace the example text with what you want
tested — for example:

    Go to the login page, sign in with a valid email and password, and check
    that the account page shows the user's name.

## 2. Generate it

    npm run generate -- --file workspace/my-test.txt

This turns your description into a real Playwright test, writes it to the
project, and runs it.

## 3. Read the result

The command prints one of these for the test it just created:
  - ✅ Passed — done, nothing more to do.
  - 🔧 Auto-fixed — it failed once, fixed itself, and now passes.
  - ⚠️ Broken — couldn't be made to pass automatically; the printed reason
    explains why.
  - 🐞 App bug — the test is correct, but the app itself behaved unexpectedly.

## 4. Check overall health any time

    npm run status

Prints a summary of every test in the project, ending with a "Bottom line" that
says — in plain English — whether anything needs attention, and what command
fixes it.

## Got a list of requirements instead of one test?

Paste them into `workspace/prd.md`, then run:

    npm run analyze_prd -- --file workspace/prd.md

This writes a reviewable list of suggested tests to `workspace/prd-tests.txt` —
delete anything you don't want, then run:

    npm run generate -- --file workspace/prd-tests.txt

## Something broke later?

    npm run fix

Investigates the most recently broken test and tries to fix it automatically.
