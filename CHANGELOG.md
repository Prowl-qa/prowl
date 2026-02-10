# Changelog

All notable changes to Prowl will be documented in this file.

## [Unreleased]

---

## [1.0.0] - 2026-02-09

### Added
- Terminal UX: per-step progress output with pass/fail indicators, hunt header, and summary with step counts
- ASCII raccoon mascot with color states: green (pass), red (fail), cyan (welcome/running)
- `prowl init` now shows welcome banner with mascot and getting-started hint
- `runHunt` step type: execute another hunt file inline for reusable sub-flows (`runHunt: "login"` or `runHunt: { name: "login", vars: { ... } }`), with circular dependency detection and sub-hunt error attribution (P1.6-002)
- Expanded examples: 8 heavily-commented hunt templates (homepage, login-flow, signup-flow, form-submit, form-validation, crud-cycle, checkout-flow, onboarding-wizard) bundled with `prowl init` (P1.6-004)
- Comprehensive README with getting started, step reference, assertion reference, config reference, variable interpolation guide, selector best practices, auth guide, artifacts guide, architecture overview, troubleshooting, and `<!-- ILLUSTRATION: -->` placeholders (P1.6-007)
- Community Hub (`prowl-hub`): seeded with 5 community hunt templates (auth, e-commerce, admin, SaaS), README with contribution guidelines, CLAUDE.md with agent security rules, CI validation workflow
- npm publish readiness: Apache 2.0 license, package metadata (keywords, repository, homepage, bugs)
- `onDialog` step type: register a one-time dialog handler (`accept` or `dismiss`) for browser-native dialogs (FEAT-003)
- `setInputFiles` step type: set files on `<input type="file">` elements, supports single or array of paths relative to `.prowl/` (FEAT-002)
- Shorthand syntax for hunts: `click: "Text"`, `fill: { "Label": "value" }`, `type: "text"`, and `select: { "Label": "value" }` with explicit syntax retained (P1.5-001)
- Inline `assert` step type for mid-flow checks: `visible`, `notVisible`, `urlIncludes`, `urlEquals` (P1.5-002)
- `wait` shorthand step: `wait: "Text"` and `wait: { for: "Text", timeout?: number }` (P1.5-003)
- `prowl watch <hunt-name>` command with immediate first run, 300ms debounce, and watch targets for hunt, config, and `.env` (P1.5-004)

### Fixed
- `init` command: replace hardcoded path resolution with directory walk to find package root (BUG-002)
- `package.json`: include `examples/` in `files` field so `prowl init` works after `npm install -g` (BUG-003)
- Nested variable interpolation: hunt vars referencing env vars via `{{...}}` now resolve correctly (BUG-001)
- Guardrail hardening: enforce forbidden selector checks for shorthand `click`, `fill`, `select`, and `type` step paths
- Guardrail hardening: enforce forbidden selector checks for `wait` shorthand and inline `assert` text-based selectors
- Guardrail hardening: enforce forbidden selector guard for `type` shorthand `:focus` selector
- Guardrail hardening: escape role and label-derived selectors in shorthand guardrail checks
- Guardrail hardening: enforce forbidden selector guard for explicit `waitForSelector` step
- Redact `type` step values in reports to match `fill` step redaction behavior

---

## [0.1.0] - 2026-02-06

### Added
- CLI foundation with `run`, `login`, `init`, and `list` commands
- Playwright integration (Chromium) with headless and headed modes
- Configuration system (`.prowl/config.yml`) with Zod schema validation
- Hunt file parsing (`.prowl/hunts/*.yml`) with variable interpolation (`{{VAR}}`)
- 9 step types: `navigate`, `click`, `fill`, `press`, `selectOption`, `waitForSelector`, `waitForUrl`, `waitForNetworkIdle`, `screenshot`
- 6 assertion types: `selectorExists`, `selectorNotExists`, `urlIncludes`, `urlEquals`, `noConsoleErrors`, `noNetworkErrors`
- Guardrails: forbidden selectors, allowed domains, max steps, max total time
- Artifact generation: screenshots (on-failure/all), console logs, network HAR, Playwright traces
- Report generation: `summary.md` and `result.json` per run
- Variable interpolation with redaction of sensitive fill step values
- Auth state capture via `prowl login` for authenticated test flows
- Empty-string variable support with regression test
