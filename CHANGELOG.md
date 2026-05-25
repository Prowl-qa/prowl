# Changelog

All notable changes to ProwlQA will be documented in this file.

## [Unreleased]

### Added
- `copyText` step type: extract text content from an element and store as a runtime variable for use in subsequent steps (P4-004)
- `waitForDownload` step type: wait for a file download event with optional filename assertion and custom timeout, saves downloaded file to run artifacts (P4-009)
- Built-in `{{RANDOM_*}}` variables: `RANDOM_EMAIL`, `RANDOM_NAME`, `RANDOM_NUMBER`, `RANDOM_UUID`, `RANDOM_TEXT` generated once per hunt run for unique test data (P6-004)
- `NOTICE` file at repo root aggregating attribution for direct runtime dependencies (LEGAL-003)
- Run history: every `prowlqa run` and `prowlqa ci` appends an entry to `.prowlqa/history.json` with hunt name, status, startedAt, duration, and runDir. Retention is configurable per hunt via `history.maxRuns` (default 100) and enforced after every write (P7-001)
- `prowlqa history <hunt-name>` command: shows the last N runs as a formatted table or as JSON via `--json`; `--limit <n>` controls the slice (default 20) (P7-001)
- Library exports: `readHistory`, `readHuntHistory`, and `HistoryEntry` / `HistoryFile` types for programmatic history access (P7-001)
- `runSuite()` library function: run an entire hunt suite programmatically (tag filtering, sequential/parallel execution, aggregated `CiResult`) without spawning the CLI, with presentation handled via optional hooks; exported alongside `runHunt`. `prowlqa ci` now delegates to it with no change in behavior (P5-008)
- `updateBacklogFromSuite()` library function: logs failing hunts from a suite run as deduplicated bug tickets in the target project's `docs/backlog.md`. A bug is fingerprinted by hunt + failing step (type/selector) + normalized error; new failures get a `QA-NNN` ticket in a dedicated `## QA Findings (automated)` section, already-open failures are skipped, and failures matching a resolved ticket are logged as regressions that reference the old id. Idempotent, with configurable backlog/resolved paths (P5-009)

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
- `prowlqa update-baselines` command: accept current screenshots as new visual regression baselines (P6-006)
- `prowlqa analyze <url>` command: extract interactive elements and selectors from a page for agent-driven discovery (P5-002)
- `prowlqa generate` command: AI-powered hunt generation from page analysis and intent description, supports Anthropic and OpenAI providers (P5-003)
- `if` conditional step: execute sub-steps only when a selector is visible or not visible, enabling optional UI handling like cookie banners and modals (P4-002)
- `repeat` step type: loop sub-steps a fixed number of times (`times`) or conditionally (`while` with `maxIterations`), with maxSteps guardrail enforcement across iterations (P4-001)
- `mockRoute` / `unmockRoute` step types: intercept network requests with custom responses (inline body or file-based), enabling testing of error/loading/empty states (P4-005)
- `prowlqa ci --parallel <count>`: run hunts concurrently with N workers for faster CI suites; per-step output suppressed in parallel mode to prevent interleaving (P2-006)
- Millisecond precision in run directory timestamps to prevent collisions during parallel execution
- JUnit XML report: `artifacts.junit: true` config option and `--junit` CLI flag generate `junit.xml` per hunt run, compatible with GitHub Actions, Jenkins, and GitLab CI (P2-004)
- Library API: public programmatic exports (`runHunt`, `listHunts`, `loadHunt`, `loadConfig`, schemas) for Node.js integration (P2-010)
- `prowlqa run --json`: machine-readable JSON output for agent and CI consumption (P2-011)
- `prowlqa ci --json`: machine-readable JSON output of CI results (P2-009)
- `prowlqa ci` command: run all hunts sequentially with combined pass/fail exit code, CI summary table, `ci-result.json` output, and `--include-tags`/`--exclude-tags` filtering (P2-001)
- CI status semantics: exit code 0 (pass), 1 (fail), 2 (no hunts found or all hunts skipped by tag filters); `ci-result.json` status field distinguishes `"pass"`, `"fail"`, `"no-hunts"`, and `"all-skipped"` (P2-001)
- Auth state warning: `console.warn` when `storageStatePath` is set but file doesn't exist (P1.7-006)
- Markdown escaping: `escapeMd()` helper applied to step/assertion values and errors in report summaries (P1.7-008)
- Terminal UX: per-step progress output with pass/fail indicators, hunt header, and summary with step counts
- ASCII raccoon mascot with color states: green (pass), red (fail), cyan (welcome/running)
- `prowlqa init` shows welcome banner with mascot and getting-started hint
- `runHunt` step type: execute another hunt file inline for reusable sub-flows (`runHunt: "login"` or `runHunt: { name: "login", vars: { ... } }`), with circular dependency detection and sub-hunt error attribution (P1.6-002)
- Expanded examples: 8 heavily-commented hunt templates bundled with `prowlqa init` (P1.6-004)
- `hover` step type: hover over an element by selector (`hover: { selector: "..." }`) (P1.6-008)
- `scroll` step type: scroll the page by direction and amount (`scroll: { direction: "down", amount: 500 }`) (P1.6-009)
- `scrollTo` step type: scroll an element into view (`scrollTo: { selector: "..." }`) (P1.6-009)
- Browser channel support: `browser.channel` config option and `--channel` CLI flag for testing against installed browsers (chrome, msedge, etc.)
- Multi-browser support: `browser.engine` config option (`chromium`, `firefox`, `webkit`) and `--browser` CLI flag (P1.6-010)
- Viewport configuration: `browser.viewport` config option (presets: `mobile`, `tablet`, `desktop` or custom `{ width, height }`) and `--viewport` CLI flag (P1.6-011)
- Hunt tags: optional `tags` field in hunt YAML for categorization (P1.6-001)
- Tag filtering: `--include-tags` and `--exclude-tags` CLI flags on `prowlqa run` (P1.6-001)
- `prowlqa list` displays tags per hunt with aligned columns, description, and `--json` flag (P1.6-001, P1.6-005)
- Retry logic: optional `retry: { maxRetries, delay? }` field in hunt YAML for automatic retries on failure (P1.6-003)
- `onDialog` step type: register a one-time dialog handler (`accept` or `dismiss`) for browser-native dialogs (FEAT-003)
- `setInputFiles` step type: set files on `<input type="file">` elements, supports single or array of paths relative to `.prowlqa/` (FEAT-002)
- Shorthand syntax for hunts: `click: "Text"`, `fill: { "Label": "value" }`, `type: "text"`, and `select: { "Label": "value" }` with explicit syntax retained (P1.5-001)
- Inline `assert` step type for mid-flow checks: `visible`, `notVisible`, `urlIncludes`, `urlEquals` (P1.5-002)
- `wait` shorthand step: `wait: "Text"` and `wait: { for: "Text", timeout?: number }` (P1.5-003)
- `prowlqa watch <hunt-name>` command with immediate first run, 300ms debounce, and watch targets for hunt, config, and `.env` (P1.5-004)
- Comprehensive README with getting started, step reference, assertion reference, config reference, variable interpolation guide, selector best practices, auth guide, artifacts guide, architecture overview, and troubleshooting
- Community Hub (`prowl-hub`): community hunt templates with contribution guidelines and CI validation
- npm publish readiness: Apache 2.0 license, package metadata (keywords, repository, homepage, bugs)
- CLI foundation with `run`, `login`, `init`, `list`, `watch`, and `ci` commands
- Playwright integration with headless and headed modes
- Configuration system (`.prowlqa/config.yml`) with Zod schema validation
- Hunt file parsing (`.prowlqa/hunts/*.yml`) with variable interpolation (`{{VAR}}`)
- 26 step types: `navigate`, `click`, `fill`, `type`, `press`, `selectOption`, `select`, `waitForSelector`, `waitForUrl`, `waitForNetworkIdle`, `wait`, `assert`, `onDialog`, `setInputFiles`, `runHunt`, `hover`, `scroll`, `scrollTo`, `screenshot`, `if`, `repeat`, `mockRoute`, `unmockRoute`, `evalScript`, `runScript`, `assertScreenshot`
- 6 assertion types: `selectorExists`, `selectorNotExists`, `urlIncludes`, `urlEquals`, `noConsoleErrors`, `noNetworkErrors`
- Guardrails: forbidden selectors, allowed domains, max steps, max total time
- Artifact generation: screenshots (on-failure/all), console logs, network HAR, Playwright traces, JUnit XML
- Report generation: `summary.md`, `result.json`, and `junit.xml` per run
- Variable interpolation with redaction of sensitive fill step values
- Auth state capture via `prowlqa login` for authenticated test flows

### Changed
- `prowlqa init` now bundles a single minimal `hello.yml` starter hunt instead of 8 example hunts; example templates moved to the community hub at hub.prowlqa.dev
- `prowlqa init` output now points users to the community hub for additional hunt templates
- `init --force` preserves user-created files; only overwrites known template files (config.yml, example hunts, .gitignore) (P1.7-009)

### Fixed
- Auth state warning: suppress misleading "Auth state file not found" warning when config does not include an `auth` section; `storageStatePath` now defaults to `undefined` instead of always resolving to `.prowlqa/auth-state.json` (BUG-007)
- Screenshot path traversal: reject screenshot names containing `/`, `\`, or `..` (BUG-004)
- `init` command: replace hardcoded path resolution with directory walk to find package root (BUG-002)
- `package.json`: include `examples/` in `files` field so `prowlqa init` works after `npm install -g` (BUG-003)
- Nested variable interpolation: hunt vars referencing env vars via `{{...}}` now resolve correctly (BUG-001)
- Guardrail hardening: enforce forbidden selector checks for shorthand `click`, `fill`, `select`, `type`, `wait`, `assert`, `waitForSelector`, and `type` `:focus` paths
- Redact `type` step values in reports to match `fill` step redaction behavior
