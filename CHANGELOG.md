# Changelog

All notable changes to Prowl will be documented in this file.

## [Unreleased]

### Changed
- **Window-scoped screenshots on the macOS target (ARCH-003 / PROWL-049).** The
  macOS helper's `screenshot` verb now captures the attached app's **frontmost
  window** instead of the whole screen. It enumerates on-screen windows in
  z-order (`CGWindowListCopyWindowInfo`), keeps those owned by the app's pid at
  window layer 0, and captures the frontmost via `screencapture -x -l <windowID>`,
  so `assertScreenshot` baselines are window-sized and stable across desktops and
  machines with the same window content — no more menu bar clock, wallpaper, or
  unrelated windows folded into the baseline making diffs flaky by construction.
  When the app exposes no capturable window (menu-only apps, an open status-item
  menu, everything minimized) it falls back to a full-screen capture and surfaces
  a `warning` in the response (which `MacDriver.screenshot` logs via
  `console.warn`) rather than failing the hunt. Screenshots remain gated on Screen
  Recording permission. **Baseline invalidation:** existing full-screen baselines
  captured by earlier macOS runs will no longer match the new window-scoped
  captures — delete and re-create them (`prowl update-baselines` or remove the
  stored baseline) after upgrading.

## [0.1.4] - 2026-08-16

### Fixed
- **macOS target launch/quit race (BUG-MAC-001 / PROWL-054).** Back-to-back
  `prowl run` invocations against a macOS app could attach to the *previous*
  instance while it was still terminating — `terminate()` only requests shutdown
  and returns immediately, and the next launch's unfiltered
  `runningApplications(...).first` picked up the dying PID's still-readable AX
  tree, clicked a zombie menu, then hung waiting for a window no living process
  had been asked to open. The Swift helper's lifecycle is now deterministic:
  `quit()` first cancels any open status-item menu (whose NSMenu tracking runloop
  delayed clean termination), then requests terminate, polls `isTerminated` to a
  deadline, escalates to `forceTerminate()` if needed, and only returns once the
  process is actually gone — reporting the outcome (`terminated` / `forced` /
  `alreadyGone` / `timedOut`) in the quit response. `launch()` now skips
  terminating instances, waits (bounded by the launch timeout) for a still-dying
  instance to disappear before launching fresh, and verifies the PID is still
  alive before returning success. Back-to-back runs are now reliable with no
  sleeps between them (PROWL-054).

### Added
- **Experimental macOS native target (ARCH-002 / PROWL-048).** Prowl can now drive
  native macOS apps — including menu bar extras (`NSStatusItem` + `NSMenu`) — through
  Apple's Accessibility API, alongside the web target. The `target` config gains a
  discriminant: `type: "web"` (default — existing configs are unchanged) or
  `type: "macos"` with `app` (a bundle id or `.app` path). A new `MacDriver`
  implements the engine-neutral `SessionDriver` over a long-lived JSON-over-stdio
  Swift helper (`prowl-macdriver`), with a native selector dialect (`id=…`,
  `role=…[name="…"]`, `label=…`, bare text, plus `statusItem` / `menu=…` for the menu
  bar). Portable steps (`click`, `fill`, `type`, `press`, `wait`, `assert visible`,
  `screenshot`, `assertScreenshot`, `repeat`, `runHunt`, `if`, `copyText`, `hover`,
  `scrollTo`, `waitForSelector`) work on both targets; web-only steps are rejected up
  front on the macOS target. A native guardrail (`guardrails.allowedApps`) is the
  scope analog of `allowedDomains`. Sub-hunt steps are validated against the target
  too (web-only steps in a sub-hunt fail fast on the macOS target instead of running).
  The helper transport enforces a per-request deadline so a wedged helper can't hang a
  run. **Experimental and not distributed:** the helper
  binary is not bundled in the npm package — build it locally with `swift build` in
  `macdriver/`. Prowl gives a clear "build the helper" error if it is missing. See the
  README "macOS Target (Experimental)" section for the selector dialect, step
  compatibility matrix, and Accessibility-permission setup (incl. CI notes). Library
  exports: `createMacDriver`, `parseMacSelector`, `launchMacSession`,
  `closeMacSession`, `resolveHelperBinary`, `assertStepsSupportedByTarget`, and the
  `Target` / `WebTarget` / `MacosTarget` types (PROWL-048)

### Internal
- Driver abstraction extracted from the Playwright runner (ARCH-001 / PROWL-047).
  A new engine-neutral `SessionDriver` interface (`src/browser/driver.ts`) now
  sits between the step runner and Playwright, with `createPlaywrightDriver`
  (`src/browser/playwright-driver.ts`) as its sole implementation and the only
  runtime importer of Playwright. `executeSteps` is now a per-step handler
  registry whose handlers declare the driver capabilities they need, and the
  guardrails (`allowedDomains`, `forbiddenSelectors`, `maxSteps`, self-healing)
  are lifted into a policy layer (`src/runner/policy.ts`) that wraps the driver;
  the forbidden-selector check uses a driver-supplied selector parser. The
  `login`, `analyze`, and `generate` commands launch through the controller/
  driver instead of Playwright directly. This is a pure refactor — no hunt YAML,
  config, or behavior changes, and all existing tests pass unchanged. It is the
  prerequisite for non-browser execution targets (macOS native, Electron,
  mobile — PROWL-048). Residual coupling: `src/runner/steps.ts` keeps a
  type-only `import type { Page }` for the context's `page` field (the entrypoint
  the runner hands in); it carries no runtime Playwright dependency.

## [0.1.3] - 2026-06-03

### Changed
- **Rebrand to Prowl.** The project is now **Prowl**, one tool in the Prowl suite under Genkei Labs.
  - npm package renamed `prowlqa` → **`prowl-tools`** (the bare `prowl` name was already taken on npm); the CLI command/binary is now **`prowl`** (e.g. `prowl run`, `prowl ci`). Install with `npm install -g prowl-tools`.
  - Project config directory moved from `.prowlqa/` to **`.prowl/`**. The legacy `.prowlqa/` is still read for now, with a one-time deprecation warning — rename it to `.prowl/`; support for `.prowlqa/` will be removed in a future release.
  - MCP project registry now uses the `PROWL_PROJECTS` env var (legacy `PROWLQA_PROJECTS` still honored) and defaults to `~/.prowl/projects.yml` (legacy `~/.prowlqa/projects.yml` still read).
  - Homepage is now https://prowl.tools, docs https://docs.prowl.tools, and the repo + Homebrew tap moved to the `prowl-tools` org (`brew tap prowl-tools/tap`).

### Added
- Failure clustering (P7-004): `prowl ci` now groups failed hunts that share a common cause — the same step type, selector, and normalized error — so one root cause (e.g. a renamed selector breaking several hunts) surfaces as a single cluster instead of N independent failures. Multi-hunt clusters appear in a "Failure clusters" section of the CI summary and as a `clusters` array in `ci-result.json` (and `prowl ci --json`), each with the cause, affected hunts, and count. Library exports: `clusterFailures`, `FailureCluster` (PROWL-034)
- Self-healing selectors (P5-005): opt-in via `guardrails.selfHealing: true` (default `false`). When an explicit selector on an action step (`click`/`fill`/`selectOption`/`setInputFiles`/`press`/`hover`/`scrollTo`) matches nothing, Prowl derives the intent from the selector and tries alternative strategies — fuzzy text, ARIA label, then a structural interactive-element match — healing only to a candidate that resolves to exactly one element (never guesses among multiple). Heals are logged as a warning and surfaced in `result.json`/`summary.md` (per-step `healedFrom` + a "Self-Healed Selectors" section) so you can update your hunt. `waitForSelector` is intentionally excluded. Library exports: `healSelector`, `buildHealCandidates`, `extractSelectorIntent` (PROWL-023)
- Flake detection & scoring (P7-002): new `prowl flaky` command ranks hunts by flake score — the share of consecutive runs where pass/fail status flipped, computed from `.prowl/history.json`. Supports `--json`, `--limit <n>` (score only the most recent N runs), and `--threshold <0-1>`. Configurable via `reliability.flakyThreshold` in `config.yml` (default `0.3`). `prowl ci` now flags flaky hunts that ran in the suite, both in the CI summary and as a `flaky` array in `ci-result.json`. Library exports: `computeFlakeScore`, `rankFlaky`, `FlakyScore` (PROWL-032)
- Trace-ID correlation (OBS-001): when a hunt hits a failing request
  (status >= 400), Prowl reads the response's `traceparent` header,
  extracts the W3C trace id, and surfaces it in:
  - `result.json` under `traceCorrelations`
  - `summary.md` under a "Trace Correlations" section

  This lets you pivot from a hunt failure to the matching distributed trace in
  your own APM (Datadog, Grafana/Tempo, Jaeger, etc.). The header is
  configurable via `tracing.header` in `config.yml` (default `traceparent`); no
  output when the app emits no trace headers. Prowl does not generate or
  propagate its own spans (PROWL-047)

## [0.1.2] - 2026-05-29

### Added
- Configurable bug-log destination via `config.yml`: a `bugLog` block controls automated bug-logging — `bugLog.enabled` (default `true`), `bugLog.backlogPath` (default `docs/backlog.md`), and `bugLog.resolvedPath` (default `docs/resolved.md`). Paths resolve against the project root so MCP multi-project mode writes into the correct repo; the `run_suite` `logBugs` argument still overrides config (precedence: `logBugs` arg → `bugLog.enabled` → on). When only `backlogPath` is set, `resolvedPath` defaults to a sibling `resolved.md` (P5-011)

## [0.1.1] - 2026-05-28

### Added
- `copyText` step type: extract text content from an element and store as a runtime variable for use in subsequent steps (P4-004)
- `waitForDownload` step type: wait for a file download event with optional filename assertion and custom timeout, saves downloaded file to run artifacts (P4-009)
- Built-in `{{RANDOM_*}}` variables: `RANDOM_EMAIL`, `RANDOM_NAME`, `RANDOM_NUMBER`, `RANDOM_UUID`, `RANDOM_TEXT` generated once per hunt run for unique test data (P6-004)
- `NOTICE` file at repo root aggregating attribution for direct runtime dependencies (LEGAL-003)
- Run history: every `prowl run` and `prowl ci` appends an entry to `.prowl/history.json` with hunt name, status, startedAt, duration, and runDir. Retention is configurable per hunt via `history.maxRuns` (default 100) and enforced after every write (P7-001)
- `prowl history <hunt-name>` command: shows the last N runs as a formatted table or as JSON via `--json`; `--limit <n>` controls the slice (default 20) (P7-001)
- Library exports: `readHistory`, `readHuntHistory`, and `HistoryEntry` / `HistoryFile` types for programmatic history access (P7-001)
- `runSuite()` library function: run an entire hunt suite programmatically (tag filtering, sequential/parallel execution, aggregated `CiResult`) without spawning the CLI, with presentation handled via optional hooks; exported alongside `runHunt`. `prowl ci` now delegates to it with no change in behavior (P5-008)
- `updateBacklogFromSuite()` library function: logs failing hunts from a suite run as deduplicated bug tickets in the target project's `docs/backlog.md`. A bug is fingerprinted by hunt + failing step (type/selector) + normalized error; new failures get a `QA-NNN` ticket in a dedicated `## QA Findings (automated)` section, already-open failures are skipped, and failures matching a resolved ticket are logged as regressions that reference the old id. Idempotent, with configurable backlog/resolved paths (P5-009)
- `prowl mcp` command: starts an MCP server (stdio) that exposes Prowl to AI agents as named tools — `list_hunts`, `run_suite` (runs all hunts and logs failures to the backlog, returning counts + created `QA-NNN` ids), and `run_hunt`. Lets any MCP client drive QA against the current project without shell access. Adds the `@modelcontextprotocol/sdk` dependency (P5-001)
- MCP multi-project registry: `prowl mcp --projects <path>` (or `PROWL_PROJECTS`, or `~/.prowl/projects.yml`) loads a YAML registry mapping project names to repo roots, so one server instance can drive many repos. Adds a `list_projects` tool and an optional `project` argument on `list_hunts`/`run_suite`/`run_hunt`; omitting it keeps the current-directory behavior (P5-010)

### Fixed
- `assert` visibility now treats prose values as text instead of CSS selectors. Strings containing punctuation (e.g. `visible: "name:"` or a sentence ending in `.`) previously crashed with "Unexpected token … while parsing css selector"; they are now matched via Playwright's text engine. Values with a clear selector signature (leading `.`/`#`/`[`, an attribute bracket, or an engine prefix like `css=`/`xpath=`/`text=`) still route to the selector engine (PQH-QA-001, PQH-QA-002)

### Documentation
- README guardrails section now documents substring-matching semantics for `forbiddenSelectors` and `networkIgnorePatterns`, and the intentional `about:`/`data:` protocol bypass in `allowedDomains` (BUG-005, BUG-006)

## [0.1.0] - 2026-02-19

### Improved
- `unmockRoute` accepts string shorthand (`unmockRoute: "**/api/users"`) in addition to object form
- `assert visible` / `assert notVisible` now accept CSS selectors (e.g., `img[alt='Logo']`, `.card-grid`) in addition to plain text
- `wait` step uses substring matching instead of exact match, so `wait: "Made for agents"` now matches elements containing that text

### Added
- `evalScript` step type: evaluate JavaScript expressions in browser context, with optional variable capture via `as` (P4-003)
- `runScript` step type: execute external JavaScript files in browser context (P4-003)
- Runtime variables: `evalScript` with `as` stores results for `{{VAR}}` interpolation in subsequent steps (P4-003)
- `assertScreenshot` step type: visual regression testing with pixel-level baseline comparison using configurable threshold (P6-006)
- `prowl update-baselines` command: accept current screenshots as new visual regression baselines (P6-006)
- `prowl analyze <url>` command: extract interactive elements and selectors from a page for agent-driven discovery (P5-002)
- `prowl generate` command: AI-powered hunt generation from page analysis and intent description, supports Anthropic and OpenAI providers (P5-003)
- `if` conditional step: execute sub-steps only when a selector is visible or not visible, enabling optional UI handling like cookie banners and modals (P4-002)
- `repeat` step type: loop sub-steps a fixed number of times (`times`) or conditionally (`while` with `maxIterations`), with maxSteps guardrail enforcement across iterations (P4-001)
- `mockRoute` / `unmockRoute` step types: intercept network requests with custom responses (inline body or file-based), enabling testing of error/loading/empty states (P4-005)
- `prowl ci --parallel <count>`: run hunts concurrently with N workers for faster CI suites; per-step output suppressed in parallel mode to prevent interleaving (P2-006)
- Millisecond precision in run directory timestamps to prevent collisions during parallel execution
- JUnit XML report: `artifacts.junit: true` config option and `--junit` CLI flag generate `junit.xml` per hunt run, compatible with GitHub Actions, Jenkins, and GitLab CI (P2-004)
- Library API: public programmatic exports (`runHunt`, `listHunts`, `loadHunt`, `loadConfig`, schemas) for Node.js integration (P2-010)
- `prowl run --json`: machine-readable JSON output for agent and CI consumption (P2-011)
- `prowl ci --json`: machine-readable JSON output of CI results (P2-009)
- `prowl ci` command: run all hunts sequentially with combined pass/fail exit code, CI summary table, `ci-result.json` output, and `--include-tags`/`--exclude-tags` filtering (P2-001)
- CI status semantics: exit code 0 (pass), 1 (fail), 2 (no hunts found or all hunts skipped by tag filters); `ci-result.json` status field distinguishes `"pass"`, `"fail"`, `"no-hunts"`, and `"all-skipped"` (P2-001)
- Auth state warning: `console.warn` when `storageStatePath` is set but file doesn't exist (P1.7-006)
- Markdown escaping: `escapeMd()` helper applied to step/assertion values and errors in report summaries (P1.7-008)
- Terminal UX: per-step progress output with pass/fail indicators, hunt header, and summary with step counts
- ASCII raccoon mascot with color states: green (pass), red (fail), cyan (welcome/running)
- `prowl init` shows welcome banner with mascot and getting-started hint
- `runHunt` step type: execute another hunt file inline for reusable sub-flows (`runHunt: "login"` or `runHunt: { name: "login", vars: { ... } }`), with circular dependency detection and sub-hunt error attribution (P1.6-002)
- Expanded examples: 8 heavily-commented hunt templates bundled with `prowl init` (P1.6-004)
- `hover` step type: hover over an element by selector (`hover: { selector: "..." }`) (P1.6-008)
- `scroll` step type: scroll the page by direction and amount (`scroll: { direction: "down", amount: 500 }`) (P1.6-009)
- `scrollTo` step type: scroll an element into view (`scrollTo: { selector: "..." }`) (P1.6-009)
- Browser channel support: `browser.channel` config option and `--channel` CLI flag for testing against installed browsers (chrome, msedge, etc.)
- Multi-browser support: `browser.engine` config option (`chromium`, `firefox`, `webkit`) and `--browser` CLI flag (P1.6-010)
- Viewport configuration: `browser.viewport` config option (presets: `mobile`, `tablet`, `desktop` or custom `{ width, height }`) and `--viewport` CLI flag (P1.6-011)
- Hunt tags: optional `tags` field in hunt YAML for categorization (P1.6-001)
- Tag filtering: `--include-tags` and `--exclude-tags` CLI flags on `prowl run` (P1.6-001)
- `prowl list` displays tags per hunt with aligned columns, description, and `--json` flag (P1.6-001, P1.6-005)
- Retry logic: optional `retry: { maxRetries, delay? }` field in hunt YAML for automatic retries on failure (P1.6-003)
- `onDialog` step type: register a one-time dialog handler (`accept` or `dismiss`) for browser-native dialogs (FEAT-003)
- `setInputFiles` step type: set files on `<input type="file">` elements, supports single or array of paths relative to `.prowl/` (FEAT-002)
- Shorthand syntax for hunts: `click: "Text"`, `fill: { "Label": "value" }`, `type: "text"`, and `select: { "Label": "value" }` with explicit syntax retained (P1.5-001)
- Inline `assert` step type for mid-flow checks: `visible`, `notVisible`, `urlIncludes`, `urlEquals` (P1.5-002)
- `wait` shorthand step: `wait: "Text"` and `wait: { for: "Text", timeout?: number }` (P1.5-003)
- `prowl watch <hunt-name>` command with immediate first run, 300ms debounce, and watch targets for hunt, config, and `.env` (P1.5-004)
- Comprehensive README with getting started, step reference, assertion reference, config reference, variable interpolation guide, selector best practices, auth guide, artifacts guide, architecture overview, and troubleshooting
- Community Hub (`prowl-hub`): community hunt templates with contribution guidelines and CI validation
- npm publish readiness: Apache 2.0 license, package metadata (keywords, repository, homepage, bugs)
- CLI foundation with `run`, `login`, `init`, `list`, `watch`, and `ci` commands
- Playwright integration with headless and headed modes
- Configuration system (`.prowl/config.yml`) with Zod schema validation
- Hunt file parsing (`.prowl/hunts/*.yml`) with variable interpolation (`{{VAR}}`)
- 26 step types: `navigate`, `click`, `fill`, `type`, `press`, `selectOption`, `select`, `waitForSelector`, `waitForUrl`, `waitForNetworkIdle`, `wait`, `assert`, `onDialog`, `setInputFiles`, `runHunt`, `hover`, `scroll`, `scrollTo`, `screenshot`, `if`, `repeat`, `mockRoute`, `unmockRoute`, `evalScript`, `runScript`, `assertScreenshot`
- 6 assertion types: `selectorExists`, `selectorNotExists`, `urlIncludes`, `urlEquals`, `noConsoleErrors`, `noNetworkErrors`
- Guardrails: forbidden selectors, allowed domains, max steps, max total time
- Artifact generation: screenshots (on-failure/all), console logs, network HAR, Playwright traces, JUnit XML
- Report generation: `summary.md`, `result.json`, and `junit.xml` per run
- Variable interpolation with redaction of sensitive fill step values
- Auth state capture via `prowl login` for authenticated test flows

### Changed
- `prowl init` now bundles a single minimal `hello.yml` starter hunt instead of 8 example hunts; example templates moved to the community hub at hub.prowl.tools
- `prowl init` output now points users to the community hub for additional hunt templates
- `init --force` preserves user-created files; only overwrites known template files (config.yml, example hunts, .gitignore) (P1.7-009)

### Fixed
- Auth state warning: suppress misleading "Auth state file not found" warning when config does not include an `auth` section; `storageStatePath` now defaults to `undefined` instead of always resolving to `.prowl/auth-state.json` (BUG-007)
- Screenshot path traversal: reject screenshot names containing `/`, `\`, or `..` (BUG-004)
- `init` command: replace hardcoded path resolution with directory walk to find package root (BUG-002)
- `package.json`: include `examples/` in `files` field so `prowl init` works after `npm install -g` (BUG-003)
- Nested variable interpolation: hunt vars referencing env vars via `{{...}}` now resolve correctly (BUG-001)
- Guardrail hardening: enforce forbidden selector checks for shorthand `click`, `fill`, `select`, `type`, `wait`, `assert`, `waitForSelector`, and `type` `:focus` paths
- Redact `type` step values in reports to match `fill` step redaction behavior
