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

# Run history retention
history:
  maxRuns: 100                         # keep last N runs per hunt
```

### Guardrails Matching Semantics

- **`forbiddenSelectors`** and **`assertions.networkIgnorePatterns`** both use JavaScript `includes()` for case-sensitive substring matching. A pattern of `"Delete"` matches `"Delete History"`, but `"delete"` does not. Specific selectors like `".delete-btn"` also match `".undelete-btn"` because the substring is present, so prefer exact-enough patterns instead of broad fragments.
- **`allowedDomains`** is enforced only for `http:` and `https:` navigations. The `about:` and `data:` protocols (for example, `about:blank`) bypass the allowlist by design so hunts can interact with browser-internal pages.
- **Migration note:** If an older config relied on lowercase patterns like `"delete"` matching uppercase text such as `"Delete History"`, update the pattern to the exact case present in the selector or URL. Apply the same review to `forbiddenSelectors`, `assertions.networkIgnorePatterns`, and any `allowedDomains` assumptions about `about:` or `data:` URLs.

<!-- ILLUSTRATION: Annotated diagram showing each config section's purpose and how it maps to runtime behavior -->

---

### Self-Healing Selectors

Set `guardrails.selfHealing: true` (default `false`) to let ProwlQA recover when an
**explicit** selector stops matching — for example after a markup change renames
`#sign-in-btn`. When such a selector matches nothing, ProwlQA derives the intent from
the selector text and tries, in order:

1. **Fuzzy text** — an element containing the selector's words (e.g. "sign in")
2. **ARIA label** — an element whose `aria-label` contains those words
3. **Structural** — an interactive element (`button`, `a`, `input`, …) containing the text

It heals **only** to a candidate that matches exactly one element — it never guesses
among multiple. A heal is logged as a warning and recorded in the run report:

- `result.json`: the step gains a `healedFrom` field
- `summary.md`: a **Self-Healed Selectors** section lists `original → healed`

Healing applies to action steps (`click`, `fill`, `selectOption`, `setInputFiles`,
`press`, `hover`, `scrollTo`) and is meant as a safety net — update your hunt to a stable
selector (ideally a `data-testid`) when you see a heal. `waitForSelector` is excluded,
since a not-yet-present element is its normal state.

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

### Trace Correlation (link failures to your app's traces)

When a hunt hits a failing request (HTTP status ≥ 400), ProwlQA reads the response's
`traceparent` header, extracts the W3C trace ID, and records it. This lets you pivot
straight from a hunt failure to the matching distributed trace in your own
observability stack (Datadog, Grafana/Tempo, Jaeger, etc.).

The trace IDs appear in:
- `result.json` under a `traceCorrelations` array (`url`, `status`, `traceId`, `header`)
- `summary.md` under a **Trace Correlations** section

If your app uses a non-standard header, configure it in `.prowlqa/config.yml`:

```yaml
tracing:
  header: "x-request-id"   # default: "traceparent"
```

This is a correlation bridge only — ProwlQA does not generate or propagate its own
spans. When the app emits no trace headers, nothing is recorded (no noise).

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

# History — show past runs of a hunt
prowlqa history <hunt-name>
prowlqa history <hunt-name> --limit 50   # Show the last 50 runs (default: 20)
prowlqa history <hunt-name> --json       # Machine-readable history output

# MCP server — expose ProwlQA to AI agents over stdio
prowlqa mcp
prowlqa mcp --projects ~/.prowlqa/projects.yml   # Drive multiple repos via a registry
```

`--parallel <count>` details:
- Runs hunts in parallel with `count` workers.
- Must be a positive integer (`>= 1`).
- Invalid values (for example `0` or `1.5`) fail fast with an argument error.

### Run History

Every `prowlqa run` and `prowlqa ci` appends an entry to `.prowlqa/history.json`
with the hunt name, status, start time, duration, and run directory. Retention
is capped per hunt by `history.maxRuns` (default 100) — once a hunt exceeds the
cap, its oldest entries are dropped on the next write. Other hunts are not
affected.

```yaml
# In .prowlqa/config.yml
history:
  maxRuns: 50  # keep the last 50 runs per hunt (default: 100)
```

Use `prowlqa history <hunt-name>` for a quick status/duration table, or
`--json` to feed the entries into dashboards, flake detectors, or agents.

---

## MCP Server (AI Agent Integration)

ProwlQA can run as an [MCP](https://modelcontextprotocol.io) server, exposing QA
as a small set of named tools that any MCP-capable agent can call over stdio. The
agent triggers runs and reads structured results through these tools — it never
needs shell access to your repo.

**Prerequisites:**

- **`prowlqa` must be on your `PATH`.** Install it globally with `npm install -g prowlqa`, or launch it through `npx` (use `"command": "npx", "args": ["prowlqa", "mcp"]` in the client config below). If the binary can't be found, the MCP client fails to start the server with no hunt-specific error.
- **The target project must be initialized** — a `.prowlqa/` directory with a valid config and hunts. Run `prowlqa init` and author hunts first. Pointed at an uninitialized repo, MCP tool calls fail with a missing `.prowlqa/config.yml` error.

```bash
prowlqa mcp
```

This starts a stdio server for the current project (it discovers `.prowlqa/` from
the working directory, exactly like the other commands). Point your MCP client at
it — for example:

```json
{
  "mcpServers": {
    "prowlqa": {
      "command": "prowlqa",
      "args": ["mcp"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

### Tools

| Tool | Arguments | Returns |
|------|-----------|---------|
| `list_hunts` | `project?` | Hunt names in run order |
| `run_hunt` | `hunt`, `project?` | The full `RunResult` for a single hunt |
| `run_suite` | `includeTags?`, `excludeTags?`, `parallel?`, `logBugs?`, `project?` | Pass/fail/skip counts, the `ci-result.json` path, and the bug tickets created |
| `list_projects` | — | Registered projects (empty unless a registry is configured) |

Existing guardrails (`allowedDomains`, `forbiddenSelectors`, `maxSteps`,
`maxTotalTimeMs`) apply to every run the server triggers.

**Controlling what the agent can do:** ProwlQA exposes only these four tools and
never runs arbitrary shell. To restrict the agent further, allow-list tool names
in your MCP client (e.g. OpenClaw) config — for example, allow `list_hunts` and
`run_suite` but withhold `run_hunt`. That allow-listing is configured on the
agent/client side, not in ProwlQA.

### Logging bugs automatically

`run_suite` runs every hunt and, by default, logs each failure as a deduplicated
bug ticket in the project's `docs/backlog.md`, under a `## QA Findings (automated)`
section that stays separate from your hand-written items. A bug is identified by
hunt + failing step + normalized error, so:

- a brand-new failure creates a `QA-NNN` ticket with the hunt, failing step, error, and a link to the run artifacts;
- a failure that already has an open ticket is left alone (no duplicates);
- a failure matching something already in `docs/resolved.md` is logged as a **regression** that references the old ticket id.

Pass `logBugs: false` to run without touching the backlog. A `run_suite` response
looks like this:

```json
{
  "status": "fail",
  "totalHunts": 8,
  "passed": 6,
  "failed": 2,
  "skipped": 0,
  "resultPath": "/path/to/project/.prowlqa/runs/ci-2026-05-26_09-12-03-456/ci-result.json",
  "bugs": {
    "created": ["QA-014"],
    "regressions": ["QA-015"],
    "alreadyOpen": ["QA-009"],
    "backlogPath": "/path/to/project/docs/backlog.md"
  }
}
```

`status` is one of `pass`, `fail`, `no-hunts`, or `all-skipped`. When
`logBugs` is `false`, `bugs` arrays are empty and `backlogPath` is `null`.

### Driving multiple projects

By default the server acts on the current directory. To drive several repos from a
single server, give it a **project registry** — one YAML file that maps project
names to repo roots. This file lives *outside* any repo (it spans many), not
inside a target project:

```yaml
# ~/.prowlqa/projects.yml
projects:
  coupe:
    root: /Users/you/projects/coupe
  storefront:
    root: /Users/you/projects/storefront
    configPath: /custom/.prowlqa/config.yml   # optional; defaults to <root>/.prowlqa/config.yml
```

The registry is resolved in priority order:

1. `prowlqa mcp --projects <path>`
2. the `PROWLQA_PROJECTS` environment variable
3. `~/.prowlqa/projects.yml`

With a registry loaded, every tool accepts an optional `project` argument that
selects which repo to act on, and `list_projects` enumerates what's available.
For example, these `run_suite` arguments run the smoke suite for `coupe` and log
any failures to `coupe/docs/backlog.md`:

```jsonc
{ "project": "coupe", "includeTags": ["smoke"] }
```

Omit `project` and the tool falls back to the current directory. Naming a project
that isn't registered — or naming one when no registry is configured — returns a
clear error.

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
