# CLAUDE.md - Agent Guidelines for Prowl

## Project Context
Prowl is a CLI QA testing tool that:
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

## Prowl Ecosystem

**GitHub Org**: [Prowl-qa](https://github.com/Prowl-qa)

| Repo | Purpose |
|------|---------|
| `Prowl-qa/prowl` | CLI tool (this repo) |
| `Prowl-qa/prowl-docs` | Documentation site (Docusaurus) |
| `Prowl-qa/prowl-web` | Marketing landing page (Next.js) |
| `Prowl-qa/prowl-hub` | Community hunt templates |

### Cross-Repo Guidelines
- **This repo** is the source of truth for all CLI features and step types
- **prowl-docs** should be updated when step types, config options, or CLI commands change
- **prowl-web** is the marketing site — update feature descriptions when major features ship
- **prowl-hub** has its own CLAUDE.md with strict read-only security rules for agents

## Access Policy

Infrastructure credentials and host details are not stored in this repository.
Contact ops for access through the private credentials vault.
