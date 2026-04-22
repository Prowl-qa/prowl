# Prowl - Product Backlog

## High Priority

{PROWL-010} **LEGAL-001: Trademark Clearance for "Prowl" Brand**
   The word "Prowl" has existing trademark registrations in adjacent software classes. While the goods/services are substantially different from QA testing, professional clearance is recommended before investing heavily in the brand.

**Existing registrations found**:
- **Oris Intel, LLC** — "PROWL" in Class 42 (SaaS software) for price monitoring, reseller identification, and policy enforcement tools (Reg. 4880040, registered 2016-01-05). Closest concern — same trademark class, but very different goods.
- **Camgian Microsystems Corp.** — "PROWL" in Class 9 for radar/tracking software (Reg. 4471189). Different goods and market.
- **Prowl iOS app** (prowlapp.com) — Push notification client operating since 2009. Common-law trademark rights in developer-adjacent space.
- **"prowlai"** — No existing conflicts found.
- **"Prowl QA"** — No existing conflicts found. "QA" adds differentiation.

**Action items**:
- Consult a trademark attorney for a clearance opinion
- Consider filing a trademark application in Classes 9 and 42 specifically for QA testing tools
- Using "Prowl QA" or "prowlai" as the primary brand provides stronger differentiation

{PROWL-023} **P5-005: Self-Healing Selectors**
   When a selector fails, attempt to find the element using alternative strategies before failing the hunt.

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

{PROWL-024} **P6-001: VS Code Extension**
   VS Code extension for Prowl hunt authoring and execution.

**Maestro equivalent**: Maestro Workbench + Maestro Assistant

**Acceptance Criteria**:
- YAML syntax highlighting for `.prowl/hunts/*.yml` with Prowl schema awareness
- IntelliSense/autocomplete for step types, assertion types, config options
- Run hunt from editor (right-click → "Run Hunt" or CodeLens above hunt name)
- View results inline (pass/fail badges, screenshot previews in hover)
- Go-to-definition for `runHunt` references
- Publish to VS Code Marketplace

{PROWL-025} **P6-002: `prowl studio` — Interactive Test Builder**
   Open a browser alongside a terminal UI. Click elements to generate YAML steps. See selectors on hover. Export to hunt file.

**Maestro equivalent**: Maestro Studio Desktop

**Acceptance Criteria**:
- `prowl studio` opens target URL in headed browser with inspector overlay
- Clicking elements generates YAML step (click/fill/etc.) in terminal or output file
- Hovering shows available selectors for each element
- Export accumulated steps to `.prowl/hunts/<name>.yml`
- Support for recording fill values (prompt user for input)

{PROWL-031} **P7-001: Run History and Trend Tracking**
   Persist run results beyond local filesystem ephemeral directories. Track pass/fail history over time per hunt. Foundation for all other reliability features.

**Found during**: Gap analysis (2026-02-16)
**Acceptance Criteria**:
- `prowlqa history <hunt-name>` shows last N runs with status, duration, and timestamp
- `prowlqa history <hunt-name> --json` for programmatic access
- Results stored in `.prowlqa/history.json` (append-only, one entry per run)
- Configurable retention: `history.maxRuns` (default: 100)
- History written automatically after every `prowlqa run` and `prowlqa ci`
- Foundation for flake detection, trend analysis, and dashboard features

{PROWL-032} **P7-002: Flake Detection and Scoring**
   Identify intermittently failing hunts by analyzing run history. Assign a flake score based on pass/fail oscillation frequency. Flaky hunts are the #1 reason teams lose trust in test suites.

**Found during**: Gap analysis (2026-02-16)
**Acceptance Criteria**:
- `prowlqa flaky` lists hunts ranked by flake score (highest first)
- `prowlqa flaky --json` for programmatic access
- Flake score: percentage of runs where status differs from the previous run (over last N runs)
- Hunts with score > threshold flagged as "flaky" in CI summary and `ci-result.json`
- Config option: `reliability.flakyThreshold` (default: 0.3 = 30% oscillation rate)
- Requires P7-001 (run history) as a prerequisite

## Medium Priority

{PROWL-008} **BUG-005: Forbidden Selector Matching Uses Substring (Overly Permissive)**
   `matchesForbiddenPattern()` in `src/runner/steps.ts` uses `includes()` for text matching. Forbidding `"delete"` also forbids `"undelete"` or `"Delete History"`. The same substring-based matching affects network ignore patterns in `src/runner/assertions.ts`. This could cause unexpected step failures or missed network errors.

**Found during**: Code review (2026-02-10)
**File**: `src/runner/steps.ts` (lines 57-69), `src/runner/assertions.ts` (lines 15-24)
**Fix**: Document current substring behavior in README. Consider adding exact-match (`text-is`) and regex support as options in a future phase.

{PROWL-011} **LEGAL-002: Add Dependency License Audit to CI**
   All direct dependencies are confirmed clean — MIT (commander, chalk, zod, ora), ISC (yaml), BSD-2-Clause (dotenv), Apache 2.0 (playwright, typescript). However, transitive dependencies can introduce GPL-licensed packages. Research shows 7.3% of npm packages have license incompatibilities through transitive deps.

**Action**: Add `license-checker` to CI pipeline:
```bash
npx license-checker --summary --exclude 'MIT,ISC,Apache-2.0,BSD-2-Clause,BSD-3-Clause'
```

---

{PROWL-017} **P4-006: `waitForResponse` Step Type**
   Wait for a specific network response before continuing. More precise than `waitForNetworkIdle`.

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

{PROWL-020} **P5-004: AI-Powered Assertions**
   Use an LLM to verify complex visual or behavioral conditions that can't be expressed as simple selectors.

**Maestro equivalent**: `assertWithAI`, `assertNoDefectsWithAi`

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

{PROWL-021} **P5-006: `prowlqa hub` Subcommand**
   Add a `prowlqa hub` CLI subcommand for discovering, previewing, and pulling hunt templates from the prowl-hub repository. Designed for both agents and humans to bootstrap test suites from community templates.

**Acceptance Criteria**:
- `prowlqa hub list` — list available templates with tags and descriptions
- `prowlqa hub list --json` — machine-readable output for agents
- `prowlqa hub pull <template>` — download a template into `.prowlqa/hunts/`
- `prowlqa hub search <query>` — search templates by tag or keyword
- Templates fetched from GitHub (Prowl-qa/prowl-hub)
- Works offline with cached templates

{PROWL-022} **P5-007: `prowlqa hub discover` — URL-Based Hunt Discovery**
   Add a `prowlqa hub discover --url <target>` CLI command that matches hunt templates to a target URL. Enables agents to find relevant community hunts without browsing the hub manually.

**Acceptance Criteria**:
- Hunt templates include optional `targetUrl` pattern metadata
- `prowlqa hub discover --url <target>` returns matching templates
- `prowlqa hub discover --url <target> --json` for agent consumption
- Library equivalent: `discoverHunts(url)` returns matching hunt metadata
- Works with prowl-hub repository as template source

{PROWL-026} **P6-003: `prowl doctor` — Environment Health Check**
   Verify that the user's environment is correctly set up for Prowl.

**Acceptance Criteria**:
- Checks: Node.js version (>=20), Playwright installed, Chromium available, `.prowl/` exists, `config.yml` valid
- Actionable error messages for each failing check
- `prowl doctor --fix` attempts auto-repair (install chromium, create `.prowl/`)
- Color-coded output (green check / red X)

{PROWL-027} **P6-005: Video Recording**
   Record full hunt execution as MP4 video.

**Acceptance Criteria**:
- Config option: `artifacts.video: true` (default: false)
- CLI flag: `prowl run homepage --video`
- Playwright: `context.newPage({ recordVideo: { dir: ... } })`
- Video saved to run directory alongside screenshots
- Useful for sharing failures with non-technical stakeholders

{PROWL-029} **P6-009: Persona-Specific Onboarding Paths**
   `prowlqa init` currently gives everyone the same 8 example hunts. Different users need different starting points. A solo developer testing a side project, a QA team adding regression tests, and an AI agent builder integrating ProwlQA all have different first-run needs.

**Found during**: Gap analysis (2026-02-16)
**Partial progress (2026-02-17)**: `prowlqa init` simplified from 8 example hunts to a single `hello.yml` starter hunt. Example templates moved to the community hub (hub.prowlqa.dev) as verified hunt templates across 6 categories. Init output now points users to the hub. Remaining: preset-based onboarding paths (`--preset solo|team|ci|agent`).
**Acceptance Criteria**:
- `prowlqa init` prompts for use case (or accepts `--preset`): `solo`, `team`, `ci`, `agent`
- Each preset generates tailored example hunts, config, and README hints
- `solo`: minimal config, 2 simple example hunts, quick-start focus
- `team`: full config with common guardrails, example hunts for auth/CRUD/forms
- `ci`: config with `artifacts.junit: true`, GitHub Actions workflow template, CI-ready examples
- `agent`: config with `--json` examples, library API usage guide, `.env` template for secrets
- Existing behavior preserved as default when no preset is selected

{PROWL-033} **P7-003: Retry Diagnostics**
   When a hunt uses `retry` and eventually passes, capture diagnostic information about what failed and why the retry succeeded. Currently retries happen silently — the report only shows the final attempt.

**Found during**: Gap analysis (2026-02-16)
**Acceptance Criteria**:
- `result.json` includes `retryHistory` array with per-attempt results when retries are used
- Each attempt records: status, failed step, error message, duration
- Summary report shows "Passed on attempt 2 of 3" with first-attempt failure reason
- `prowlqa history` shows retry frequency per hunt over time
- Helps distinguish "flaky test" from "slow environment" from "real regression"

{PROWL-034} **P7-004: Failure Clustering**
   Group failures across hunts by common cause. If 5 hunts fail because the same selector changed, surface that as one root cause instead of 5 independent failures. Reduces triage time for large test suites.

**Found during**: Gap analysis (2026-02-16)
**Acceptance Criteria**:
- After `prowlqa ci`, analyze failed hunts for common error patterns
- Group failures by: same error message, same selector, same step type, same URL
- CI summary includes "Failure clusters" section showing grouped failures with count
- `ci-result.json` includes `clusters` array with grouped failure details
- `--json` output includes cluster data for agent consumption

{PROWL-037} **GTM-002: Competitive Positioning Matrix**
   Sharpen the comparison table on prowlqa.dev beyond feature checkmarks. Define what ProwlQA uniquely does better than Playwright Test, Cypress, Maestro, and Selenium — and be honest about where it's weaker. Current comparison table exists but isn't grounded in user feedback or win/loss data.

**Found during**: Gap analysis (2026-02-16)
**Deliverable**: Updated comparison page with:
- "Best for" statement per competitor
- ProwlQA's unique angle (YAML simplicity + agent-native + Playwright power)
- Honest "not for you if..." section
- Testimonial placeholders for when early users provide feedback

## Low Priority

{PROWL-003} **P2-008: `prowl ci --fail-fast` Option**
   Add a `--fail-fast` flag to `prowl ci` that exits on the first hunt failure instead of running all hunts. Useful in CI pipelines where fast feedback is preferred over completeness.

**Found during**: Code review of P2-001 (2026-02-15)
**Acceptance Criteria**:
- `prowl ci --fail-fast` stops after first failed hunt
- Summary still printed for completed + skipped hunts
- `ci-result.json` reflects partial run
- Remaining hunts marked as "skipped" in results

{PROWL-004} **P2-009: `prowl ci --output` and `--json` Flags**
   Add `--output <path>` flag to control where `ci-result.json` is written (for CI artifact upload), and `--json` flag for machine-readable stdout output (matching `prowl list --json` pattern).

**Found during**: Code review of P2-001 (2026-02-15)
**Status**: Partially complete — `--json` done (library-api branch), `--output` deferred
**Acceptance Criteria**:
- ~~`prowl ci --json` emits the `CiResult` JSON to stdout instead of the formatted summary~~ ✓
- ~~Unit tests for `--json`~~ ✓
- `prowl ci --output ./results/` writes `ci-result.json` to specified directory (deferred)
- Both flags can be combined (deferred)

{PROWL-005} **P2-007: Slack/Webhook Notifications**
   Post results to external services on hunt failure.

**Acceptance Criteria**:
- Config option: `reporting.webhook.url` — POST JSON results to webhook on failure
- Config option: `reporting.slack.webhook` — formatted Slack message
- Include: hunt name, status, failure reason, link to artifacts
- Unit tests for webhook payload formatting

{PROWL-009} **BUG-006: `data:` and `about:` Protocols Bypass Domain Allowlist**
   `ensureAllowedUrl()` in `src/runner/steps.ts` allows `about:` and `data:` protocols unconditionally, bypassing the allowed domains check. While `about:blank` is harmless, `data:` URIs could theoretically be used for unintended behavior. Risk is low for a local CLI tool.

**Found during**: Code review (2026-02-10)
**File**: `src/runner/steps.ts` (lines 127-131)
**Fix**: Document as intentional behavior. Optionally restrict `data:` URIs behind a guardrails config flag in a future phase.

---

{PROWL-012} **LEGAL-003: Create NOTICE File for Attribution**
   MIT, BSD, and ISC licenses require preserving copyright notices when redistributing. A NOTICE file in the repo root aggregates these attribution notices in one place, which is standard practice for Apache 2.0 projects.

**Action**: Generate a NOTICE file with copyright attributions for all direct dependencies.

{PROWL-013} **LEGAL-004: Competitive Marketing Guidelines**
   Referencing Maestro and other competitors in documentation and marketing is legal when following FTC comparative advertising guidelines. All comparative claims must be truthful, non-deceptive, and verifiable.

**Guidelines**:
- Use competitor trademarks accurately (correct spelling, capitalization)
- Clearly identify competitors as separate products (no implied endorsement or affiliation)
- Only make factual, verifiable claims in comparison tables
- Use language like "compared to" or "alternative to" rather than disparaging language
- Include disclaimers like "Maestro is a trademark of mobile-dev-inc" where appropriate

{PROWL-018} **P4-007: Geolocation Simulation**
   Simulate geographic location for location-dependent web features.

**Maestro equivalent**: `setLocation`

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

{PROWL-019} **P4-008: `doubleClick` and `rightClick` Step Types**
   Additional click variants for web-specific interactions (text selection, context menus).

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

{PROWL-030} **P6-007: Hunt Dependency Graph**
   Define execution order dependencies between hunts for `prowl ci`.

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

{PROWL-035} **P7-005: Flake Auto-Quarantine**
   Automatically quarantine hunts that exceed the flaky threshold so they don't block CI pipelines. Quarantined hunts still run but their failures don't affect the exit code.

**Found during**: Gap analysis (2026-02-16)
**Acceptance Criteria**:
- Config option: `reliability.quarantine: true` (default: false)
- Hunts exceeding `flakyThreshold` over last N runs are auto-quarantined
- Quarantined hunts run with status reported as `"quarantined"` instead of `"fail"`
- Quarantined hunt failures don't affect `prowlqa ci` exit code
- CI summary clearly marks quarantined hunts
- `prowlqa flaky --quarantined` lists currently quarantined hunts
- Manual override: `quarantine: false` in hunt YAML to opt out

---

{PROWL-038} **GTM-003: Use-Case Landing Pages**
   Create targeted landing pages for each ICP segment rather than one generic homepage. A QA engineer searching "Playwright alternative" and an AI developer searching "programmatic browser testing" should land on different pages with different messaging.

**Found during**: Gap analysis (2026-02-16)
**Deliverable**: 2-3 landing page variants on prowlqa.dev:
- `/for/qa-teams` — regression testing, CI integration, reporting focus
- `/for/developers` — quick setup, YAML simplicity, local-first focus
- `/for/ai-agents` — JSON output, library API, programmatic integration focus

## Completed

### BUG-008: Download Listener Timing and RANDOM_* Hunt Var Resolution (completed: 2026-04-21)
**Priority**: Medium
**Found during**: Code review (2026-04-21)
**Description**: `waitForDownload` only attached its listener when that step executed, which could miss immediate downloads triggered by the prior step. Separately, `hunt.vars` resolved before built-in `RANDOM_*` variables were merged, so patterns like `EMAIL: "{{RANDOM_EMAIL}}"` failed even though the runtime supported random interpolation elsewhere.
**Resolution**: The runner now pre-arms the download listener when the next step is `waitForDownload`, validates suggested filenames before saving, and interpolation now resolves `hunt.vars` against the combined built-in random/environment variable set. Unit coverage was added for both behaviors.

---

### BUG-007: CLI Version String Duplicates `package.json` (completed: 2026-03-18)
**Priority**: Low
**Found during**: Code review (2026-03-18)
**Description**: `src/cli/index.ts` hardcoded the CLI version string instead of sourcing it from the package metadata, creating version drift risk whenever `package.json` changed without a matching manual edit in the CLI entrypoint.
**Resolution**: CLI program setup now sources the version from `package.json` via a central `CLI_VERSION` export, with unit coverage asserting the CLI-reported version matches package metadata.

---
