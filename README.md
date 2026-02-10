# Prowl

CLI-first QA testing tool for deterministic web testing with Playwright.

<!-- ILLUSTRATION: Prowl raccoon mascot hero image — cyan raccoon with terminal window showing pass/fail output -->

Write tests in YAML. Run them from the terminal. Get screenshots, traces, and reports automatically.

```yaml
# .prowl/hunts/login-flow.yml
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
  Artifacts: .prowl/runs/2026-02-09_10-30-45
```

---

## Getting Started

### 1. Install

```bash
npm install -g prowlai
```

Prowl uses Playwright under the hood. Install the browser:

```bash
npx playwright install chromium
```

### 2. Initialize

```bash
cd your-project
prowl init
```

<!-- ILLUSTRATION: Terminal screenshot showing `prowl init` output with raccoon mascot and file listing -->

This creates a `.prowl/` directory with a config file and 8 example hunts:

```
.prowl/
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

Edit `.prowl/config.yml` to point at your app:

```yaml
target:
  url: "http://localhost:3000"
```

### 4. Write Your First Hunt

Edit `.prowl/hunts/homepage.yml` or create a new file:

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
prowl run smoke-test
```

<!-- ILLUSTRATION: Terminal screenshot showing colorized pass/fail output with step timings -->

That's it. You're testing.

---

## Step Type Reference

Prowl supports both **shorthand** and **explicit** syntax for most step types. Shorthand is concise and readable. Explicit gives you full control over selectors.

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

Set files on `<input type="file">` elements. Paths are relative to `.prowl/`.

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

Config lives at `.prowl/config.yml`. All options with defaults:

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

# Auth state from `prowl login`
auth:
  storageStatePath: ".prowl/auth-state.json"
```

<!-- ILLUSTRATION: Annotated diagram showing each config section's purpose and how it maps to runtime behavior -->

---

## Variable Interpolation

Use `{{VAR_NAME}}` to inject dynamic values into your hunts.

### Variable Sources (precedence order)

1. **Hunt vars** — defined in the hunt's `vars:` block (highest priority)
2. **Environment variables** — from `process.env`
3. **`.env` file** — from `.prowl/.env` (loaded automatically)

```yaml
# .prowl/hunts/login-flow.yml
vars:
  EMAIL: "{{TEST_EMAIL}}"     # References env var TEST_EMAIL
  TIMEOUT: "5000"             # Static value

steps:
  - fill:
      "Email": "{{EMAIL}}"    # Resolves to the value of TEST_EMAIL
```

### .env File

Create `.prowl/.env` for secrets:

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

Prowl uses Playwright's selector engine. For stable, maintainable selectors:

1. **`data-testid`** (best) — explicit test hooks that don't change with UI refactors
   ```yaml
   - click: { selector: "[data-testid='submit']" }
   ```

2. **Accessible roles** — semantic and resilient to styling changes
   ```yaml
   - click: { selector: "role=button[name='Submit']" }
   ```

3. **Labels/placeholders** — via shorthand, Prowl resolves these automatically
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

For hunts that require authentication, use `prowl login` to capture browser state:

```bash
prowl login
```

This opens a headed Chromium window. Log in manually, then close the browser. Prowl saves cookies, localStorage, and sessionStorage to `.prowl/auth-state.json`.

All subsequent `prowl run` commands will load this auth state, so your hunts start already logged in.

### Using Auth State in Hunts

No changes needed — auth state is loaded automatically from the path in `config.yml`:

```yaml
auth:
  storageStatePath: ".prowl/auth-state.json"
```

### Refreshing Auth

If your session expires, run `prowl login` again to re-capture.

---

## Artifacts

Every hunt run generates artifacts in `.prowl/runs/<timestamp>/`:

```
.prowl/runs/2026-02-09_10-30-45/
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
npx playwright show-trace .prowl/runs/2026-02-09_10-30-45/trace.zip
```

---

## CLI Reference

```bash
# Run a hunt
prowl run <hunt-name>
prowl run <hunt-name> --headed          # Show browser window
prowl run <hunt-name> --trace           # Capture Playwright trace
prowl run <hunt-name> --slow-mo 500     # Slow down actions (ms)
prowl run <hunt-name> --url <override>  # Override target URL
prowl run <hunt-name> --config <path>   # Custom config path

# Watch mode — re-runs on file changes
prowl watch <hunt-name>

# Auth — capture login state interactively
prowl login

# Initialize — create .prowl directory with examples
prowl init
prowl init --force                      # Overwrite existing

# List available hunts
prowl list
```

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

### "Could not find .prowl/config.yml"

Run `prowl init` in your project root to create the `.prowl/` directory.

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
2. Is it set in your `.prowl/.env` file?
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
