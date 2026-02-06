# Changelog

All notable changes to Prowl(AI) will be documented in this file.

## [Unreleased]

### Current Sprint - MVP Foundation
- [ ] Project scaffolding (package.json, tsconfig, etc.)
- [ ] CLI with `prowlai run`, `prowlai login`, `prowlai init`
- [ ] Configuration system (.prowl/config.yml)
- [ ] Hunt file parsing (.prowl/hunts/*.yml)
- [ ] Playwright browser controller
- [ ] Step execution (navigate, click, fill, waitFor*)
- [ ] Assertion evaluation
- [ ] Artifact bundling (screenshots on failure + final, console)
- [ ] summary.md and result.json generation

---

## Backlog

### Phase 2 - Agent Intelligence
- [ ] LLM provider abstraction (OpenAI + Anthropic)
- [ ] Natural language hunt parsing
- [ ] Planner agent (break hunts into steps)
- [ ] Reasoner agent (evaluate success/failure)
- [ ] Retry logic with adaptive reasoning
- [ ] Light exploratory mode

### Phase 3 - Developer Experience
- [ ] `prowlai list` command
- [ ] Interactive `prowlai init`
- [ ] Failure diagnosis with suggested fixes
- [ ] Integration with Claude Code / Codex (report → fix loop)
- [ ] Watch mode for continuous testing

### Phase 4 - Robustness
- [ ] Test data seeding strategies
- [ ] Flakiness detection and auto-retry
- [ ] Visual diff comparison
- [ ] Accessibility checks (axe-core)
- [ ] Hunt-level variables (vars: block)

### Phase 5 - Team Features (Future SaaS)
- [ ] Optional server mode with history
- [ ] SQLite/Postgres for run persistence
- [ ] GitHub Action integration
- [ ] PR comment reports
- [ ] JUnit XML output
- [ ] Slack notifications
- [ ] Cloud runners
- [ ] Multi-tenant support

---

## [0.1.0] - TBD

### Added
- Initial release
- CLI foundation (`run`, `login`, `init`)
- Playwright integration (Chromium)
- Explicit step execution
- Artifact generation
