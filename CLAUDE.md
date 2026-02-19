# CLAUDE.md - Agent Guidelines for ProwlQA

## Project Context
ProwlQA is a CLI QA testing tool that:
- Executes explicit test steps (no natural language in MVP)
- Uses Playwright for browser automation
- Produces developer-ready artifacts and reports
- Is CLI-first with no UI required

## Key Design Principles
1. **Determinism** - Scripted steps, predictable behavior
2. **Stable selectors** - Prefer data-testid, accessible roles
3. **Developer-ready reports** - Screenshots, traces, repro steps
4. **Guardrails** - Forbidden selectors, allowed domains, max steps
5. **File-based storage** - No database for MVP

## Definition of Done

Every feature or bug fix must include:
1. **Code** — Implementation with types, schema, interpolation, actions, runner, and tests as applicable
2. **Tests** — Unit tests covering the new behavior; all existing tests must still pass
3. **Build & Lint** — `npm run build` and `npm run lint` must pass
4. **Changelog** — Add the change to the `[Unreleased]` section in `CHANGELOG.md`

Work is not considered complete until all four items are done.

## ProwlQA Ecosystem

**GitHub Org**: [Prowl-qa](https://github.com/Prowl-qa)

| Repo | Purpose | Local Path |
|------|---------|------------|
| `Prowl-qa/prowl` | CLI tool (this repo) | `~/Desktop/Current Projects/Prowl QA/Repositories/prowl` |
| `Prowl-qa/prowl-docs` | Documentation site (Docusaurus) | `~/Desktop/Current Projects/Prowl QA/Repositories/prowl-docs` |
| `Prowl-qa/prowl-web` | Marketing landing page (Next.js) | `~/Desktop/Current Projects/Prowl QA/Repositories/prowl-web` |
| `Prowl-qa/prowl-hub` | Community hunt templates | `~/Desktop/Current Projects/Prowl QA/Repositories/prowl-hub` |
| `prowltools/prowl-twitter-bot` | Twitter bot (@prowlqa) | `~/Desktop/Current Projects/Prowl QA/Repositories/prowl-twitter-bot` |

**Backlogs**: `~/Desktop/Backlogs/projects/Prowl/`
**Assets**: `~/Desktop/Current Projects/Prowl QA/Assets/`

### Cross-Repo Guidelines
- **This repo** is the source of truth for all CLI features and step types
- **prowl-docs** should be updated when step types, config options, or CLI commands change
- **prowl-web** is the marketing site — update feature descriptions when major features ship
- **prowl-hub** has its own CLAUDE.md with strict read-only security rules for agents

### Hunt Authoring in Other Repos
When asked to create hunts (`.prowlqa/` config and hunt YAML files) in another repo, create the YAML files and stop. Do NOT run `prowlqa ci`, `prowlqa run`, or any hunt execution commands. All hunts will be run by the user as an end user so they can experience the tool from a user's perspective.

## Access Policy

Infrastructure credentials and host details are not stored in this repository.
Contact ops for access through the private credentials vault.
