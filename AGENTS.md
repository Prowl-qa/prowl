## Prowl - Agent Instructions

This file is the single source of truth for agent behavior on this repo. Follow it before making any changes.

## Project Summary (MVP)
- CLI-first QA tool that executes explicit Playwright steps (no LLM/agent reasoning in Phase 1).
- Package name: `prowl` (global install via npm).
- Node.js 20+ / TypeScript.
- Chromium only for MVP.
- Config: `.prowl/config.yml`; hunts: `.prowl/hunts/*.yml`; artifacts: `.prowl/runs/<timestamp>/`.
- `prowl login` captures `storageState` and saves to `.prowl/auth-state.json`.
- Screenshots: on-failure plus **always** final screenshot (even on pass).
- `waitForUrl` uses "includes" matching.
- Env interpolation `{{VAR}}` from `process.env` then `.env` (same directory as config).
- Redact `{{VAR}}` values in `summary.md` and `result.json`.
- `maxSteps` is a pre-flight cap: fail if `steps.length > maxSteps`.
- `allowedDomains` auto-includes host from `target.url` or `--url` override.
- `.env` location: same directory as resolved `.prowl/config.yml`.
- `prowl init` refuses if `.prowl/` exists unless `--force`.
- Browser install is manual and documented: `npx playwright install chromium`.

## Clean Code Standards (Non-Negotiable)
- **DRY**: Avoid duplicated logic; centralize shared behavior.
- **SSOT**: One authoritative definition for schemas, defaults, and constants.
- **Small, focused modules** with clear responsibilities.
- **Explicit error handling** with actionable messages.
- **Predictable behavior**: deterministic execution, no hidden side effects.
- **Readable code** over cleverness; use clear naming.

## Workflow: Commits (gpush)
All work must be committed. Use the `gpush` script for commits and pushing.

Steps:
1. Run `gpush`.
2. When asked to commit, type `y`.
3. When prompted for a commit message, enter a concise description of what was added/removed/updated.
4. Ensure the push to the current branch succeeds.

## Quality Gates (Before Each Commit)
- Run linting.
- Create unit tests for each piece of functionality you build.
- Do not move to the next item/task until linting passes and relevant unit tests are in place.

## Change Policy
- Do not modify the repo unless explicitly approved by the owner.
- After approval, implement changes incrementally and commit each logical chunk via `gpush`.

## Code Review Handling
- When code review issues are provided as input, handle each item by either:
  1. fixing the issue in code, or
  2. providing a clear technical argument for why no code change is needed.
