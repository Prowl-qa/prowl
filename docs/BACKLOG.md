# Prowl - Product Backlog

## Competitive Analysis

### Primary Competitor: Maestro (mobile-dev-inc)
- **Website**: maestro.dev | **GitHub**: 10.6k stars, 103 contributors
- **Funding**: $4M raised ($3M seed, Feb 2025)
- **Language**: Kotlin (77%) — requires Java 17+
- **License**: Apache 2.0
- **Pricing**: Free CLI, cloud at $250/device/mo (mobile), $125/browser/mo (web), enterprise custom
- **Commands**: 47+ YAML actions (tapOn, inputText, assertVisible, scroll, swipe, repeat, runFlow, evalScript, etc.)
- **Extras**: MaestroGPT (AI chatbot), Maestro Studio (desktop IDE), cloud parallel execution, VS Code extensions

**Maestro's strengths**:
- Simpler syntax (`tapOn: "Sign In"` vs explicit selectors)
- MaestroGPT for AI-assisted test authoring
- Maestro Studio desktop IDE for visual test building
- Cloud execution with parallel runs
- Built-in CI/CD PR integration with JUnit XML output
- Continuous mode (file watcher re-runs on save)
- Flow composition (`runFlow`) for reusable sub-flows
- Tags for filtering test suites
- JavaScript injection for complex logic
- Repeat/retry/conditional flow control
- Random data generators (email, name, number, etc.)
- Large community and adoption (10.6k stars)

**Maestro's weaknesses (Prowl's opportunities)**:
- Web support is in Beta — Chromium only, no locale support, no viewport configuration
- Accessibility-based selectors break on complex web apps (duplicate labels, dynamic content, shadow DOM)
- No guardrails (forbidden selectors, allowed domains, max steps)
- No variable redaction in reports (credential leak risk)
- Kotlin codebase excludes most web developers from contributing
- 415 open issues — scale is creating maintenance burden
- 7-minute cloud execution timeout
- No real iOS device support (simulator only)
- Network mocking requires external tools (WireMock, MockServer)
- No visual regression testing (screenshot diffing)
- Limited JavaScript engine (Rhino, migrating to GraalJS)
- Windows requires WSL2 — friction for Windows developers

### Differentiation Strategy

Prowl's positioning: **"The best YAML testing tool for web applications."**

Do not compete on mobile. Go deep on web where Maestro is shallow.

| Differentiator | Maestro | Prowl |
|---------------|---------|-------|
| Web support maturity | Beta, afterthought | Core focus |
| Selector precision | Accessibility-based (simple but fragile) | Playwright engine (surgical precision) |
| Safety guardrails | None | Forbidden selectors, allowed domains, max steps |
| Credential protection | None | Automatic `{{VAR}}` redaction in reports |
| Contributor accessibility | Kotlin + Java 17 | TypeScript + Node.js |
| AI integration approach | Chat sidebar (MaestroGPT) | MCP server (any AI agent can generate/run hunts) |
| Artifact richness | Basic pass/fail | Screenshots every step, console logs, network errors, Playwright traces |
| Network mocking | Requires external tools | Built-in (planned — Playwright `page.route()`) |
| Visual regression | Not available | Built-in screenshot diffing (planned) |
| Multi-browser | Chromium only | Chromium, Firefox, WebKit via Playwright (planned) |

Key insight: Maestro proved the YAML-declarative model works and has real market demand. Prowl applies that proven model to web testing with better precision, safety, and developer tooling.

---

## Phase 1.5: Syntax Simplification (Compete with Maestro)

### P1.5-001: Shorthand Step Syntax
**Priority**: Critical
**Description**: Add shorthand syntax for common step types so hunts are as easy to write as Maestro flows. Both shorthand and explicit forms must be supported — shorthand for simplicity, explicit for precision.

**Shorthand mappings**:
```yaml
# Shorthand (new)                    # Explicit (current, still supported)
- click: "Sign In"                   - click:
                                         selector: 'button:has-text("Sign In")'

- fill:                              - fill:
    "Email": "user@test.com"             selector: 'input[placeholder="Email"]'
                                         value: "user@test.com"

- type: "Hello world"                - fill:
                                         selector: ':focus'
                                         value: "Hello world"

- select:                            - selectOption:
    "State": "FL"                        selector: 'select[name="state"]'
                                         value: "FL"
```

**Acceptance Criteria**:
- When `click` value is a string (not an object), treat it as `button:has-text("value")` or `text=value`
- When `fill` value is a key-value pair (label: value), resolve the label to the nearest input via Playwright's label matching or placeholder matching
- Explicit object syntax continues to work unchanged (backward compatible)
- Schema validation accepts both forms
- Variable interpolation works in shorthand values
- Unit tests for both shorthand and explicit parsing
- Documentation updated with shorthand examples

### P1.5-002: `assert` Inline Step Type
**Priority**: High
**Maestro equivalent**: `assertVisible`, `assertNotVisible`
**Description**: Add an inline assertion step that can be used mid-flow (not just at the end). Maestro has `assertVisible` and `assertNotVisible` as flow steps. Prowl should match this capability.

```yaml
- assert:
    visible: "Welcome back"
- assert:
    notVisible: "Error"
- assert:
    urlIncludes: "/dashboard"
```

**Acceptance Criteria**:
- New `assert` step type with `visible`, `notVisible`, `urlIncludes`, `urlEquals` sub-properties
- Fails the hunt immediately if assertion fails (same as any step failure)
- Screenshot captured on assertion failure
- Schema validation
- Unit tests

### P1.5-003: `wait` Shorthand
**Priority**: Medium
**Description**: Simplify `waitForSelector` with a more readable shorthand.

```yaml
# Shorthand (new)                    # Explicit (current)
- wait: "Welcome"                    - waitForSelector:
                                         selector: 'text=Welcome'
                                         timeout: 30000

- wait:                              - waitForSelector:
    for: "Welcome"                       selector: 'text=Welcome'
    timeout: 5000                        timeout: 5000
```

**Acceptance Criteria**:
- When `wait` value is a string, treat as `waitForSelector` with `text=value` and default timeout
- When `wait` is an object with `for` and optional `timeout`, map accordingly
- Explicit `waitForSelector` still works unchanged
- Schema validation, unit tests

### P1.5-004: Continuous Watch Mode
**Priority**: Medium
**Maestro equivalent**: Built-in continuous mode
**Description**: Add a `prowl watch <hunt-name>` command that monitors the hunt YAML file for changes and re-runs automatically on save. Maestro has this and it's a major DX improvement during hunt authoring.

**Acceptance Criteria**:
- `prowl watch <hunt-name>` starts a file watcher on the hunt file
- Re-runs the hunt on every save
- Displays pass/fail result in terminal with color
- `Ctrl+C` to stop
- Debounce rapid saves (300ms)

---

## Phase 1.6: v1 Launch Readiness

Everything needed to publish Prowl as a usable product for early adopters.

### P1.6-001: Hunt Tags & Filtering
**Priority**: High
**Maestro equivalent**: `tags` field + `--include-tags` / `--exclude-tags`
**Description**: Add a `tags` field to hunt YAML schema so hunts can be categorized and filtered.

```yaml
name: login-flow
tags: ["smoke", "auth"]
steps:
  - navigate: "/login"
```

**Acceptance Criteria**:
- `tags` field added to hunt YAML schema (string array, optional)
- `prowl run <hunt> --include-tags smoke` / `--exclude-tags slow`
- `prowl list` shows tags per hunt
- Schema validation
- Unit tests

### P1.6-002: Hunt Composition (`runHunt` step)
**Priority**: High
**Maestro equivalent**: `runFlow`
**Description**: New step type that executes another hunt file inline. Enables reusable sub-flows (login, navigate to page, dismiss popups).

```yaml
# Simple form
- runHunt: "login"

# With variable overrides
- runHunt:
    name: "login"
    vars:
      EMAIL: "admin@test.com"
      PASSWORD: "{{ADMIN_PASSWORD}}"
```

**Acceptance Criteria**:
- `runHunt: "name"` or `runHunt: { name: string, vars?: Record<string, string> }`
- Loads and executes the referenced hunt file inline
- Variables can be passed to the sub-hunt (override its vars)
- Errors in sub-hunt fail the parent hunt with clear error attribution
- Circular dependency detection (hunt A calls B calls A → error)
- Screenshots from sub-hunt included in parent report
- Schema validation, unit tests

### P1.6-003: Retry Logic
**Priority**: Medium
**Maestro equivalent**: `retry` command (per-step)
**Description**: Add hunt-level retry configuration for flaky environments.

```yaml
name: flaky-api-test
retry:
  maxRetries: 2
  delay: 1000
steps:
  - navigate: "/"
```

**Acceptance Criteria**:
- `retry` field in hunt YAML: `{ maxRetries: number, delay?: number }`
- Retries entire hunt on failure (not individual steps)
- Report shows which attempt succeeded and total attempts
- Delay between retries (default 0)
- Schema validation, unit tests

### P1.6-004: Expanded Examples
**Priority**: High
**Description**: Ship 4-5 example hunts with `prowl init` (not just homepage.yml). Each example heavily commented as a learning resource.

**Acceptance Criteria**:
- `examples/hunts/homepage.yml` — basic page load (existing, enhance with comments)
- `examples/hunts/login-flow.yml` — auth flow with fill + click + waitForUrl
- `examples/hunts/form-submit.yml` — fill form, submit, verify success
- `examples/hunts/crud-example.yml` — create, verify, edit, verify pattern with comments
- All examples include descriptive comments explaining each step
- `prowl init` copies all examples

### P1.6-005: Enhanced `prowl list` Output
**Priority**: Low
**Description**: Currently `prowl list` only shows hunt names. Enhance to show descriptions and tags.

**Acceptance Criteria**:
- `prowl list` shows: name, description (truncated), tags
- Formatted as a table or aligned columns
- `prowl list --json` outputs JSON for programmatic use
- Unit tests

### P1.6-006: npm Publish Readiness
**Priority**: High
**Description**: Prepare the package for public npm release.

**Acceptance Criteria**:
- Verify `prowl` package name availability on npm (fallback: `@prowl/cli` or `prowl-test`)
- `npm pack` produces a clean tarball with only `dist/` and `examples/`
- Full install flow tested: `npm install -g`, `prowl init`, `prowl run homepage`
- Add `LICENSE` file (Apache 2.0)
- Add `keywords` to package.json: `["testing", "qa", "playwright", "yaml", "e2e", "browser-testing", "automation"]`
- Add `repository`, `homepage`, `bugs` fields to package.json
- Verify `prowl --help` output is clean and informative

### P1.6-007: Documentation Site / Comprehensive README
**Priority**: High
**Maestro equivalent**: docs.maestro.dev
**Description**: Expand README or create a docs site with complete reference material. Prowl needs equivalent documentation depth to Maestro.

**Acceptance Criteria**:
- Getting Started guide (install → init → write first hunt → run)
- Complete step type reference (all types with examples and edge cases)
- Complete assertion reference
- Config reference (every option with defaults and descriptions)
- Variable interpolation guide (`{{VAR}}`, precedence, redaction behavior)
- Selector best practices guide (data-testid > aria-label > placeholder > class)
- Auth setup guide (`prowl login` workflow)
- Troubleshooting / FAQ
- Migration guide from Playwright scripts to Prowl hunts

### P1.6-008: `hover` Step Type
**Priority**: Low
**Description**: Trigger CSS hover states and tooltip visibility.

```yaml
- hover:
    selector: ".dropdown-trigger"
```

**Acceptance Criteria**:
- `hover: { selector: string }` step type
- Playwright: `page.locator(selector).hover()`
- Forbidden selector check
- Schema validation, unit tests

### P1.6-009: `scroll` Step Type
**Priority**: Medium
**Description**: Scroll the page or a specific container.

```yaml
# Scroll the page down
- scroll:
    direction: "down"
    amount: 500

# Scroll an element into view
- scrollTo:
    selector: "#footer"
```

**Acceptance Criteria**:
- `scroll: { selector?: string, direction: "up" | "down" | "left" | "right", amount?: number }`
- `scrollTo: { selector: string }` — scrolls element into view via `scrollIntoViewIfNeeded()`
- Schema validation, unit tests
- Maestro equivalent: `scroll`, `scrollUntilVisible`

### P1.6-010: Multi-Browser Support
**Priority**: Medium
**Maestro weakness**: Chromium only for web
**Description**: Allow users to choose which browser engine to test with.

**Acceptance Criteria**:
- Config option: `browser.engine: "chromium" | "firefox" | "webkit"` (default: "chromium")
- Playwright already supports all three — pass engine choice to `playwright[engine].launch()`
- CLI override: `prowl run homepage --browser firefox`
- Schema validation, unit tests

### P1.6-011: Viewport Configuration
**Priority**: Medium
**Maestro weakness**: No viewport configuration
**Description**: Configure browser viewport size for responsive testing.

**Acceptance Criteria**:
- Config option: `browser.viewport: { width: number, height: number }`
- Named presets: `browser.viewport: "mobile"` (375x812), `"tablet"` (768x1024), `"desktop"` (1280x720)
- CLI override: `prowl run homepage --viewport 1920x1080`
- Schema validation, unit tests

---

## Phase 2: CI Integration & Automated Issue Reporting

### P2-001: `prowl ci` Command
**Priority**: High
**Description**: Add a `ci` subcommand that runs all hunts in `.prowl/hunts/` sequentially and produces a combined pass/fail exit code. Designed for unattended execution in CI pipelines or scheduled cron jobs.
**Acceptance Criteria**:
- Runs every `.yml` hunt in the hunts directory
- Returns exit code 0 if all pass, 1 if any fail
- Outputs a combined summary report across all hunts
- Supports `--config` flag to override config path

### P2-002: GitHub Issue Creation on Failure
**Priority**: High
**Description**: When `prowl ci` detects a failure, automatically create a GitHub issue using `gh issue create` with failure details, screenshots, and repro steps parsed from the hunt YAML and `result.json`.
**Acceptance Criteria**:
- Issue title includes hunt name and failure reason
- Issue body includes: failure summary, repro steps from hunt YAML, assertion results
- Screenshots attached or linked
- Labels applied (e.g., `prowl-regression`, `automated`)
- Deduplication: don't create a duplicate issue if one already exists for the same hunt

### P2-003: Configurable Issue Reporting
**Priority**: Medium
**Description**: Add a `reporting` section to `config.yml` that controls where and how issues are filed.
**Acceptance Criteria**:
- Config option for target repo (`reporting.github.repo`)
- Config option for labels (`reporting.github.labels`)
- Config option to enable/disable auto-issue creation (`reporting.github.enabled`)
- Config option for assignees (`reporting.github.assignees`)

### P2-004: JUnit XML Report Output
**Priority**: High
**Maestro equivalent**: Built-in JUnit XML support
**Description**: Generate `junit.xml` alongside `summary.md` and `result.json`. Standard format consumed by GitHub Actions, Jenkins, GitLab, etc.

**Acceptance Criteria**:
- `junit.xml` generated in run directory alongside existing reports
- Conforms to JUnit XML schema (testsuite, testcase, failure elements)
- Each step mapped to a testcase; failed steps include error message
- Config option: `artifacts.junit: true` (default: false)
- `prowl run --junit` flag
- Unit tests

### P2-005: Hunt Tagging in CI
**Priority**: Medium
**Depends on**: P1.6-001
**Description**: Filter which hunts run in CI by tags.

**Acceptance Criteria**:
- `prowl ci --include-tags smoke` runs only tagged hunts
- `prowl ci --exclude-tags slow` excludes tagged hunts
- Enables smoke vs. regression vs. nightly suites from the same hunt collection

### P2-006: Parallel Hunt Execution
**Priority**: Medium
**Maestro equivalent**: `--shard-all N` / `--shard-split N`
**Description**: Run multiple hunts concurrently in CI.

**Acceptance Criteria**:
- `prowl ci --parallel 3` runs up to 3 hunts concurrently
- Each hunt gets its own browser instance
- Combined report aggregates all results
- Respects hunt dependency order if P6-007 is implemented

### P2-007: Slack/Webhook Notifications
**Priority**: Low
**Description**: Post results to external services on hunt failure.

**Acceptance Criteria**:
- Config option: `reporting.webhook.url` — POST JSON results to webhook on failure
- Config option: `reporting.slack.webhook` — formatted Slack message
- Include: hunt name, status, failure reason, link to artifacts
- Unit tests for webhook payload formatting

---

## Bugs

*No open bugs.*

---

## Phase 3: Agent-Driven Fix Pipeline

### P3-001: GitHub Actions Workflow for Scheduled Prowl Runs
**Priority**: High
**Description**: Provide a reusable GitHub Actions workflow that runs `prowl ci` on a schedule (e.g., nightly) or on PR events against a target application.
**Acceptance Criteria**:
- Workflow template that users can copy into their repos
- Configurable schedule (cron) and trigger events
- Prowl installed and executed within the action
- Artifacts (screenshots, reports) uploaded as workflow artifacts
- Issue creation triggered on failure

### P3-002: Claude/Codex Agent Issue Pickup
**Priority**: High
**Description**: When a `prowl-regression` labeled issue is created, trigger a Claude or Codex agent to read the issue, analyze the failure, and open a fix PR.
**Acceptance Criteria**:
- Agent triggered by issue label via GitHub Actions
- Agent reads issue body for failure context (hunt YAML, assertion results, screenshots)
- Agent checks out the repo, identifies the likely source of the failure
- Agent opens a draft PR with the proposed fix
- PR references the original issue

### P3-003: Feedback Loop - Re-run Prowl on Fix PRs
**Priority**: Medium
**Description**: When a fix PR is opened by the agent, automatically re-run the failed Prowl hunt against the PR branch to verify the fix before review.
**Acceptance Criteria**:
- GitHub Actions triggers `prowl run <failed-hunt>` on the PR branch
- Results posted as a PR comment (pass/fail with screenshots)
- PR auto-labeled as `prowl-verified` if the hunt passes

---

## Phase 4: Advanced Step Types & Flow Control

### P4-001: `repeat` Step Type
**Priority**: Medium
**Maestro equivalent**: `repeat` with `while`/`max`
**Description**: Repeat a block of steps N times or until a condition is met.

```yaml
- repeat:
    times: 3
    steps:
      - click:
          selector: ".load-more"
      - waitForNetworkIdle: {}

# Conditional repeat
- repeat:
    while:
      visible: ".load-more"
    maxIterations: 10
    steps:
      - click:
          selector: ".load-more"
      - waitForNetworkIdle: {}
```

**Acceptance Criteria**:
- `repeat: { times: number, steps: Step[] }` — fixed count
- `repeat: { while: { visible | notVisible: string }, maxIterations: number, steps: Step[] }` — conditional
- Steps within repeat use same execution context (page, guardrails)
- Schema validation, unit tests

### P4-002: `if` / Conditional Steps
**Priority**: Medium
**Maestro equivalent**: `runFlow` with `when` conditions
**Description**: Execute steps conditionally based on element visibility or URL. Handles optional UI elements (cookie banners, modals, onboarding) without breaking the flow.

```yaml
- if:
    visible: ".cookie-banner"
    then:
      - click:
          selector: ".accept-cookies"

- if:
    notVisible: ".welcome-modal"
    then:
      - navigate: "/onboarding"
```

**Acceptance Criteria**:
- `if: { visible | notVisible: string, then: Step[] }`
- Condition check uses zero-timeout element count (instant, no waiting)
- If condition is false, skip `then` steps silently (not a failure)
- Schema validation, unit tests

### P4-003: JavaScript Evaluation Step
**Priority**: Medium
**Maestro equivalent**: `evalScript`, `runScript`
**Description**: Execute JavaScript in the browser context for complex logic that YAML can't express.

```yaml
# Inline evaluation
- evalScript: "document.title"

# External script file
- runScript:
    file: "scripts/setup-data.js"

# Store result as variable
- evalScript:
    expression: "document.querySelectorAll('tr').length"
    as: "ROW_COUNT"
```

**Acceptance Criteria**:
- `evalScript: string` — evaluate JS expression in page context
- `evalScript: { expression: string, as?: string }` — evaluate and store result as variable
- `runScript: { file: string }` — run external JS file (relative to `.prowl/`)
- `page.evaluate()` under the hood
- Schema validation, unit tests

### P4-004: `copyText` Step Type
**Priority**: Low
**Maestro equivalent**: `copyTextFrom` + `maestro.copiedText`
**Description**: Extract text content from an element and store it as a variable for later use.

```yaml
- copyText:
    selector: ".order-number"
    as: "ORDER_ID"

# Use the copied value later
- waitForSelector:
    selector: "text={{ORDER_ID}}"
```

**Acceptance Criteria**:
- `copyText: { selector: string, as: string }` — extract `textContent` and store as variable
- Variable available for `{{VAR}}` interpolation in subsequent steps
- Forbidden selector check
- Schema validation, unit tests

### P4-005: Network Interception / Mocking
**Priority**: High
**Maestro weakness**: Requires external tools (WireMock, MockServer)
**Description**: Intercept and mock API responses within hunt YAML. Prowl differentiator — Playwright has `page.route()` built in.

```yaml
# Mock an API response
- mockRoute:
    url: "**/api/users"
    response:
      status: 200
      contentType: "application/json"
      body: '{"users": []}'

# Mock with file
- mockRoute:
    url: "**/api/orders"
    response:
      status: 200
      file: "fixtures/orders.json"

# Remove mock
- unmockRoute:
    url: "**/api/users"
```

**Acceptance Criteria**:
- `mockRoute: { url: string, response: { status: number, contentType?: string, body?: string, file?: string } }`
- `unmockRoute: { url: string }` — remove a previously set mock
- URL supports glob patterns (`**/api/*`)
- File paths relative to `.prowl/`
- Mocks persist for the duration of the hunt (or until unmocked)
- Schema validation, unit tests
- Critical for testing error states, empty states, loading states

### P4-006: `waitForResponse` Step Type
**Priority**: Medium
**Description**: Wait for a specific network response before continuing. More precise than `waitForNetworkIdle`.

```yaml
- waitForResponse:
    url: "**/api/orders"
    status: 200
    timeout: 10000
```

**Acceptance Criteria**:
- `waitForResponse: { url: string, status?: number, timeout?: number }`
- URL supports glob/substring matching
- Optional status filter (only resolve when response matches status)
- Playwright: `page.waitForResponse()`
- Schema validation, unit tests

### P4-007: Geolocation Simulation
**Priority**: Low
**Maestro equivalent**: `setLocation`
**Description**: Simulate geographic location for location-dependent web features.

```yaml
# In config.yml
browser:
  geolocation:
    latitude: 25.7617
    longitude: -80.1918

# Or as a step
- setGeolocation:
    latitude: 25.7617
    longitude: -80.1918
```

**Acceptance Criteria**:
- Config option: `browser.geolocation: { latitude: number, longitude: number }`
- Step type: `setGeolocation: { latitude: number, longitude: number }`
- Playwright: `context.grantPermissions(['geolocation'])` + `context.setGeolocation()`
- Schema validation, unit tests

### P4-008: `doubleClick` and `rightClick` Step Types
**Priority**: Low
**Description**: Additional click variants for web-specific interactions (text selection, context menus).

```yaml
- doubleClick:
    selector: ".editable-text"
- rightClick:
    selector: ".context-menu-trigger"
```

**Acceptance Criteria**:
- `doubleClick: { selector: string }` — Playwright `dblclick()`
- `rightClick: { selector: string }` — Playwright `click({ button: 'right' })`
- Forbidden selector checks
- Schema validation, unit tests

---

## Phase 5: MCP Server & AI Integration

### P5-001: MCP Server Core
**Priority**: High
**Description**: Expose Prowl functionality as an MCP (Model Context Protocol) server so any AI agent (Claude Code, Codex, Cursor, etc.) can run hunts, read results, and list available hunts programmatically.
**Acceptance Criteria**:
- `prowl mcp` command starts the MCP server
- Tools exposed: `prowl_run`, `prowl_list`, `prowl_get_results`
- Returns structured JSON responses
- Works with Claude Code's MCP configuration

### P5-002: Page Analysis Tool
**Priority**: High
**Description**: Add a `prowl_analyze_page` MCP tool that crawls a running page and returns a structured description of all interactive elements, their selectors, and form structure.
**Acceptance Criteria**:
- Launches browser, navigates to URL, extracts all interactive elements
- Returns element type, best selector candidates (ranked by stability), labels, placeholder text
- Detects form groups and required fields
- Output is JSON consumable by AI models

### P5-003: AI Hunt Generation Tool
**Priority**: High
**Description**: Add a `prowl_generate_hunt` MCP tool that takes a page analysis + intent description and generates a complete hunt YAML file.
**Acceptance Criteria**:
- Accepts page analysis JSON + intent string (e.g., "test the edit flow")
- Generates valid hunt YAML with steps and assertions
- Uses shorthand syntax where appropriate
- Writes hunt file to `.prowl/hunts/`

### P5-004: AI-Powered Assertions
**Priority**: Medium
**Maestro equivalent**: `assertWithAI`, `assertNoDefectsWithAi`
**Description**: Use an LLM to verify complex visual or behavioral conditions that can't be expressed as simple selectors.

```yaml
- assertWithAI: "The login form should have email and password fields visible"
- assertWithAI: "The navigation bar should show the user's name"
```

**Acceptance Criteria**:
- `assertWithAI: string` step type
- Screenshots the page, sends screenshot + assertion text to LLM
- Returns pass/fail with explanation
- Configurable model endpoint (config option)
- Graceful degradation if no AI endpoint configured (skip with warning)
- Schema validation, unit tests

### P5-005: Self-Healing Selectors
**Priority**: High
**Description**: When a selector fails, attempt to find the element using alternative strategies before failing the hunt.

**Acceptance Criteria**:
- On selector failure, capture page state and attempt alternatives:
  1. Similar text content (fuzzy match)
  2. Similar ARIA role/label
  3. Nearby element with matching structure
- If healed, log the original selector and the healed selector as a warning
- Config option: `guardrails.selfHealing: true | false` (default: false)
- Report includes healed selector suggestions for the user to update their hunt
- Key selling point for long-term test maintenance

---

## Phase 6: Developer Experience & Ecosystem

### P6-001: VS Code Extension
**Priority**: High
**Maestro equivalent**: Maestro Workbench + Maestro Assistant
**Description**: VS Code extension for Prowl hunt authoring and execution.

**Acceptance Criteria**:
- YAML syntax highlighting for `.prowl/hunts/*.yml` with Prowl schema awareness
- IntelliSense/autocomplete for step types, assertion types, config options
- Run hunt from editor (right-click → "Run Hunt" or CodeLens above hunt name)
- View results inline (pass/fail badges, screenshot previews in hover)
- Go-to-definition for `runHunt` references
- Publish to VS Code Marketplace

### P6-002: `prowl studio` — Interactive Test Builder
**Priority**: High
**Maestro equivalent**: Maestro Studio Desktop
**Description**: Open a browser alongside a terminal UI. Click elements to generate YAML steps. See selectors on hover. Export to hunt file.

**Acceptance Criteria**:
- `prowl studio` opens target URL in headed browser with inspector overlay
- Clicking elements generates YAML step (click/fill/etc.) in terminal or output file
- Hovering shows available selectors for each element
- Export accumulated steps to `.prowl/hunts/<name>.yml`
- Support for recording fill values (prompt user for input)

### P6-003: `prowl doctor` — Environment Health Check
**Priority**: Medium
**Description**: Verify that the user's environment is correctly set up for Prowl.

**Acceptance Criteria**:
- Checks: Node.js version (>=20), Playwright installed, Chromium available, `.prowl/` exists, `config.yml` valid
- Actionable error messages for each failing check
- `prowl doctor --fix` attempts auto-repair (install chromium, create `.prowl/`)
- Color-coded output (green check / red X)

### P6-004: Random Data Generators
**Priority**: Low
**Maestro equivalent**: `inputRandomEmail`, `inputRandomPersonName`, `inputRandomNumber`, etc.
**Description**: Built-in variables that generate random data per run.

**Acceptance Criteria**:
- `{{RANDOM_EMAIL}}` — generates `prowl_<uuid>@test.com`
- `{{RANDOM_NAME}}` — generates random first + last name
- `{{RANDOM_NUMBER}}` — generates random integer
- `{{RANDOM_UUID}}` — generates UUID v4
- `{{RANDOM_TEXT}}` — generates random alphanumeric string
- Generated once per hunt run, consistent within a run
- No `.env` configuration needed

### P6-005: Video Recording
**Priority**: Medium
**Description**: Record full hunt execution as MP4 video.

**Acceptance Criteria**:
- Config option: `artifacts.video: true` (default: false)
- CLI flag: `prowl run homepage --video`
- Playwright: `context.newPage({ recordVideo: { dir: ... } })`
- Video saved to run directory alongside screenshots
- Useful for sharing failures with non-technical stakeholders

### P6-006: Visual Regression Testing
**Priority**: Medium
**Maestro weakness**: Not available
**Description**: Compare screenshots against baselines to detect visual changes. Prowl differentiator.

```yaml
- assertScreenshot:
    name: "homepage"
    threshold: 0.1
```

**Acceptance Criteria**:
- `assertScreenshot: { name: string, threshold?: number }` step type
- Compares current screenshot against baseline in `.prowl/baselines/<name>.png`
- Fails if pixel diff percentage exceeds threshold (default: 0.05 = 5%)
- On first run (no baseline), auto-save as baseline
- `prowl update-baselines` command accepts current screenshots as new baselines
- Diff image saved to artifacts showing changed pixels
- Schema validation, unit tests

### P6-007: Hunt Dependency Graph
**Priority**: Low
**Description**: Define execution order dependencies between hunts for `prowl ci`.

```yaml
name: edit-order
dependsOn: ["create-order"]
steps:
  - navigate: "/orders"
```

**Acceptance Criteria**:
- `dependsOn` field in hunt YAML: string array of hunt names
- `prowl ci` resolves dependency order (topological sort)
- If a dependency fails, skip dependent hunts (mark as "skipped" in report)
- Circular dependency detection → error
- Schema validation, unit tests

---

## Phase 7: Cloud & Scale (Future — TBD)

*Decision deferred. Include as placeholders. Revisit based on adoption and traction.*

### P7-001: Prowl Cloud — Hosted Execution
**Priority**: Future/TBD
**Description**: SaaS platform for running hunts on hosted browsers. Parallel execution across browser/viewport combinations. Dashboard with historical results, trends, flake detection. Potential revenue model: per-browser/month pricing.

### P7-002: Browser Matrix Testing
**Priority**: Future/TBD
**Description**: Run same hunt across Chromium + Firefox + WebKit in one command. `prowl ci --browsers chromium,firefox,webkit`. Combined report showing per-browser results.

### P7-003: Responsive Matrix Testing
**Priority**: Future/TBD
**Description**: Run same hunt across multiple viewports. `prowl ci --viewports mobile,tablet,desktop`. Each viewport gets its own screenshot set.

---

## Resolved

### ~~FEAT-001: `selectOption` Step Type~~
**Resolved**: 2026-02-06 (commit aa9188c)
**Description**: Added `selectOption: { selector, value }` step type for `<select>` dropdowns.

### ~~BUG-001: Nested Variable Interpolation Not Supported~~
**Resolved**: 2026-02-07 (commit 72fd515)
**Description**: Hunt var values referencing env vars via `{{...}}` are now pre-interpolated against env vars before merging into the lookup map. Regression test added.

### ~~BUG-002: `init` Command Path Resolution Broken After Bundling~~
**Resolved**: 2026-02-07 (commit 72fd515)
**Found during**: End-user workflow review (2026-02-07)
**Description**: `getPackageRoot()` in `src/cli/commands/init.ts` used a hardcoded `"../../../"` relative path that only worked for the source layout. After tsup bundles to `dist/index.js`, the path resolved 2 levels above the project root. Replaced with a directory walk that finds the nearest `package.json`.

### ~~BUG-003: `examples/` Not Included in npm Package~~
**Resolved**: 2026-02-07 (commit 72fd515)
**Found during**: End-user workflow review (2026-02-07)
**Description**: `package.json` `files` field only included `"dist"`, so `examples/` was excluded from `npm publish`. The `init` command copies from `examples/`, so it would fail after `npm install -g`. Added `"examples"` to the `files` array.

### ~~FEAT-002: `setInputFiles` Step Type~~
**Resolved**: 2026-02-07 (commit af2700b)
**Description**: Added `setInputFiles: { selector, files }` step type for `<input type="file">` elements. Supports single file or array of paths relative to `.prowl/` directory. Unit tests added.

### ~~FEAT-003: `onDialog` Step Type (Dialog Handler)~~
**Resolved**: 2026-02-07 (commit af2700b)
**Description**: Added `onDialog: { action }` step type where action is `"accept"` or `"dismiss"`. Sets up a `page.once('dialog')` listener for browser-native dialogs. Unblocks delete flow hunts and idempotent test cycles. Unit tests added.
