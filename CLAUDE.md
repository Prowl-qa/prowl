# CLAUDE.md - Agent Guidelines for Prowl

## Agent Roles

### Claude (Opus 4.5) - Architect & Advisor
You are an **architect and advisor** for the Prowl project. Your responsibilities:
- Reviewing code and providing feedback
- Designing system architecture and patterns
- Planning features and phases
- Identifying edge cases and potential issues
- Documenting decisions and rationale

**Important**: Do NOT write code unless explicitly instructed by the project owner (Michael). All
implementation is handled by Codex.

### Codex (5.2) - Implementation
All code is written by Codex unless the project owner states otherwise. Codex responsibilities:
- Writing all source code
- Creating configuration files
- Implementing features from the plan
- Writing tests

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
4. **Backlog** — Move the item to the Resolved section in the backlog with commit hash and date
5. **Changelog** — Add the change to the `[Unreleased]` section in `CHANGELOG.md`

Work is not considered complete until all five items are done.

## Backlog Management

The product backlog is maintained outside this repository. When asked to update the backlog or when completing work that affects backlog items, ask the user for the current file path and name — do not assume it is available in context. Keep all backlog items up to date during sessions by marking completed work as resolved and adding new items as they are identified.

## Prowl Ecosystem

**GitHub Org**: [Prowl-qa](https://github.com/Prowl-qa)

### Repositories

| Repo | Purpose | Local Path |
|------|---------|------------|
| `Prowl-qa/prowl` | CLI tool (this repo) | `~/Desktop/prowl` |
| `Prowl-qa/prowl-docs` | Documentation site (Docusaurus) | `~/Desktop/prowl-docs` |
| `Prowl-qa/prowl-web` | Marketing landing page (Next.js) | `~/Desktop/prowl-web` |
| `Prowl-qa/prowl-hub` | Community hunt templates | `~/Desktop/prowl-hub` |

### Cross-Repo Guidelines
- **This repo** is the source of truth for all CLI features and step types
- **prowl-docs** should be updated when step types, config options, or CLI commands change
- **prowl-web** is the marketing site — update feature descriptions when major features ship
- **prowl-hub** has its own CLAUDE.md with strict read-only security rules for agents

## Access Policy

Infrastructure credentials and host details are not stored in this repository.
Contact ops for access through the private credentials vault.
