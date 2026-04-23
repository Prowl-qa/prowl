# Prowl (CLI) - Resolved Items

### ~~LEGAL-003: Create NOTICE File for Attribution~~
**Resolved**: 2026-04-22 (commit eac6b14)
**Description**: Added a `NOTICE` file at the repo root aggregating attribution (license + copyright) for all direct runtime dependencies: chalk, commander, dotenv, ora, pixelmatch, playwright, pngjs, yaml, and zod. Standard practice for Apache 2.0 projects.

### ~~BUG-006: `data:` and `about:` Protocols Bypass Domain Allowlist~~
**Resolved**: 2026-04-22 (commit eac6b14)
**Description**: Documented in the README guardrails section that `allowedDomains` enforcement applies to `http:`/`https:` navigations only, and that `about:` and `data:` protocols (e.g., `about:blank`) bypass the allowlist by design so hunts can interact with browser-internal pages.

### ~~BUG-005: Forbidden Selector Matching Uses Substring (Overly Permissive)~~
**Resolved**: 2026-04-22 (commit eac6b14)
**Description**: Documented in the README guardrails section that `forbiddenSelectors` and `assertions.networkIgnorePatterns` use JavaScript `includes()` for case-sensitive substring matching. Patterns must match case exactly, so `"Delete"` matches `"Delete History"` while `"delete"` does not. Users are guided to write patterns specifically enough to avoid unintended matches (e.g., `".delete-btn"` instead of `"delete"`).

### ~~GTM-001: Define Primary ICP~~
**Resolved**: 2026-04-22
**Description**: Defined ProwlQA's primary ICP as QA engineers on small teams working alongside AI-assisted developers. 1-pager captures persona, pains, alternatives, why ProwlQA wins, and secondary audiences. See `docs/research/primary-icp.md`.

### ~~P1.5-001: Shorthand Step Syntax~~
**Resolved**: 2026-02-08 (commit 8f47788)
**Description**: Added shorthand forms for `click`, `fill`, `type`, and `select` while preserving explicit selector-driven forms for precision.

### ~~P1.5-002: `assert` Inline Step Type~~
**Resolved**: 2026-02-08 (commit 8f47788)
**Description**: Added inline `assert` step with `visible`, `notVisible`, `urlIncludes`, and `urlEquals`, including fail-fast behavior and failure screenshot coverage.

### ~~P1.5-003: `wait` Shorthand~~
**Resolved**: 2026-02-08 (commit 8f47788)
**Description**: Added `wait` shorthand (`string` and `{ for, timeout }`) mapped to text-based selector waiting while keeping `waitForSelector` unchanged.

### ~~P1.5-004: Continuous Watch Mode~~
**Resolved**: 2026-02-08 (commit 8f47788)
**Description**: Added `prowl watch <hunt-name>` with immediate first run, 300ms debounce, and file watching for hunt, config, and `.env`.

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

### ~~P1.6-002: Hunt Composition (`runHunt` step)~~
**Resolved**: 2026-02-09
**Description**: Added `runHunt` step type with simple form (`runHunt: "login"`) and object form (`runHunt: { name, vars }`). Includes circular dependency detection, sub-hunt error attribution, sub-hunt screenshots in parent report. Types, schema, interpolation, runner, 4 unit tests.

### ~~P1.6-004: Expanded Examples~~
**Resolved**: 2026-02-09
**Description**: Expanded from 1 to 8 example hunts bundled with `prowl init`. Includes: homepage, login-flow, signup-flow, form-submit, form-validation, crud-cycle, checkout-flow, onboarding-wizard. All heavily commented as learning resources. Updated `init` command to copy all hunts dynamically.

### ~~P1.6-006: npm Publish Readiness~~
**Resolved**: 2026-02-09
**Description**: Added Apache 2.0 LICENSE, package metadata (keywords, repository, homepage, bugs, author, license). Package name set to `prowlai` (`prowl` taken on npm). Verified full install flow: `npm pack` → `npm install -g` → `prowl init` → `prowl --help`. Clean tarball with only dist/, examples/, LICENSE, README.

### ~~P1.6-007: Documentation / Comprehensive README~~
**Resolved**: 2026-02-09
**Description**: Comprehensive README rewrite with: getting started (install → init → run), step type reference (16 types with shorthand/explicit examples), assertion reference, config reference with defaults, variable interpolation guide, shorthand vs explicit comparison table, selector best practices, auth setup guide, artifacts guide, architecture overview, community hub link, troubleshooting FAQ. Includes `<!-- ILLUSTRATION: -->` placeholders for future visuals.

### ~~Terminal UX & Mascot~~
**Resolved**: 2026-02-09
**Description**: Added ASCII raccoon mascot with color states (green/red/cyan), per-step progress output with checkmark/X indicators and timing, hunt header and summary with step counts. Updated `prowl init` to show welcome banner. New files: `src/cli/mascot.ts`, `src/cli/output.ts`. Added `onStep` callback to runner for live progress.

### ~~Community Hub Foundation~~
**Resolved**: 2026-02-09
**Description**: Seeded `prowl-hub` repo with 5 community hunt templates (auth/oauth-google, auth/password-reset, e-commerce/stripe-checkout, admin/data-table-filter, saas/team-invite). README with contribution guidelines, CLAUDE.md with strict read-only agent security rules, SECURITY.md with threat model, `.github/workflows/validate-submission.yml` with automated CI checks (file type, size, credential pattern, URL, YAML validation).

### ~~BUG-004: Screenshot Name Allows Path Traversal~~
**Resolved**: 2026-02-12
**Description**: Added validation that screenshot `name` must not contain `/`, `\`, or `..`. Rejects with clear error message. Two unit tests added.

### ~~P1.6-001: Hunt Tags & Filtering~~
**Resolved**: 2026-02-12
**Description**: Added `tags` field to hunt YAML schema (string array, optional). `--include-tags` and `--exclude-tags` CLI flags on `prowl run`. `prowl list` displays tags per hunt. Schema validation tests added.

### ~~P1.6-003: Retry Logic~~
**Resolved**: 2026-02-12
**Description**: Added `retry: { maxRetries, delay? }` field to hunt YAML schema. Wraps hunt execution in retry loop with configurable delay between attempts. Report includes attempt info. Schema validation tests added.

### ~~P1.6-008: `hover` Step Type~~
**Resolved**: 2026-02-12
**Description**: Added `hover: { selector }` step type. Calls `page.locator(selector).hover()`. Forbidden selector check included. Schema + unit tests.

### ~~P1.6-009: `scroll` / `scrollTo` Step Types~~
**Resolved**: 2026-02-12
**Description**: Added `scroll: { direction, amount? }` (window.scrollBy) and `scrollTo: { selector }` (scrollIntoViewIfNeeded). Forbidden selector check on scrollTo. Schema + unit tests.

### ~~P1.6-010: Multi-Browser Support~~
**Resolved**: 2026-02-12
**Description**: Added `browser.engine` config option (`chromium`, `firefox`, `webkit`) and `--browser` CLI flag. Updated `launchBrowser()` to use `playwright[engine].launch()`. Schema validation tests added.

### ~~P1.6-011: Viewport Configuration~~
**Resolved**: 2026-02-12
**Description**: Added `browser.viewport` config option with presets (`mobile` 375x812, `tablet` 768x1024, `desktop` 1280x720) and custom `{ width, height }`. Added `--viewport` CLI flag (WxH or preset). Schema validation tests added.

### ~~P1.6-005: Enhanced `prowl list` Output~~
**Resolved**: 2026-02-13 (commit de14a2b)
**Description**: Enhanced `prowl list` to show aligned columns with hunt name, description (truncated to 40 chars), and tags. Added `--json` flag for programmatic output. Added `loadHuntMeta()` lightweight loader. Unit tests for default output, JSON output, and empty state.

### ~~Browser Channel Support~~
**Resolved**: 2026-02-13 (commit 3b12d52, branch: multi-browser)
**Description**: Added `browser.channel` config option and `--channel` CLI flag for testing against installed branded browsers (chrome, chrome-beta, chrome-canary, chrome-dev, msedge, msedge-beta, msedge-canary, msedge-dev). Strict enum validation, undefined default preserves existing behavior. 6 new tests across controller, schema, and commands.

### ~~P1.7-001 through P1.7-009: Code Quality & Test Coverage~~
**Resolved**: 2026-02-12
**Description**: Phase 1.7 complete. Test count 84 → 161. Added 4 new test files (output, controller, runner, commands). Expanded 2 existing test files (reporter, init). Source changes: exported `describeStep`/`truncate`, added auth state warning, added `escapeMd()` helper, improved `--force` safety, added documentation comments. Build and lint passing.

### ~~P2-001: `prowlqa ci` Command~~
**Resolved**: 2026-02-15 (commits 71f2575, bcc4736, 18de480; branch: multi-browser)
**Description**: Added `prowlqa ci` command that discovers all hunts, runs them sequentially, prints per-hunt live output with step-by-step results, prints a combined CI summary table, writes `ci-result.json` to a timestamped CI run directory, and exits with appropriate code. Supports all run flags (`--url`, `--headed`, `--slow-mo`, `--trace`, `--browser`, `--channel`, `--viewport`, `--config`). Exit code semantics: 0 (pass), 1 (fail), 2 (no hunts found or all hunts skipped). `ci-result.json` status distinguishes `"pass"`, `"fail"`, `"no-hunts"`, and `"all-skipped"`. Types (`CiHuntResult`, `CiResult`, `CiStatus`) in `types/index.ts`. Shared `timestamp()` utility extracted to `src/utils/timestamp.ts`. 24 tests across command behavior, status resolution, counting, summary output, and JSON report writing. 192 total tests passing.

### ~~P2-010: Library API (Public Programmatic Entrypoint)~~
**Resolved**: 2026-02-15 (commit c361120, branch: library-api)
**Description**: Created `src/index.ts` as the public API surface for ProwlQA. Exports `runHunt`, `listHunts`, `loadConfig`, `loadHunt`, `loadHuntMeta`, `loadHuntTags`, schemas (`huntSchema`, `configSchema`, `stepSchema`), `interpolateHunt`, and all public types. Dual entrypoint tsup build: CLI stays at `dist/index.js`, library at `dist/lib.js` with `.d.ts`/`.d.cts` declarations. `package.json` updated with `main`, `module`, `types`, and nested `exports` conditions for ESM/CJS consumers. 7 library export tests added.

### ~~P2-011: `prowl run --json` Flag~~
**Resolved**: 2026-02-15 (commit c361120, branch: library-api)
**Description**: Added `--json` flag to `prowl run` that outputs `RunResult` as JSON to stdout, suppressing all formatted output (mascot, headers, step results, summary). Tag-skipped hunts emit `{ status: "skipped", hunt, reason }`. Error cases emit `{ status: "fail", exitCode: 1, hunt, error }`. Also added `--json` to `prowl ci` outputting the full `CiResult` (partial delivery of P2-009). 8 new command tests covering JSON success, error, skip, and output suppression. 209 total tests passing.

### ~~P2-004: JUnit XML Report Output~~
**Resolved**: 2026-02-15 (commit bf16525, branch: junit)
**Description**: Added JUnit XML report generation per hunt run. `artifacts.junit: true` config option (default: false) and `--junit` CLI flag on both `run` and `ci` commands. Each step maps to a `<testcase>`, each assertion maps to a `<testcase>`, failed items include `<failure>` elements with error messages. XML special characters escaped. Compatible with GitHub Actions, Jenkins, and GitLab CI dashboards. New `src/reporter/junit.ts` with `writeJunit()` and `escapeXml()`. 11 new tests in `test/junit.test.ts`, plus schema/commands/ci test updates. 224 total tests passing.

### ~~P2-005: Hunt Tagging in CI~~
**Resolved**: 2026-02-15 (included in P2-001 implementation; branch: multi-browser)
**Description**: `prowlqa ci --include-tags smoke` runs only hunts with matching tags; `--exclude-tags slow` skips hunts with matching tags. Combined filters supported. Skipped hunts recorded with `"skipped"` status in CI summary and `ci-result.json`. If all hunts are skipped by filters, exits with code 2 and `"all-skipped"` status.

### ~~P4-001: `repeat` Step Type~~
**Resolved**: 2026-02-17 (commit c370f97, branch: adoption-block)
**Description**: Added `repeat` step type with fixed count (`times`) and conditional (`while` with `visible`/`notVisible` + `maxIterations`) modes. Sub-steps execute in the same page context with `maxSteps` guardrail enforcement across iterations. Results prefixed as `repeat[N] > stepType`. Schema uses `z.lazy()` for recursive step references. 50 new tests across schema, runner, interpolation, and output.

### ~~P4-002: `if` / Conditional Steps~~
**Resolved**: 2026-02-17 (commit c370f97, branch: adoption-block)
**Description**: Added `if` conditional step with `visible`/`notVisible` condition and `then` sub-step array. Instant condition check via `locator.count()` (no waiting). When condition is met, sub-steps execute recursively with `if > stepType` result prefixing. When not met, returns pass with "condition not met, skipped". Schema uses `z.lazy()` for recursive `then` references.

### ~~P4-005: Network Interception / Mocking~~
**Resolved**: 2026-02-17 (commit c370f97, branch: adoption-block)
**Description**: Added `mockRoute` and `unmockRoute` step types. `mockRoute` intercepts requests matching a URL glob pattern with custom responses (inline `body` or file-based via `file` path relative to configDir). `unmockRoute` removes an active mock (errors if no mock exists). Active mocks tracked in a Map on the execution context, shared across recursive sub-step calls. Supports `contentType` and `status` configuration.

### ~~P2-006: Parallel Hunt Execution~~
**Resolved**: 2026-02-17 (commit c370f97, branch: adoption-block)
**Description**: Added `--parallel <count>` option to `prowlqa ci` for concurrent hunt execution. Worker-pool concurrency utility (`runWithConcurrency`) pulls tasks from a shared queue with configurable concurrency. Parallel mode suppresses per-step output to prevent interleaving. `--parallel 1` behaves identically to sequential mode. Timestamp precision upgraded to milliseconds to prevent run directory collisions during parallel execution.

### ~~P4-003: JavaScript Evaluation Step~~
**Resolved**: 2026-02-18 (commit b94ab37, branch: should-have)
**Description**: Added `evalScript` and `runScript` step types. `evalScript` evaluates JavaScript expressions in the browser context via `page.evaluate()`, with optional variable capture via `as` that stores results in a new `runtimeVars` Map on the execution context for `{{VAR}}` interpolation in subsequent steps. `runScript` executes external JavaScript files relative to configDir. Runtime variable substitution applied before each step when the map is non-empty. Schema, interpolation, output, and 9+ unit tests.

### ~~P6-006: Visual Regression Testing~~
**Resolved**: 2026-02-18 (commit b94ab37, branch: should-have)
**Description**: Added `assertScreenshot` step type for pixel-level visual regression testing using `pixelmatch` and `pngjs`. First run auto-saves screenshot as baseline; subsequent runs compare against baseline with configurable threshold (0-1). Diff images saved to artifacts when comparison fails. Added `prowlqa update-baselines` command to accept current screenshots as new baselines from the most recent run. Dynamic import of visual module to avoid loading dependencies for non-visual steps. Schema, interpolation, output, visual comparison tests, and update-baselines command tests.

### ~~P5-002: `prowlqa analyze` — Page Analysis Command~~
**Resolved**: 2026-02-18 (commit b94ab37, branch: should-have)
**Description**: Added `prowlqa analyze <url>` CLI command that launches a browser, navigates to a URL, and extracts all interactive elements with ranked selector candidates (testId > ariaLabel > label > css > name), form groups, and links. Human-readable table output by default; `--json` flag for structured agent consumption. Supports `--browser`, `--channel`, `--viewport`, `--headed` options. Works without `.prowlqa/` config directory. Exported `analyzePage()` and analysis types in library API.

### ~~P5-003: `prowlqa generate` — AI Hunt Generation Command~~
**Resolved**: 2026-02-18 (commit b94ab37, branch: should-have)
**Description**: Added `prowlqa generate` CLI command for AI-powered hunt generation from page analysis and intent description. Supports Anthropic (default, claude-sonnet-4-5) and OpenAI (gpt-4o) providers via `PROWL_AI_KEY`/`PROWL_AI_PROVIDER`/`PROWL_AI_MODEL` env vars. Uses native `fetch` (no SDK deps). Accepts piped analysis JSON from `prowlqa analyze --json` or runs analysis internally via `--url`. Generated YAML validated against `huntSchema`. Prompt includes full 26-step-type reference. Output to file (`--output`) or stdout (`--stdout`).

### ~~P4-004: `copyText` Step Type~~
**Resolved**: 2026-03-21 (branch: feature/copytext-random-download)
**Description**: Added `copyText: { selector, as }` step type that extracts `textContent` from an element and stores it as a runtime variable for `{{VAR}}` interpolation in subsequent steps. Includes forbidden selector check, null text content error handling, schema validation, interpolation support, and unit tests.

### ~~P4-009: `waitForDownload` Step Type~~
**Resolved**: 2026-03-21 (branch: feature/copytext-random-download)
**Description**: Added `waitForDownload` step type that captures file downloads via `page.waitForEvent('download')`. Supports bare form (`waitForDownload:` / null), optional `filename` assertion against `download.suggestedFilename()`, and configurable `timeout` (default 30s). Downloaded files saved to run artifacts directory. Schema validation, interpolation support, and unit tests included.

### ~~P6-004: Random Data Generators~~
**Resolved**: 2026-03-21 (branch: feature/copytext-random-download)
**Description**: Added built-in `{{RANDOM_*}}` variables generated once per hunt run: `RANDOM_EMAIL` (prowl_<hex>@test.com), `RANDOM_NAME` (random first+last), `RANDOM_NUMBER` (4-digit integer), `RANDOM_UUID` (v4 UUID), `RANDOM_TEXT` (8-char alphanumeric). Generated at lowest priority so env vars and hunt vars can override. Consistent within a single hunt run.
