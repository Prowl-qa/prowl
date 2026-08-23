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
**Practitioner pain points to ground it in** (Reddit thread research, 2026-08-16 — real language
from Appium/Espresso/Maestro users; use these verbatim-ish, they beat feature checkmarks):
- *"Flakiness drives me up the wall … debugging timing crap or CI fails that work fine locally"*
  (Appium) → Prowl's answers: Playwright auto-waiting, deterministic scripted steps, flake
  scoring/quarantine ({PROWL-035}), pinned container image ({PROWL-042}) for CI/local parity.
  Be honest: the macOS target is black-box AX (no in-process idle signal à la Espresso).
- *"Reliable and quick, but Android-only, and the boilerplate is a slog"* (Espresso) → hunts are
  ~a dozen lines, no instrumentation build; platform coverage is web + experimental macOS.
- *"YAML starts feeling like a cage when I need more control"* (Maestro) → Prowl's escape
  hatches: `runHunt` composition, `if`/`repeat`, runtime vars, `evalScript`/`runScript`, and the
  **library API** for graduating gnarly flows to TS (docs path tracked in prowl-docs PQD-005).
- *"No IDs or anything useful"* → stable-selector philosophy + `prowl analyze` selector ranking
  (macOS analog tracked as {PROWL-055}).
- The poster's wish list (MCP-native, AI-assisted, local/BYOK, no lock-in) is Prowl's mission
  statement — lead with it.
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

## macOS Target — Phase 2 (Epic)

Follow-ups to the experimental macOS native target ({PROWL-048}, shipped 2026-08-15 on `main`,
unreleased). Priorities should be re-ordered by dogfood feedback from the first real consumer
(Sentwise menu bar app, `prowl-hunts` branch in that repo). Phase 1 scope notes live in
`resolved.md` under PROWL-048.

{PROWL-050} **ARCH-004: Hunt-level assertions on the macOS path**
   The macOS run path passes `assertions: []` — config/hunt `assertions:` blocks are silently
skipped. Evaluate the applicable subset (e.g. `selectorExists`; console/network assertions stay
web-only) and reject or warn on inapplicable ones instead of ignoring them.

**Found during**: PROWL-048 phase-1 scope notes (2026-08-15)
**Acceptance Criteria**:
- Applicable hunt-level assertions run after macOS steps complete
- Web-only assertion types produce a validation error or explicit "skipped (web-only)" result, never silence
- Tests for both paths

{PROWL-051} **ARCH-005: Arbitrary key support for `press` on macOS**
   The helper maps Enter/Return/Space onto `AXPress` and rejects everything else. Synthesize
real keystrokes (CGEvent posting to the target app) so `press` supports the same key names as
the web target (Escape, Tab, arrows, modifiers).

**Found during**: PROWL-048 phase-1 scope notes (2026-08-15)
**Acceptance Criteria**:
- `press` accepts the common key vocabulary; unknown keys still error clearly
- Keystrokes go to the target app (activate first), not whatever is frontmost
- Docs/compatibility matrix updated

{PROWL-052} **ARCH-006: Distribute the `prowl-macdriver` helper**
   The macOS target currently requires a source checkout and local `swift build`. Ship the
helper so npm users can use the target: prebuilt universal binary attached to GitHub Releases
with an install/download command (`prowl doctor --fix`-style), and/or a Homebrew formula in
`prowl-tools/homebrew-tap`. Keep the npm tarball JS-only.

**Found during**: PROWL-048 phase-1 scope notes (2026-08-15)
**Acceptance Criteria**:
- A supported install path that doesn't require Xcode on the user's machine
- Signed/notarized binary (or documented Gatekeeper workaround) — coordinate with the Sentwise release-automation learnings
- `resolveHelperBinary` search order documented and extended (user-level install location)
- CI recipe for macOS runners updated

{PROWL-056} **ARCH-008: Event-driven AX waits via AXObserver (BiDi lesson applied to macdriver)**
   The Swift helper is a classic command/poll design: `waitFor` loops on 100ms sleeps, menu-open
detection polls children. The WebDriver BiDi insight — UIs are event-driven, and protocols that
poll them breed timing races — applies verbatim: macOS's `AXObserver` API pushes notifications
(`AXWindowCreated`, `AXUIElementDestroyed`, focus/value changes) that the helper could subscribe
to instead. Waits resolve the instant the state changes, with less CPU and structurally fewer
race windows of the BUG-MAC-001 kind. Lower priority than {PROWL-049}/{PROWL-052}: today's
polling is correct, just less elegant.

**Found during**: WebDriver BiDi spec review (2026-08-16)
**Acceptance Criteria**:
- Helper registers `AXObserver` notifications for the attached app and resolves `waitFor` (and
  menu-open detection in `openMenu`/`clickMenu`) from notifications, with the existing polling
  retained as fallback for elements/notifications AX doesn't announce
- Stdio protocol gains server-initiated event messages (distinct from id-matched responses);
  `SpawnMacHelperClient` routes them without confusing the pending-request map
- No behavior change to hunt semantics — same steps, same results, lower latency
- Timeout behavior preserved exactly (a wait that never resolves still errors at its deadline)


## Mobile Target (Epic)

Add Android and iOS as first-class Prowl targets, extending the `SessionDriver` abstraction the
same way the macOS target did. Motivation (competitive research, 2026-08-18): Maestro owns the
"simple YAML mobile testing" mindshare; BrowserStack's App Automate runs Maestro suites as a
first-class framework, which means mobile YAML runners are now cloud-portable — Prowl without a
mobile target concedes that whole segment. Architecture decision from the research spike:
**"Maestro-shaped, Appium-parts"** — no Appium server, no JVM, no gRPC. Each platform gets a
thin driver that shells out for device lifecycle and speaks plain HTTP/JSON (raw `fetch`, per
the `ai.ts` no-heavy-SDKs ethos) to a battle-tested, Apache-2.0, standalone on-device agent
maintained by the Appium project. This mirrors the macdriver pattern exactly (external helper +
JSON protocol) and beats Maestro's own implementation on two known weaknesses: no JVM
dependency, and dynamically allocated ports so parallel sessions/CI jobs work from day one.
Build order: **PROWL-058 (Android) first** — Linux CI story is cheapest and real devices come
free via adb — then PROWL-059 (iOS simulator), then PROWL-060/061. **PROWL-062 (real iOS
devices) is intentionally deferred** — code signing, Developer Mode, and iOS 17+ tunnels are the
swamp that has kept even Maestro from shipping it; revisit with `go-ios` as the enabler.

{PROWL-060} **ARCH-011: Unified native selector engine (snapshot-then-match)**
   Both mobile agents return full hierarchy snapshots (`/source`). Match selectors host-side in
one shared TS engine so `id=`/`label=`/`text=`/`role=` mean the same thing on Android, iOS, and
(eventually) macOS — one place for dialect docs, one place for the `label=`-in-assertions trap.

**Found during**: BrowserStack/mobile competitive research (2026-08-18)
**Acceptance Criteria**:
- Shared matcher module consumed by both mobile drivers; per-platform attribute mapping tables
- Selector semantics documented in one compatibility matrix (web / macOS / Android / iOS)
- Evaluate migrating macdriver matching onto it later; no behavior change required now

{PROWL-069} **ARCH-013: iOS driver — WDA fails to launch on iOS 26+ simulators (`simctl launch` termination)**
   The iOS driver starts WebDriverAgent by `simctl install`-ing the runner app and `simctl launch`-ing
its `com.facebook.WebDriverAgentRunner.xctrunner` bundle (the "preinstalled WDA" approach,
device-verified in PROWL-059 against **iOS 18.6**). On **iOS 26.x simulators this no longer works**:
the runtime immediately terminates the directly-launched xctrunner (sim log: *"Executable for
com.facebook.WebDriverAgentRunner.xctrunner … had no entitlements"* → RunningBoard termination), so
WDA gets a PID but its HTTP server never binds and readiness times out at 60s. Found 2026-08-22 while
live-verifying `prowl analyze` for {PROWL-061} on the self-hosted mini (Xcode 26.6 / iOS 26.5 — the
only runtime `xcodebuild -downloadPlatform iOS` offers). **Impact:** iOS run/analyze and the iOS half
of the mobile CI gate ({PROWL-061}) fail on iOS 26+; Android is unaffected and fully verified.

**Found during**: PROWL-061 live device-verification (2026-08-22)
**Acceptance Criteria**:
- iOS driver launches WDA in a way iOS 26+ accepts — most likely `xcodebuild test-without-building`
  with the generated `.xctestrun` (the standard XCTest host launch) rather than `simctl launch` of the
  runner `.app`; keep the prebuilt-runner fast path where a runtime still allows it, or make xctestrun
  the default.
- Re-verified live on an iOS 26.x simulator (a real hunt + `prowl analyze` against `com.apple.Preferences`).
- The {PROWL-061} `mobile-e2e.yml` iOS job goes green on the self-hosted runner.
- Alternative/interim: document installing a WDA-compatible older iOS runtime on the runner if the
  xctestrun path proves large; but the driver fix is the real resolution (users will hit iOS 26+).

{PROWL-062} **ARCH-012: Real iOS device support (DEFERRED — do not start)**
   Code signing of the WDA runner, Developer Mode enrollment, and iOS 17+ CoreDevice tunnels
make this a separate epic. `go-ios` (MIT) is the most credible enabler (installs/runs WDA and
manages tunnels without Xcode, even from Linux). Parked until PROWL-058/059 ship and a real
user asks; note Android real devices already work via {PROWL-058}.

**Found during**: BrowserStack/mobile competitive research (2026-08-18)

## Commercialization — Prowl Cloud (Epic)

Turn Prowl into a sellable product without abandoning the mission. Model decision (owner,
2026-08-18, grounded in Maestro/Cypress/Sentry/Momentic monetization research): **open-core**.
The CLI stays Apache-2.0 and free forever for local/self-hosted CI use; revenue comes from
**convenience layers**, in this order: (1) **managed AI metered by credits** — AI features work
with a Prowl account and no API key, routed through our provider keys with margin (the Momentic
pattern); (2) **hosted results/team dashboards** — execution stays on the user's machines, we
host history/trends/sharing (the Cypress Cloud pattern). **Standing guarantees, not up for
re-litigation per item:** BYOK remains a supported free path forever (we invert Maestro's
BYOK-removal, which now forces an account even for local AI); no existing local feature is ever
paywalled retroactively; **no hosted device-execution farm** (explicit non-goal — capital-heavy,
commoditized under open runners; partner/integrate instead if demanded). Design the paid layer
so the value is the *service* (AI quality, dashboards, support), not a gateable API — Cypress's
dashboard-blocking backlash and Maestro's discount resellers (DeviceCloud, Moropo) are the
cautionary tales. Server-side components will live in a new repo (working name `prowl-cloud`);
this epic tracks the CLI-side work and the overall sequencing. Build order: **BIZ-001 →
BIZ-002 → BIZ-003**, with BIZ-004 as the second act and BIZ-005 alongside first paid launch.

{PROWL-063} **BIZ-001: Prowl account + CLI auth (`prowl login`)**
   *As a user, I want to sign in from the CLI so AI features can work without me managing an API
key.*
   Foundation for everything paid: account service, `prowl login` / `prowl logout` /
`PROWL_API_KEY` env for CI, token storage outside the repo, `prowl whoami`. Anonymous use of
everything that works today must remain untouched — auth is only consulted by features that
need the cloud.

**Found during**: Commercialization decision (2026-08-18)
**Acceptance Criteria**:
- `prowl login` (browser/device-code flow) and `PROWL_API_KEY` for headless CI
- Credentials stored user-level (never in `.prowl/` or the repo); redacted from all artifacts
- No existing command's behavior changes when logged out
- Server counterpart tracked in the `prowl-cloud` repo once created

{PROWL-064} **BIZ-002: Managed AI proxy with credit metering**
   *As a user, I want AI-powered features to just work on my Prowl account, and as the owner, I
want each AI call metered in credits with margin.*
   A thin hosted endpoint in front of the existing raw-`fetch` provider abstraction
(`src/generator/ai.ts`): CLI sends the same provider-shaped requests to our proxy when no BYOK
key is configured; proxy authenticates the account, routes to a provider with our keys, meters
credits, bills via Stripe. Free monthly credit allowance for the funnel; BYOK bypasses the
proxy entirely (user pays their provider directly, we never see the traffic).

**Found during**: Commercialization decision (2026-08-18)
**Acceptance Criteria**:
- Resolution order documented and tested: explicit BYOK key → managed proxy (logged in) →
  actionable error naming both options
- Credit metering + Stripe billing on the server side; CLI surfaces remaining credits and a
  clear out-of-credits error (never a silent failure or a hung hunt)
- No request/response content retained server-side beyond what billing requires — privacy
  posture documented (this is the trust story; it must be true)
- Depends on {PROWL-063}

{PROWL-065} **BIZ-003: Dual-path AI feature set (first consumers)**
   Ship the AI features that make BIZ-002 worth paying for, each working identically via BYOK or
managed credits: `assertWithAI` ({PROWL-020}) as the first consumer, then AI hunt generation
(natural language → hunt YAML, leaning on `prowl analyze` output for grounded selectors) and
AI selector-repair suggestions on failure (suggest-only in reports — never silent self-healing;
determinism is the product).

**Found during**: Commercialization decision (2026-08-18)
**Acceptance Criteria**:
- {PROWL-020} implemented with the BIZ-002 resolution order
- `prowl generate` (or similar): prompt + analyze snapshot → draft hunt YAML for human review
- Failed-selector suggestions appear in the run report as proposals, never auto-applied
- Every feature degrades gracefully with neither key nor account (skip/warn, never break runs)
- Depends on {PROWL-064}

{PROWL-066} **BIZ-004: Hosted results console (`prowl push`)**
   *As a team, we want shared run history, flake trends, and failure artifacts without standing
up our own storage.*
   Opt-in upload of the existing file-based artifacts (`result.json`, junit, screenshots,
traces) to a hosted console: history per hunt, flake scoring over time, shareable failure
links, PR annotations. Execution never moves to the cloud — this monetizes visibility, not
infra. Supersedes/absorbs the "hosted report ingestion" line inside {PROWL-046} for
non-enterprise users.

**Found during**: Commercialization decision (2026-08-18)
**Acceptance Criteria**:
- `prowl push` (and `prowl ci --push`) uploads a run's artifacts under the account's project
- Console: run list, per-hunt history/trends, artifact viewing, shareable links
- Team seats/roles at minimum viable level; data export + delete (self-sovereignty guarantee —
  leaving must be easy and complete)
- Depends on {PROWL-063}; independent of BIZ-002/003

{PROWL-067} **BIZ-005: Pricing, packaging & site launch**
   Decide and publish the tiers (working hypothesis: Free = full CLI + BYOK + free credit
allowance; Pro = credit bundle + hosted console; Team/Enterprise later), update `prowl.tools`
with honest pricing and the "never locked in" guarantee stated as policy, and update docs.
Coordinate with {PROWL-037} (positioning matrix) so the anti-metered-lock-in message and the
paid tiers don't contradict each other — the line is: we charge for convenience, never for
your data or your exit.

**Found during**: Commercialization decision (2026-08-18)
**Acceptance Criteria**:
- Pricing page live with real numbers; free tier limits stated plainly (no surprise-renewal
  dark patterns — the BrowserStack Trustpilot file is the anti-pattern)
- Docs cover BYOK vs managed paths side by side
- CHANGELOG/README updated when the first paid feature ships

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

{PROWL-068} **CICD-007: Prowl GitHub App — branded check runs on PRs**
   *As a repo owner running Prowl in CI, I want the Prowl check on my PRs to carry the Prowl
name and logo (like CodeRabbit/Codecov) instead of the generic GitHub Actions octocat.*
   The avatar on a PR check row belongs to the GitHub App that created the check, so this
requires a first-party **"Prowl" GitHub App** (owned by the `prowltools` account, Prowl logo as
avatar, `checks: write` permission) publishing a check run via the Checks API. The Actions
workflow mints an app token (`actions/create-github-app-token`) and posts a check named
"Prowl" whose summary is rendered from `ci-result.json` (pass/fail counts, failed hunts,
artifact pointers); consumers mark *that* check as required. Beyond cosmetics this is a
distribution surface — per-hunt PR annotations now, links into the hosted results console
({PROWL-066}) later.

**Found during**: Sentwise CI dogfooding (2026-08-18 — PR checks showed octocat + stale
"Prowl QA" naming)
**Acceptance Criteria**:
- App creation is a documented manual step for the repo owner (name "Prowl", logo upload,
  `checks: write`, install on target repos); no app credentials ever committed
- A rendering path from `ci-result.json` to check-run `output` (title/summary/failed-hunt
  detail) — either a documented `gh api` recipe or a small `prowl` helper subcommand; failed
  hunts listed with their failure step, capped sensibly
- Check conclusion mirrors `prowl ci` exit semantics (0 → success, 1 → failure, 2 → neutral)
- Copy-paste workflow snippet in docs (prowl-docs CI section, cross-repo duty)
- First consumer: Sentwise's `prowl-qa.yml` adopts it, the branded check becomes the required
  one, and the workflow/job is renamed from the retired "Prowl QA" branding to "Prowl"
- Optional stretch: per-hunt check-run annotations on the changed files

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
