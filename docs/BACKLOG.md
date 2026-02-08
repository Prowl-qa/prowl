# Prowl - Product Backlog

## Competitive Analysis

### Primary Competitor: Maestro (mobile-dev-inc)
- **Website**: maestro.dev | **GitHub**: 10.6k stars, 103 contributors
- **Funding**: $4M raised ($3M seed, Feb 2025)
- **Language**: Kotlin (77%) — requires Java 17+
- **License**: Apache 2.0
- **Pricing**: Free CLI, cloud at $250/device/mo (mobile), $125/browser/mo (web), enterprise custom

**Maestro's strengths**:
- Simpler syntax (`tapOn: "Sign In"` vs explicit selectors)
- MaestroGPT for AI-assisted test authoring
- Maestro Studio desktop IDE for visual test building
- Cloud execution with parallel runs
- Built-in CI/CD PR integration
- Continuous mode (file watcher re-runs on save)
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
**Description**: Add a `prowl watch <hunt-name>` command that monitors the hunt YAML file for changes and re-runs automatically on save. Maestro has this and it's a major DX improvement during hunt authoring.

**Acceptance Criteria**:
- `prowl watch <hunt-name>` starts a file watcher on the hunt file
- Re-runs the hunt on every save
- Displays pass/fail result in terminal with color
- `Ctrl+C` to stop
- Debounce rapid saves (300ms)

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

---

## Phase 4: Step Type Expansion

*All Phase 4 items resolved.*

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
