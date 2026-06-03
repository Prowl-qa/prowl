# Prowl - Product Backlog

## High Priority

{PROWL-010} **LEGAL-001: Trademark Clearance for "Prowl" Brand**
   The word "Prowl" has existing trademark registrations in adjacent software classes. While the goods/services are substantially different from QA testing, professional clearance is recommended before investing heavily in the brand.

**Existing registrations found**:
- **Oris Intel, LLC** — "PROWL" in Class 42 (SaaS software) for price monitoring, reseller identification, and policy enforcement tools (Reg. 4880040, registered 2016-01-05). Closest concern — same trademark class, but very different goods.
- **Camgian Microsystems Corp.** — "PROWL" in Class 9 for radar/tracking software (Reg. 4471189). Different goods and market.
- **Prowl iOS app** (prowlapp.com) — Push notification client operating since 2009. Common-law trademark rights in developer-adjacent space.
- **"prowl"** — No existing conflicts found.
- **"Prowl"** — No existing conflicts found. "QA" adds differentiation.

**Action items**:
- Consult a trademark attorney for a clearance opinion
- Consider filing a trademark application in Classes 9 and 42 specifically for QA testing tools
- Using "Prowl" or "prowl" as the primary brand provides stronger differentiation

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

## Medium Priority

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

{PROWL-021} **P5-006: `prowl hub` Subcommand**
   Add a `prowl hub` CLI subcommand for discovering, previewing, and pulling hunt templates from the prowl-hub repository. Designed for both agents and humans to bootstrap test suites from community templates.

**Acceptance Criteria**:
- `prowl hub list` — list available templates with tags and descriptions
- `prowl hub list --json` — machine-readable output for agents
- `prowl hub pull <template>` — download a template into `.prowl/hunts/`
- `prowl hub search <query>` — search templates by tag or keyword
- Templates fetched from GitHub (prowl-tools/prowl-hub)
- Works offline with cached templates

{PROWL-022} **P5-007: `prowl hub discover` — URL-Based Hunt Discovery**
   Add a `prowl hub discover --url <target>` CLI command that matches hunt templates to a target URL. Enables agents to find relevant community hunts without browsing the hub manually.

**Acceptance Criteria**:
- Hunt templates include optional `targetUrl` pattern metadata
- `prowl hub discover --url <target>` returns matching templates
- `prowl hub discover --url <target> --json` for agent consumption
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
- Playwright: `browser.newContext({ recordVideo: { dir: ... } })`, then `context.newPage()` for pages; `recordVideo` is a browser context option, not a page option
- Video saved to run directory alongside screenshots
- Useful for sharing failures with non-technical stakeholders

{PROWL-029} **P6-009: Persona-Specific Onboarding Paths**
   `prowl init` currently gives everyone the same 8 example hunts. Different users need different starting points. A solo developer testing a side project, a QA team adding regression tests, and an AI agent builder integrating Prowl all have different first-run needs.

**Found during**: Gap analysis (2026-02-16)
**Partial progress (2026-02-17)**: `prowl init` simplified from 8 example hunts to a single `hello.yml` starter hunt. Example templates moved to the community hub (hub.prowl.tools) as verified hunt templates across 6 categories. Init output now points users to the hub. Remaining: preset-based onboarding paths (`--preset solo|team|ci|agent`).
**Acceptance Criteria**:
- `prowl init` prompts for use case (or accepts `--preset`): `solo`, `team`, `ci`, `agent`
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
- `prowl history` shows retry frequency per hunt over time
- Helps distinguish "flaky test" from "slow environment" from "real regression"

{PROWL-037} **GTM-002: Competitive Positioning Matrix**
   Sharpen the comparison table on prowl.tools beyond feature checkmarks. Define what Prowl uniquely does better than Playwright Test, Cypress, Maestro, and Selenium — and be honest about where it's weaker. Current comparison table exists but isn't grounded in user feedback or win/loss data.

**Found during**: Gap analysis (2026-02-16)
**Deliverable**: Updated comparison page with:
- "Best for" statement per competitor
- Prowl's unique angle (YAML simplicity + agent-native + Playwright power)
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

---

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
- Quarantined hunt failures don't affect `prowl ci` exit code
- CI summary clearly marks quarantined hunts
- `prowl flaky --quarantined` lists currently quarantined hunts
- Manual override: `quarantine: false` in hunt YAML to opt out

---

{PROWL-038} **GTM-003: Use-Case Landing Pages**
   Create targeted landing pages for each ICP segment rather than one generic homepage. A QA engineer searching "Playwright alternative" and an AI developer searching "programmatic browser testing" should land on different pages with different messaging.

**Found during**: Gap analysis (2026-02-16)
**Deliverable**: 2-3 landing page variants on prowl.tools:
- `/for/qa-teams` — regression testing, CI integration, reporting focus
- `/for/developers` — quick setup, YAML simplicity, local-first focus
- `/for/ai-agents` — JSON output, library API, programmatic integration focus

## CI/CD & OpenShift (Epic)

Make Prowl usable as an automated go/no-go acceptance gate in CI/CD pipelines and OpenShift Pipelines (Tekton), in addition to its original manual/exploratory use. The CLI already has the runtime primitives (`prowl ci` with exit codes 0/1/2, `--json`, `--junit`, `--url`, `--parallel`); the missing piece is packaging/distribution, not core behavior. Positioning: an **agent-friendly acceptance/smoke layer** ("plain-English end-to-end checks that protect deploys"), **not** a replacement for unit/integration suites. Build order: **CICD-001 first** (shared dependency), then 002/003/004 in parallel as desired; **CICD-005 (Operator/enterprise) is intentionally last and large — do not start it before 001–004 ship.** Everything here is additive/opt-in; users not doing CI/CD are unaffected.

{PROWL-042} **CICD-001: Publish a `prowl` container image**
   *As a platform/devops user, I want a ready-to-run Prowl container so I can run hunts in CI without installing Node, the CLI, and Playwright browsers myself.*
   Foundation for the rest of the epic — both generic CI and OpenShift need a prebuilt image bundling Node + Prowl + Chromium + Playwright system libs.

**Found during**: CI/CD + OpenShift feasibility review (2026-05-30, Red Hat SA conversation)
**Acceptance Criteria**:
- Dockerfile: Node 20 base, Prowl installed (global or built `dist`), Chromium + Playwright system dependencies, pinned Playwright/Chromium versions
- `docker run --rm <image> prowl ci --url <target> --json` runs a suite end-to-end and exits with the correct code (0/1/2)
- **Non-root UID run check**: image runs and Chromium launches when started as an arbitrary non-root user (de-risks OpenShift's restricted SCC early)
- Published to a registry (GHCR and/or Docker Hub) with documented tags
- Shared dependency for CICD-003, CICD-004, CICD-005

{PROWL-043} **CICD-002: Generic CI/CD usage docs + sample pipelines**
   *As a developer, I want copy-paste CI examples so I can wire `prowl ci` in as a deploy gate without figuring out the plumbing.*
   Documentation + samples only; no runtime change.

**Found during**: CI/CD + OpenShift feasibility review (2026-05-30)
**Acceptance Criteria**:
- README + prowl-docs section: run `prowl ci` as a deploy go/no-go gate, framed as an acceptance/smoke layer (not a replacement for unit/integration tests)
- Ready-to-copy GitHub Actions and GitLab CI examples using the CICD-001 image
- Document how exit codes (0 pass / 1 fail / 2 no-hunts|all-skipped) gate the build
- Document publishing `junit.xml` and `.prowl/runs/` artifacts from the pipeline
- Document injecting `--url` (staging/preview targets) and secrets via `{{VAR}}` interpolation
- Depends on CICD-001

{PROWL-044} **CICD-003: Tekton Task + OpenShift Pipelines example**
   *As an OpenShift user, I want a Tekton Task that runs Prowl so I can gate promotion on real browser acceptance checks.*

**Found during**: CI/CD + OpenShift feasibility review (2026-05-30)
**Acceptance Criteria**:
- A Tekton `Task` (plus a sample `Pipeline`) that runs the CICD-001 image
- Params for target URL and config path
- Runs `prowl ci`; exits non-zero on failure to gate promotion
- Stores artifacts (`.prowl/runs/`, junit.xml) to a workspace/PVC
- Docs: "Run Prowl in OpenShift Pipelines"
- Depends on CICD-001

{PROWL-045} **CICD-004: OpenShift compatibility hardening + docs**
   *As an enterprise OpenShift user, I want Prowl to run under the restricted SCC so it works in a locked-down cluster.*
   The item that makes the enterprise claim real. **Confirmed gap:** `launchBrowser` (`src/browser/controller.ts:30-34`) calls `engine.launch({ headless, slowMo, channel })` with no `args`, so there is no `--no-sandbox` hook — Chromium under OpenShift's restricted SCC will likely need one. This is the only place in the epic that touches `src/`.

**Found during**: CI/CD + OpenShift feasibility review (2026-05-30)
**Acceptance Criteria**:
- Image runs rootless / SCC `restricted-v2` compatible
- Add a config/guardrail-gated browser launch-args option (e.g. opt-in `--no-sandbox`) — **opt-in only, never a default**, since it's a security trade-off; local `prowl run`/`ci` behavior unchanged
- Document secrets / `auth-state.json` injection for pipeline use
- Document artifact persistence (workspace/PVC)
- Schema validation + unit tests for the new launch-args option
- Depends on CICD-001

{PROWL-046} **CICD-005: Enterprise productization (LARGE — do last)**
   *As a Red Hat / enterprise customer, I want a certified, governed Prowl distribution integrated with the OpenShift Console.*
   Captured per full-scope decision, but **do not start before CICD-001–004 ship** — building an Operator first is overkill (per the Red Hat SA's own advice). Will likely split into sub-items when picked up.

**Found during**: CI/CD + OpenShift feasibility review (2026-05-30)
**Acceptance Criteria** (high-level; to be decomposed later):
- Operator or certified/operator-style distribution
- OpenShift Console integration
- Dashboards for run results/trends
- Multi-project governance + RBAC/policy templates
- Hosted report ingestion
- Explicitly blocked on CICD-001 through CICD-004

## Completed

Completed and resolved work lives in [`resolved.md`](./resolved.md).
