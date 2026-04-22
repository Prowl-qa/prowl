# ProwlQA

CLI-first QA testing tool for deterministic web testing with Playwright.

<!-- ILLUSTRATION: ProwlQA raccoon mascot hero image — cyan raccoon with terminal window showing pass/fail output -->

Write tests in YAML. Run them from the terminal. Get screenshots, traces, and reports automatically.

```yaml
# .prowlqa/hunts/login-flow.yml
name: login-flow
steps:
  - navigate: "/login"
  - fill:
      "Email": "{{TEST_EMAIL}}"
  - fill:
      "Password": "{{TEST_PASSWORD}}"
  - click: "Sign In"
  - assert:
      visible: "Dashboard"
```

```
  ● Running hunt: login-flow
    ✓ navigate "/login" (120ms)
    ✓ fill "Email" (85ms)
    ✓ fill "Password" (62ms)
    ✓ click "Sign In" (340ms)
    ✓ assert visible "Dashboard" (15ms)

  PASS login-flow (622ms) 5/5 steps
  Artifacts: .prowlqa/runs/2026-02-09_10-30-45
```

---

## Getting Started

### 1. Install

```bash
npm install -g prowlqa
```

Or with Homebrew:

```bash
brew tap prowl-qa/tap
brew install prowlqa
```

ProwlQA uses Playwright under the hood. Install the browser:

```bash
npx playwright install chromium
```

### 2. Initialize

```bash
cd your-project
prowlqa init
```

<!-- ILLUSTRATION: Terminal screenshot showing `prowlqa init` output with raccoon mascot and file listing -->

This creates a `.prowlqa/` directory with a config file and 8 example hunts:

```
.prowlqa/
├── config.yml              # Target URL, browser settings, guardrails
└── hunts/
    ├── homepage.yml         # Basic page load smoke test
    ├── login-flow.yml       # Email/password authentication
    ├── signup-flow.yml      # Registration with validation
    ├── form-submit.yml      # Form fill and submit
    ├── form-validation.yml  # Validation errors and resubmit
    ├── crud-cycle.yml       # Create, read, update, delete lifecycle
    ├── checkout-flow.yml    # E-commerce checkout
    └── onboarding-wizard.yml # Multi-step SaaS onboarding
```

### 3. Configure

Edit `.prowlqa/config.yml` to point at your app:

```yaml
target:
  url: "http://localhost:3000"
```

### 4. Write Your First Hunt

Edit `.prowlqa/hunts/homepage.yml` or create a new file:

```yaml
name: smoke-test
steps:
  - navigate: "/"
  - wait: "Welcome"
  - assert:
      visible: "Sign In"
assertions:
  - noConsoleErrors: true
```

### 5. Run

```bash
prowlqa run smoke-test
```

<!-- ILLUSTRATION: Terminal screenshot showing colorized pass/fail output with step timings -->

That's it. You're testing.

---

## Step Type Reference

ProwlQA supports both **shorthand** and **explicit** syntax for most step types. Shorthand is concise and readable. Explicit gives you full control over selectors.

### navigate

Navigate to a URL (relative to your `target.url` or absolute).

```yaml
- navigate: "/"
- navigate: "/login"
- navigate: "https://example.com/page"
```

### click

Click an element. Shorthand finds buttons by text, then falls back to any matching text.

```yaml
# Shorthand — finds by button role, then text
- click: "Sign In"

# Explicit — use any Playwright selector
- click:
    selector: "[data-testid='submit-btn']"
```

### fill

Fill an input field. Shorthand finds inputs by label or placeholder text.

```yaml
# Shorthand — finds by label, then placeholder
- fill:
    "Email": "user@example.com"

# Explicit — use any selector
- fill:
    selector: "input[name='email']"
    value: "user@example.com"
```

### type

Type into the currently focused element. Useful after clicking into a field.

```yaml
- click: "Message"
- type: "Hello, I have a question."
```

### press

Press a keyboard key on a specific element.

```yaml
- press:
    selector: "input[name='search']"
    key: "Enter"
```

### select / selectOption

Select a dropdown value. Shorthand finds by label, explicit uses a selector.

```yaml
# Shorthand — finds <select> by label, aria-label, or placeholder
- select:
    "State": "FL"

# Explicit
- selectOption:
    selector: "select[name='state']"
    value: "FL"
```

### assert

Mid-flow assertions. Fails the hunt immediately if the assertion fails.

```yaml
- assert:
    visible: "Welcome back"

- assert:
    notVisible: "Error"

- assert:
    urlIncludes: "/dashboard"

- assert:
    urlEquals: "https://example.com/dashboard"
```

### if

Conditionally execute steps based on whether a selector is visible or not visible. This step is explicit-only.

Key fields:
- `visible` or `notVisible` (exactly one)
- `then` (required array of steps)
- `else` (optional array of steps)

```yaml
- if:
    visible: ".cookie-banner"
    then:
      - click: ".accept"
    else:
      - wait: "Welcome back"
```

### repeat

Repeat a block of steps either a fixed number of times or while a selector condition is true. This step is explicit-only.

Key fields:
- `times` (fixed count) or `while` (condition), exactly one
- `while.visible` or `while.notVisible` (when using `while`)
- `maxIterations` (required with `while`)
- `steps` (required array of steps to execute each iteration)

```yaml
# Fixed count
- repeat:
    times: 3
    steps:
      - click: ".load-more"

# Condition-based loop
- repeat:
    while:
      visible: ".load-more"
    maxIterations: 10
    steps:
      - click: ".load-more"
```

### mockRoute

Mock network responses for a URL pattern. This step is explicit-only.

Key fields:
- `url` (Playwright route pattern, e.g. `**/api/users`)
- `response.status`
- exactly one of `response.body` or `response.file`
- optional `response.contentType` (defaults to `application/json`)

```yaml
- mockRoute:
    url: "**/api/users"
    response:
      status: 200
      body: '{"users":[{"id":1}]}'
```

### unmockRoute

Remove a previously registered route mock. This step is explicit-only.

Key fields:
- `url` (must match the mocked route URL pattern)

```yaml
- unmockRoute:
    url: "**/api/users"
```

### wait

Wait for text to appear on the page. Shorthand for `waitForSelector` with text matching.

```yaml
# Simple — wait for text with default timeout
- wait: "Loading complete"

# With custom timeout
- wait:
    for: "Loading complete"
    timeout: 10000
```

### waitForSelector

Wait for any Playwright selector to appear.

```yaml
- waitForSelector:
    selector: "[data-testid='results-table']"
    timeout: 5000
```

### waitForUrl

Wait for the URL to contain a substring.

```yaml
- waitForUrl:
    value: "/dashboard"
    timeout: 10000
```

### waitForNetworkIdle

Wait for all network requests to complete.

```yaml
- waitForNetworkIdle:
    timeout: 5000
```

### onDialog

Handle browser-native dialogs (alert, confirm, prompt). Register the handler **before** the action that triggers the dialog.

```yaml
- onDialog:
    action: accept    # or "dismiss"
- click: "Delete"     # this triggers the confirm dialog
```

### setInputFiles

Set files on `<input type="file">` elements. Paths are relative to `.prowlqa/`.

```yaml
# Single file
- setInputFiles:
    selector: "[data-testid='avatar-upload']"
    files: "fixtures/avatar.png"

# Multiple files
- setInputFiles:
    selector: "[data-testid='attachments']"
    files:
      - "fixtures/doc1.pdf"
      - "fixtures/doc2.pdf"
```

### runHunt

Execute another hunt file inline. Enables reusable sub-flows like login.

```yaml
# Simple — run the hunt as-is
- runHunt: "login-flow"

# With variable overrides
- runHunt:
    name: "login-flow"
    vars:
      EMAIL: "admin@test.com"
      PASSWORD: "{{ADMIN_PASSWORD}}"
```

Circular dependencies are detected automatically (`A → B → A` will error).

### screenshot

Capture a screenshot at any point.

```yaml
- screenshot:
    name: "after-login"
```

---

## Assertion Reference

### Inline Assertions (step-level)

Use `assert` steps anywhere in your hunt for mid-flow checks:

```yaml
- assert:
    visible: "Welcome"       # Text must be visible on page
- assert:
    notVisible: "Error"      # Text must NOT be visible
- assert:
    urlIncludes: "/dashboard" # Current URL must contain string
- assert:
    urlEquals: "https://..."  # Current URL must match exactly
```

### Hunt-Level Assertions

Run after all steps complete:

```yaml
assertions:
  - selectorExists: "h1"              # Element must exist
  - selectorNotExists: ".error-banner" # Element must NOT exist
  - urlIncludes: "/dashboard"
  - urlEquals: "https://example.com/"
  - noConsoleErrors: true              # No console.error messages
  - noNetworkErrors: true              # No HTTP responses >= 400
```

---

## Config Reference

Config lives at `.prowlqa/config.yml`. All options with defaults:

```yaml
# The base URL for all hunt navigation
target:
  url: "http://localhost:3000"        # Required

# Browser settings
browser:
  headless: true                       # false = show the browser window
  slowMo: 0                           # ms delay between actions (debugging)
  timeout: 30000                       # default page operation timeout

# What gets saved per run
artifacts:
  screenshots: "on-failure"           # "on-failure" or "all"
  networkHar: false                    # save network activity as HAR
  console: true                        # save browser console output

# Hunt-level assertions (applied to every hunt)
assertions:
  noConsoleErrors: true                # fail on console.error
  noNetworkErrors: true                # fail on HTTP >= 400
  maxTotalTimeMs: 30000                # max total time for all steps
  networkIgnorePatterns: []            # URL substrings to ignore

# Safety guardrails
guardrails:
  maxSteps: 50                         # max steps per hunt
  allowedDomains:                      # only navigate to these domains
    - "localhost"
    - "127.0.0.1"
  forbiddenSelectors:                  # selectors that steps cannot use
    - "[data-danger]"
    - ".delete-btn"

# Auth state from `prowlqa login`
auth:
  storageStatePath: ".prowlqa/auth-state.json"
```

### Guardrails Matching Semantics

- **`forbiddenSelectors`** uses case-sensitive substring matching. A pattern of `"delete"` forbids `".delete-btn"` *and* `".undelete-btn"` or `"Delete History"`. Write patterns specifically enough to avoid unintended matches (for example, `".delete-btn"` instead of `"delete"`). The same substring matching applies to `assertions.networkIgnorePatterns`.
- **`allowedDomains`** is enforced for `http:` and `https:` navigations. The `about:` and `data:` protocols (for example, `about:blank`) bypass the allowlist by design so hunts can interact with browser-internal pages.

<!-- ILLUSTRATION: Annotated diagram showing each config section's purpose and how it maps to runtime behavior -->

---

## Variable Interpolation

Use `{{VAR_NAME}}` to inject dynamic values into your hunts.

### Variable Sources (precedence order)

1. **Hunt vars** — defined in the hunt's `vars:` block (highest priority)
2. **Environment variables** — from `process.env`
3. **`.env` file** — from `.prowlqa/.env` (loaded automatically)

```yaml
# .prowlqa/hunts/login-flow.yml
vars:
  EMAIL: "{{TEST_EMAIL}}"     # References env var TEST_EMAIL
  TIMEOUT: "5000"             # Static value

steps:
  - fill:
      "Email": "{{EMAIL}}"    # Resolves to the value of TEST_EMAIL
```

### .env File

Create `.prowlqa/.env` for secrets:

```env
TEST_EMAIL=user@example.com
TEST_PASSWORD=secret123
```

### Automatic Redaction

Any `fill` or `type` step whose value came from a `{{VAR}}` interpolation is automatically redacted in reports:

```
# In summary.md and result.json:
fill "[data-testid='email']" → [REDACTED]
```

This prevents credentials from leaking into artifacts, CI logs, or screenshots.

---

## Shorthand vs Explicit Syntax

Every shorthand has an explicit equivalent. Use shorthand for readability, explicit for precision.

| Shorthand | Explicit Equivalent |
|-----------|-------------------|
| `click: "Sign In"` | `click: { selector: 'button:has-text("Sign In")' }` |
| `fill: { "Email": "val" }` | `fill: { selector: 'input[placeholder="Email"]', value: "val" }` |
| `type: "text"` | `fill: { selector: ':focus', value: "text" }` |
| `select: { "State": "FL" }` | `selectOption: { selector: 'select[name="state"]', value: "FL" }` |
| `wait: "Welcome"` | `waitForSelector: { selector: 'text="Welcome"' }` |
| `runHunt: "login"` | `runHunt: { name: "login" }` |

---

## Selector Best Practices

ProwlQA uses Playwright's selector engine. For stable, maintainable selectors:

1. **`data-testid`** (best) — explicit test hooks that don't change with UI refactors
   ```yaml
   - click: { selector: "[data-testid='submit']" }
   ```

2. **Accessible roles** — semantic and resilient to styling changes
   ```yaml
   - click: { selector: "role=button[name='Submit']" }
   ```

3. **Labels/placeholders** — via shorthand, ProwlQA resolves these automatically
   ```yaml
   - fill: { "Email": "user@test.com" }
   ```

4. **Text content** — via shorthand click, good for buttons and links
   ```yaml
   - click: "Sign In"
   ```

5. **CSS selectors** (last resort) — fragile, avoid class names that change
   ```yaml
   - click: { selector: ".btn-primary" }   # Avoid if possible
   ```

---

## Auth Setup

For hunts that require authentication, use `prowlqa login` to capture browser state:

```bash
prowlqa login
```

This opens a headed Chromium window. Log in manually, then close the browser. ProwlQA saves cookies, localStorage, and sessionStorage to `.prowlqa/auth-state.json`.

All subsequent `prowlqa run` commands will load this auth state, so your hunts start already logged in.

### Using Auth State in Hunts

No changes needed — auth state is loaded automatically from the path in `config.yml`:

```yaml
auth:
  storageStatePath: ".prowlqa/auth-state.json"
```

### Refreshing Auth

If your session expires, run `prowlqa login` again to re-capture.

---

## Artifacts

Every hunt run generates artifacts in `.prowlqa/runs/<timestamp>/`:

```
.prowlqa/runs/2026-02-09_10-30-45/
├── summary.md           # Human-readable report
├── result.json          # Machine-readable results
├── console.log          # Browser console output
├── screenshots/
│   ├── final.png        # Final page state
│   └── failure_step_3.png  # Screenshot on failure (if any)
├── trace.zip            # Playwright trace (if --trace)
└── network.har          # Network activity (if networkHar: true)
```

<!-- ILLUSTRATION: Screenshot of a run directory in Finder/terminal showing the artifact files -->

### Viewing Traces

```bash
npx playwright show-trace .prowlqa/runs/2026-02-09_10-30-45/trace.zip
```

---

## CLI Reference

```bash
# Run a hunt
prowlqa run <hunt-name>
prowlqa run <hunt-name> --headed          # Show browser window
prowlqa run <hunt-name> --trace           # Capture Playwright trace
prowlqa run <hunt-name> --slow-mo 500     # Slow down actions (ms)
prowlqa run <hunt-name> --url <override>  # Override target URL
prowlqa run <hunt-name> --config <path>   # Custom config path

# Watch mode — re-runs on file changes
prowlqa watch <hunt-name>

# Auth — capture login state interactively
prowlqa login

# Initialize — create .prowlqa directory with examples
prowlqa init
prowlqa init --force                      # Overwrite existing

# List available hunts
prowlqa list

# CI mode — run all hunts with aggregate status
prowlqa ci
prowlqa ci --json                        # Machine-readable CI output
prowlqa ci --parallel 4                 # Run hunts with 4 workers
```

`--parallel <count>` details:
- Runs hunts in parallel with `count` workers.
- Must be a positive integer (`>= 1`).
- Invalid values (for example `0` or `1.5`) fail fast with an argument error.

---

## Architecture

<!-- ILLUSTRATION: Architecture diagram showing: CLI (Commander) → Config (YAML + Zod) → Runner (Step Execution) → Browser (Playwright) → Reporter (summary.md + result.json) -->

```
CLI Commands
    │
    ├── Config Loader (YAML → Zod validation → merged defaults)
    │       │
    │       ├── Hunt Loader (YAML → schema validation → interpolation)
    │       │
    │       └── .env Loader (dotenv)
    │
    ├── Runner
    │       │
    │       ├── Step Executor (16 step types, guardrail checks)
    │       │
    │       ├── Assertion Evaluator (6 assertion types)
    │       │
    │       └── Browser Controller (Playwright launch/close)
    │
    └── Reporter
            │
            ├── summary.md (human-readable, redacted)
            │
            └── result.json (machine-readable)
```

---

## Community Hub

Browse and contribute hunt templates through the internal community registry (contact ops for access).

Templates cover auth flows (OAuth, 2FA), e-commerce (Stripe), admin panels, SaaS patterns, and more. Each template is heavily commented and ready to customize.

---

## Troubleshooting

### "Could not find .prowlqa/config.yml"

Run `prowlqa init` in your project root to create the `.prowlqa/` directory.

### "Navigation to disallowed domain"

Add the domain to `guardrails.allowedDomains` in your config:

```yaml
guardrails:
  allowedDomains:
    - "localhost"
    - "your-domain.com"
```

### "Forbidden selector"

The selector matches a pattern in `guardrails.forbiddenSelectors`. Either change the selector or update the guardrails config.

### "Missing variable: VAR_NAME"

The `{{VAR_NAME}}` in your hunt couldn't be resolved. Check:
1. Is it defined in the hunt's `vars:` block?
2. Is it set in your `.prowlqa/.env` file?
3. Is it set as an environment variable?

### Selectors not finding elements

- Use `--headed` and `--slow-mo 1000` to watch the browser in real time
- Check if the element is inside an iframe
- Check if the element appears after a network request (add `waitForNetworkIdle` before)
- Use `--trace` and view with `npx playwright show-trace` for detailed diagnostics

### Hunt running slowly

- Check `browser.timeout` in your config — lower it for faster failures
- Add `waitForNetworkIdle` only where needed (it waits for ALL requests)
- Use `waitForSelector` with a specific element instead of `waitForNetworkIdle`

---

## License

Apache 2.0 — see [LICENSE](LICENSE)
