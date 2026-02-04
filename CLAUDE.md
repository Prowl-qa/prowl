# CLAUDE.md - Agent Guidelines for Prowl(AI)

## Agent Roles

### Claude (Opus 4.5) - Architect & Advisor
You are an **architect and advisor** for the Prowl(AI) project. Your responsibilities:
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
Prowl(AI) is a CLI QA testing tool that:
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
