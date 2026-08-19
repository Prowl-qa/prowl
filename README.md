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
npm install -g prowl-tools
```

Or with Homebrew:

```bash
brew tap prowl-tools/tap
brew install prowl
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

```text
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
# Execution target. Defaults to the web target; existing configs work unchanged.
target:
  type: "web"                         # "web" (default), "macos", "android", or "ios" (experimental)
  url: "http://localhost:3000"        # Required for web targets
  # For the experimental macOS target instead:
  #   type: "macos"
  #   app: "com.example.App"          # bundle id or /path/to/App.app  (see "macOS Target")
  # For the experimental Android target instead:
  #   type: "android"
  #   app: "com.example.app"          # package name or /path/to/app.apk  (see "Android Target")
  #   deviceSerial: "emulator-5554"   # optional; required only with several devices attached
  #   coldStart: false                # optional; pm clear before launch
  # For the experimental iOS simulator target instead:
  #   type: "ios"
  #   app: "com.example.App"          # bundle id or /path/to/App.app  (see "iOS Target")
  #   udid: "..."                     # optional; required only with several booted simulators
  #   coldStart: false                # optional; uninstall+reinstall before launch (needs a .app)

# Browser settings
browser:
  headless: true                       # false = show the browser window
  slowMo: 0                           # ms delay between actions (debugging)
  timeout: 30000                       # default page operation timeout; macOS app launch timeout

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
  allowedApps: []                      # native targets only: macOS bundle IDs/names/.app paths, Android package IDs/canonical APK paths, or iOS bundle IDs/.app paths

# Auth state from `prowl login`
auth:
  storageStatePath: ".prowl/auth-state.json"

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

Set `guardrails.selfHealing: true` (default `false`) to let Prowl recover when an
**explicit** selector stops matching — for example after a markup change renames
`#sign-in-btn`. When such a selector matches nothing, Prowl derives the intent from
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

```text
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

### Trace Correlation (link failures to your app's traces)

When a hunt hits a failing request (HTTP status ≥ 400), Prowl reads the response's
`traceparent` header, extracts the W3C trace ID, and records it. This lets you pivot
straight from a hunt failure to the matching distributed trace in your own
observability stack (Datadog, Grafana/Tempo, Jaeger, etc.).

The trace IDs appear in:
- `result.json` under a `traceCorrelations` array (`url`, `status`, `traceId`, `header`)
- `summary.md` under a **Trace Correlations** section

If your app uses a non-standard header, configure it in `.prowl/config.yml`:

```yaml
tracing:
  header: "x-request-id"   # default: "traceparent"
```

This is a correlation bridge only — Prowl does not generate or propagate its own
spans. When the app emits no trace headers, nothing is recorded (no noise).

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

# CI mode — run all hunts with aggregate status
prowl ci
prowl ci --json                        # Machine-readable CI output
prowl ci --parallel 4                 # Run hunts with 4 workers

# History — show past runs of a hunt
prowl history <hunt-name>
prowl history <hunt-name> --limit 50   # Show the last 50 runs (default: 20)
prowl history <hunt-name> --json       # Machine-readable history output

# MCP server — expose Prowl to AI agents over stdio
prowl mcp
prowl mcp --projects ~/.prowl/projects.yml   # Drive multiple repos via a registry
```

`--parallel <count>` details:
- Runs hunts in parallel with `count` workers.
- Must be a positive integer (`>= 1`).
- Invalid values (for example `0` or `1.5`) fail fast with an argument error.

### Run History

Every `prowl run` and `prowl ci` appends an entry to `.prowl/history.json`
with the hunt name, status, start time, duration, and run directory. Retention
is capped per hunt by `history.maxRuns` (default 100) — once a hunt exceeds the
cap, its oldest entries are dropped on the next write. Other hunts are not
affected.

```yaml
# In .prowl/config.yml
history:
  maxRuns: 50  # keep the last 50 runs per hunt (default: 100)
```

Use `prowl history <hunt-name>` for a quick status/duration table, or
`--json` to feed the entries into dashboards, flake detectors, or agents.

### Failure Clustering

When a `prowl ci` run has multiple failures that share a common cause — the same
step type, selector, and (normalized) error — Prowl groups them into a single
**failure cluster**. Instead of triaging five separate failures, you see one root
cause (for example, a renamed `#submit` selector that broke five hunts).

Clusters appear in:
- the **Failure clusters** section of the CI summary, with the cause and affected hunts
- a `clusters` array in `ci-result.json` (and `prowl ci --json`), each entry with
  `cause`, `stepType`, `selector`, `error`, `count`, and `hunts`

Only causes shared by more than one hunt are reported as clusters. This pairs well
with self-healing selectors and flake detection to cut triage time on large suites.

---

## MCP Server (AI Agent Integration)

Prowl can run as an [MCP](https://modelcontextprotocol.io) server, exposing QA
as a small set of named tools that any MCP-capable agent can call over stdio. The
agent triggers runs and reads structured results through these tools — it never
needs shell access to your repo.

**Prerequisites:**

- **`prowl` must be on your `PATH`.** Install it globally with `npm install -g prowl-tools`, or launch it through `npx` (use `"command": "npx", "args": ["prowl-tools", "mcp"]` in the client config below). If the binary can't be found, the MCP client fails to start the server with no hunt-specific error.
- **The target project must be initialized** — a `.prowl/` directory with a valid config and hunts. Run `prowl init` and author hunts first. Pointed at an uninitialized repo, MCP tool calls fail with a missing `.prowl/config.yml` error.

```bash
prowl mcp
```

This starts a stdio server for the current project (it discovers `.prowl/` from
the working directory, exactly like the other commands). Point your MCP client at
it — for example:

```json
{
  "mcpServers": {
    "prowl": {
      "command": "prowl",
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

**Controlling what the agent can do:** Prowl exposes only these four tools and
never runs arbitrary shell. To restrict the agent further, allow-list tool names
in your MCP client (e.g. OpenClaw) config — for example, allow `list_hunts` and
`run_suite` but withhold `run_hunt`. That allow-listing is configured on the
agent/client side, not in Prowl.

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
  "resultPath": "/path/to/project/.prowl/runs/ci-2026-05-26_09-12-03-456/ci-result.json",
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
# ~/.prowl/projects.yml
projects:
  coupe:
    root: /Users/you/projects/coupe
  storefront:
    root: /Users/you/projects/storefront
    configPath: /custom/.prowl/config.yml   # optional; defaults to <root>/.prowl/config.yml
```

The registry is resolved in priority order:

1. `prowl mcp --projects <path>`
2. the `PROWL_PROJECTS` environment variable
3. `~/.prowl/projects.yml`

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

## macOS Target (Experimental)

> **Experimental (PROWL-048).** Prowl can drive **native macOS apps** — including
> menu bar extras (`NSStatusItem` + `NSMenu`) — through Apple's Accessibility API,
> in addition to the web. The API, selector dialect, and step coverage may change.
> **Distribution is deferred:** the required helper binary is **not** shipped in the
> npm package; you build it locally (below).

### Enabling it

1. **Build the helper** (one time; requires the Swift toolchain / Xcode CLT):

   ```bash
   cd macdriver
   swift build -c release
   ```

   Prowl finds the binary at `macdriver/.build/release/prowl-macdriver`, or at
   `$PROWL_MACDRIVER_BIN` if set. If it is missing, Prowl fails with a clear
   "build the helper" message rather than crashing.

2. **Point your config at a macOS target:**

   ```yaml
   target:
     type: macos
     app: "com.example.App"        # bundle id, or an absolute /path/to/App.app
   guardrails:
     allowedApps:                   # optional scope; empty = allow the target app
       - "com.example.App"
   ```

   When `target.app` is an app path, `allowedApps` may list the exact `.app`
   path, the app bundle name (`Example` for `Example.app`), or the bundle id
   from `Contents/Info.plist` when that file is readable.

3. **Grant Accessibility permission** (see below), then run a hunt as usual:
   `prowl run my-macos-hunt`.

### Accessibility & Screen Recording permission

The **process that hosts** Prowl (your terminal — Terminal, iTerm, VS Code, or a CI
agent) must be granted **Accessibility** permission: **System Settings → Privacy &
Security → Accessibility**, then enable that app. macOS attributes the grant to the
hosting app, not to `prowl-macdriver`. Preflight from the helper:

```bash
macdriver/.build/release/prowl-macdriver check   # prints {"trusted": <bool>}; prompts on first run
```

The `screenshot`/`assertScreenshot` steps additionally need **Screen Recording**
permission for the hosting app.

**CI notes (macOS runners):** headless CI cannot click "Allow" in a dialog, so grant
the permissions non-interactively before the run. On a self-hosted runner you can
pre-authorize the agent's host app with a TCC profile via MDM, or (on ephemeral
runners where it's acceptable) seed the TCC database, e.g.:

```bash
sudo sqlite3 "/Library/Application Support/com.apple.TCC/TCC.db" \
  "INSERT OR REPLACE INTO access VALUES('kTCCServiceAccessibility','<runner-app-bundle-id>',0,2,2,1,NULL,NULL,NULL,'UNUSED',NULL,0,1,NULL,NULL,NULL);"
```

GitHub-hosted macOS runners do not grant Accessibility, so the macOS target is aimed
at self-hosted / MDM-managed runners for now.

### Selector dialect (macOS)

Native selectors address accessibility identifiers, roles, and labels:

| Selector | Matches |
|---|---|
| `id=openSettings` | element whose `AXIdentifier` equals `openSettings` |
| `role=button[name="Save"]` | an `AXButton` whose title/description/value contains `Save` |
| `label="Email"` | element whose accessibility label equals `Email` |
| `text="Save"` or bare `Save` | element whose title/description/value contains the text |
| `statusItem` | opens the app's menu bar status-item menu |
| `menu=Preferences…` | opens the status-item menu and clicks that item |

`forbiddenSelectors` still applies (text patterns match via the same substring
semantics as the web target). Prefer `id=` (accessibility identifiers) — the native
analog of `data-testid`.

### Finding selectors

Don't guess selectors — dump them. `prowl analyze` works on the macOS target the
same way it does on the web: it launches/attaches to the app, walks the
Accessibility tree, and prints every interactive element with **ranked selector
candidates** (best first) plus the app's windows and status-item menu contents.
It is read-only (the only interaction is opening and closing the status menu),
honors `guardrails.allowedApps`, and leaves the app running when done.

```bash
# Uses the macOS target from .prowl/config.yml:
prowl analyze

# …or point it at any app without a config:
prowl analyze --app com.example.App
prowl analyze --app "/Applications/Example.app"

# Machine-readable output for agents:
prowl analyze --app com.example.App --json
```

Example (human-readable) output:

```text
  App Analysis: com.example.App

  Windows:
    "Main Window" id=mainWindow

  Interactive Elements:
    AXButton id=saveButton "Save"
    AXTextField label="Email" "Email"
    AXCheckBox label="Remember me" "Remember me" (disabled)

  Menu Bar:
    AXMenuItem id=preferences "Preferences…"
    AXMenuItem label="Quit" "Quit"

  3 elements, 1 windows, 2 menu items
```

Selectors are ranked `id=` > `label=` > `role=…[name="…"]` > `text=` — copy the
first (most durable) candidate into your hunt. Status-item menu identifiers
(`id=preferences` above) are especially valuable, since menu titles often carry
ellipses or localized text that are awkward to match by substring.

### Step compatibility

Portable steps run on **both** targets; web-only steps are rejected up front on the
macOS target (with a clear error), and `prowl login` / URL guardrails do not apply.

| Portable (web + macOS) | Web-only (rejected on macOS) |
|---|---|
| `click`, `fill`, `type`, `press` | `navigate`, `waitForUrl`, `waitForNetworkIdle` |
| `wait`, `waitForSelector` | `mockRoute` / `unmockRoute` |
| `assert: visible` / `notVisible` | `evalScript`, `runScript` |
| `screenshot`, `assertScreenshot` | `onDialog`, `select` / `selectOption` |
| `hover`, `scrollTo` | `setInputFiles`, `waitForDownload` |
| `repeat`, `if`, `runHunt`, `copyText` | `scroll` (directional), `assert: urlIncludes` / `urlEquals` |

Notes: `press` maps Enter/Return/Space onto the element's activate action (other keys
are unsupported); `type` fills the focused control; app teardown quits the target app
after the run.

> Docs follow-up: the customer-facing docs site (`prowl-docs`) should gain a "macOS
> target" page mirroring this section (target type + step-compatibility matrix +
> permission setup); tracked separately from this repo.

---

## Android Target (Experimental)

> **Experimental (PROWL-058).** Prowl can drive **native Android apps** on an
> emulator or a USB-connected device, in addition to the web and macOS targets.
> It follows the same "external agent + JSON protocol" shape as the macOS target:
> `adb` handles device lifecycle and the on-device
> [`appium-uiautomator2-server`](https://github.com/appium/appium-uiautomator2-driver)
> (Apache-2.0) handles UI interaction over a plain HTTP/JSON API driven with raw
> `fetch`. The API, selector dialect, and step coverage may change.

### Requirements

- **`adb`** on your `PATH` (from the Android SDK platform-tools), plus at least
  one **booted emulator or device** (`adb devices -l` should list it as `device`).
- The two prebuilt agent APKs ship inside the `appium-uiautomator2-server` npm
  dependency and are installed onto the device automatically — **nothing to build**.
  No Appium server, no JVM, no gRPC.
- If `target.app` is an **`.apk`**, Android build-tools **`aapt`/`aapt2`** must be
  on `PATH` so Prowl can read the package name (or set `target.app` to the package
  name directly and install the APK yourself).

### Enabling it

Point your config at an Android target:

```yaml
target:
  type: android
  app: "com.example.app"        # a package name, or a path to an .apk to install
  # deviceSerial: "emulator-5554"  # required only when several devices are attached
  # coldStart: true                # `pm clear` before launch for a deterministic start (default off)
guardrails:
  allowedApps:                     # optional scope; empty = allow the target app
    - "com.example.app"
```

Then run a hunt as usual: `prowl run my-android-hunt`.

On launch Prowl selects the device (failing with an actionable error, listing
serials, if several are attached and no `deviceSerial` is set), installs the app
(when given an `.apk`) and the agent, starts the agent via `am instrument`,
port-forwards it on a **dynamically allocated** local port (so parallel sessions /
CI jobs don't collide), and waits for the agent to report ready. Everything is
torn down (agent session, instrumentation, port forward, `am force-stop`) after
the run. `guardrails.allowedApps` accepts Android package IDs or canonical full
`.apk` paths; when `target.app` is an APK, Prowl resolves its package ID and
validates it before installing.

### Selector dialect (Android)

Native selectors address `resource-id`, `content-desc`, visible text, and widget
class. Semantics match the macOS target so a selector means the same thing on both
native targets:

| Selector | Matches |
|---|---|
| `id=save` | element whose `resource-id` is `save` (bare name or full `com.pkg:id/save`) |
| `label="Submit"` | element whose `content-desc` equals `Submit` (exact) |
| `role=android.widget.Button` | element of that widget class |
| `role=android.widget.Button[name="Save"]` | that widget class whose visible text contains `Save` |
| `text="Save"` or bare `Save` | element whose visible text contains the text (substring) |

Prefer `id=` (the native analog of `data-testid`). **Jetpack Compose caveat:**
Compose nodes only expose a `resource-id` when the app sets
`Modifier.testTag(...)` **and** enables `testTagsAsResourceId = true`; otherwise
match Compose UI with `text=` or `label=` (from `Modifier.semantics { contentDescription = ... }`).
`forbiddenSelectors` still applies (text patterns use the same substring semantics
as the other targets).

### Step compatibility

Portable steps run on the Android target; web-only steps are rejected up front
(with a clear error), and `prowl login` / URL guardrails do not apply.

| Portable (Android) | Not supported on Android |
|---|---|
| `click`, `fill`, `type`, `press` | `navigate`, `waitForUrl`, `waitForNetworkIdle` |
| `wait`, `waitForSelector` | `mockRoute` / `unmockRoute`, `evalScript`, `runScript` |
| `assert: visible` / `notVisible` | `onDialog`, `select` / `selectOption`, `setInputFiles` |
| `screenshot`, `assertScreenshot` | `waitForDownload`, `scroll`, `assert: urlIncludes` / `urlEquals` |
| `repeat`, `if`, `runHunt`, `copyText` | `hover`, `scrollTo` (no touch equivalent yet — see below) |

Notes: `type` and `fill` set text on the focused / matched field **unicode-safely**
(via the agent's `element/value`, not `adb shell input text`); `press` maps key
names (`Enter`, `Tab`, `Backspace`, `Back`, `Home`, arrow keys, …) onto Android key
codes and dispatches them to the focused view. `hover` and `scrollTo` have no touch
equivalent yet and are rejected with a clear message; scroll-gesture support is a
follow-up. A degraded pure-`adb` fallback (`uiautomator dump` + `input tap`) is a
possible future diagnostic mode, not the primary path.

> Out of scope for PROWL-058 (tracked separately): `prowl analyze` for Android and
> CI recipes (PROWL-061), the unified native selector engine (PROWL-060), and real
> iOS devices (PROWL-062). The iOS **simulator** target ships below.

---

## iOS Target (Experimental)

> **Experimental (PROWL-059).** Prowl can drive **native iOS apps** on a **booted
> iOS Simulator**, in addition to the web, macOS, and Android targets. It follows
> the same "external agent + JSON protocol" shape: `xcrun simctl` handles simulator
> lifecycle and screenshots, and the on-simulator
> [WebDriverAgent](https://github.com/appium/WebDriverAgent) (Apache-2.0) handles UI
> interaction over its W3C-shaped HTTP/JSON API driven with raw `fetch`. The API,
> selector dialect, and step coverage may change. **Real devices are out of scope**
> (PROWL-062) — simulators only.

### Requirements

- **macOS with a full Xcode** (not just the command-line tools) installed and
  selected (`xcode-select -p`), so `xcrun simctl` and `xcodebuild` are available.
- At least one **booted simulator** (`xcrun simctl list devices | grep Booted`, or
  boot one with `xcrun simctl boot <udid>` / from Xcode).
- The **WebDriverAgent** runner is built **once** from the `appium-webdriveragent`
  npm dependency (`xcodebuild build-for-testing`) and cached under
  `~/.prowl/wda/<wda-version>-xcode<xcode-version>/`; the first run prints a one-time
  "building WebDriverAgent…" notice and can take a few minutes. Simulators need **no
  code signing**. Set `PROWL_WDA_RUNNER` to a prebuilt `WebDriverAgentRunner-Runner.app`
  to skip the build (e.g. in CI with a cached runner).

### Enabling it

Point your config at an iOS target:

```yaml
target:
  type: ios
  app: "com.example.App"          # a bundle id, or a path to a built .app to install
  # udid: "ABCD-1234"                # required only when several simulators are booted
  # coldStart: true                  # uninstall+reinstall before launch (requires a .app path)
guardrails:
  allowedApps:                       # optional scope; empty = allow the target app
    - "com.example.App"
```

Then run a hunt as usual: `prowl run my-ios-hunt`.

On launch Prowl selects the booted simulator (failing with an actionable error,
listing candidates, if several are booted and no `udid` is set), installs the app
(when given a `.app`, reading its bundle id from the bundle's **root** `Info.plist`),
builds/caches and installs the WebDriverAgent runner, launches it on a
**dynamically allocated** port (passed via `SIMCTL_CHILD_USE_PORT` so parallel
sessions / CI jobs don't collide), launches the target app, and waits for WDA to
report ready. Everything is torn down (WDA session, `simctl terminate` of the runner
and the app) after the run. `guardrails.allowedApps` accepts iOS bundle ids or
`.app` paths; a `.app` path is authorized by its path, bundle name, or the bundle id
read from its root `Info.plist`. Note: a bare `target.app` ending in `.app` is
treated as a **bundle id** unless a directory of that name exists, so bundle ids like
`com.company.app` are not mistaken for paths.

### Selector dialect (iOS)

Native selectors address accessibility ids, labels, visible text, and element type.
Semantics match the macOS/Android targets so a selector means the same thing across
native targets:

| Selector | Matches |
|---|---|
| `id=save` | element whose accessibility id (`accessibilityIdentifier` / name) is `save` |
| `label="Submit"` | element whose `accessibilityLabel` equals `Submit` (exact) |
| `role=XCUIElementTypeButton` | element of that type (shorthand `role=Button` works too) |
| `role=Button[name="Save"]` | that type whose visible `label`/`value` contains `Save` |
| `text="Save"` or bare `Save` | element whose `label` or `value` contains the text (substring) |
| `:focus` | the element with keyboard focus (`hasKeyboardFocus == 1`) |

Prefer `id=` (set `accessibilityIdentifier` in your app — the native analog of
`data-testid`). Text/label/role+name selectors compile to WDA NSPredicate strings
(quotes and backslashes are escaped). `forbiddenSelectors` still applies.

### Step compatibility

Portable steps run on the iOS target; web-only steps are rejected up front (with a
clear error), and URL guardrails do not apply.

| Portable (iOS) | Not supported on iOS |
|---|---|
| `click`, `fill`, `type`, `press` | `navigate`, `waitForUrl`, `waitForNetworkIdle` |
| `wait`, `waitForSelector` | `mockRoute` / `unmockRoute`, `evalScript`, `runScript` |
| `assert: visible` / `notVisible` | `onDialog`, `select` / `selectOption`, `setInputFiles` |
| `screenshot`, `assertScreenshot` | `waitForDownload`, `scroll`, `assert: urlIncludes` / `urlEquals` |
| `repeat`, `if`, `runHunt`, `copyText` | `hover`, `scrollTo` (no touch equivalent yet) |

Notes: `type` and `fill` set text on the focused / matched field via WDA's
`element/value`; `press` supports a small honest key set — `enter`/`return` and
`delete`/`backspace` (sent through WDA's key endpoint to the focused element) and
`home` (returns to the springboard) — and rejects other keys with the supported-keys
message. Screenshots are captured with `simctl` (not WDA), so artifacts still work
even if the agent wedges. `hover` and `scrollTo` have no touch equivalent yet and are
rejected with a clear message; scroll-gesture support is a follow-up.

> Out of scope for PROWL-059 (tracked separately): `prowl analyze` for iOS and CI
> recipes (PROWL-061), the unified native selector engine (PROWL-060), and real iOS
> devices (PROWL-062).

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
