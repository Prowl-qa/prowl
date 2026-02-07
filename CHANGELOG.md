# Changelog

All notable changes to Prowl(AI) will be documented in this file.

## [Unreleased]

### Added
- `onDialog` step type: register a one-time dialog handler (`accept` or `dismiss`) for browser-native dialogs (FEAT-003)
- `setInputFiles` step type: set files on `<input type="file">` elements, supports single or array of paths relative to `.prowl/` (FEAT-002)

### Fixed
- `init` command: replace hardcoded path resolution with directory walk to find package root (BUG-002)
- `package.json`: include `examples/` in `files` field so `prowlai init` works after `npm install -g` (BUG-003)
- Nested variable interpolation: hunt vars referencing env vars via `{{...}}` now resolve correctly (BUG-001)

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
- Auth state capture via `prowlai login` for authenticated test flows
- Empty-string variable support with regression test
