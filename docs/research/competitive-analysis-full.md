# ProwlQA — Full Competitive Analysis

> Comprehensive comparison of ProwlQA against Playwright CLI, Cypress, Maestro, and MCP-based alternatives.
> Research date: 2026-02-16. Based on public docs, benchmarks, and hands-on analysis.

---

## Table of Contents

1. [Side-by-Side: Login Flow](#side-by-side-login-flow)
2. [Verbosity & Complexity Table](#verbosity--complexity-table)
3. [CRUD Cycle Comparison](#crud-cycle-comparison)
4. [Feature Matrix](#feature-matrix)
5. [Competitor Deep Dives](#competitor-deep-dives)
6. [Token Efficiency for AI Agents](#token-efficiency-for-ai-agents)
7. [Honest Wins & Losses](#honest-wins--losses)

---

## Side-by-Side: Login Flow

### ProwlQA (15 lines of steps)

```yaml
name: login-flow
description: Log in with email and password, verify redirect to dashboard

vars:
  EMAIL: "{{TEST_EMAIL}}"
  PASSWORD: "{{TEST_PASSWORD}}"

steps:
  - navigate: "/login"
  - fill:
      "Email": "{{EMAIL}}"
  - fill:
      "Password": "{{PASSWORD}}"
  - click: "Sign In"
  - waitForUrl:
      value: "/dashboard"
      timeout: 10000
  - assert:
      visible: "Dashboard"

assertions:
  - urlIncludes: "/dashboard"
  - noConsoleErrors: true
```

### Playwright Test (~25 lines + config)

```typescript
import { test, expect } from '@playwright/test';

test('login flow', async ({ page }) => {
  await page.goto('/login');

  await page.getByLabel('Email').fill(process.env.TEST_EMAIL!);
  await page.getByLabel('Password').fill(process.env.TEST_PASSWORD!);

  await page.getByRole('button', { name: 'Sign In' }).click();

  await page.waitForURL('**/dashboard', { timeout: 10000 });

  await expect(page.getByText('Dashboard')).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard/);
});
```

Plus `playwright.config.ts` (~30-60 lines).

### Cypress Test (~20 lines + config)

```javascript
describe('Login', () => {
  it('logs in with email and password', () => {
    cy.visit('/login');
    cy.get('[data-cy="email"]').type(Cypress.env('TEST_EMAIL'));
    cy.get('[data-cy="password"]').type(Cypress.env('TEST_PASSWORD'));
    cy.get('button').contains('Sign In').click();
    cy.url().should('include', '/dashboard', { timeout: 10000 });
    cy.contains('Dashboard').should('be.visible');
  });
});
```

Plus `cypress.config.ts` (~15-30 lines).

### Maestro Flow (~10 lines)

```yaml
url: http://localhost:3000/login
---
- inputText:
    text: "user@example.com"
    selector: "[data-testid='email']"
- inputText:
    text: "secret123"
    selector: "[data-testid='password']"
- tapOn: "Sign In"
- assertVisible: "Dashboard"
```

---

## Verbosity & Complexity Table

| Metric | ProwlQA | Playwright | Cypress | Maestro |
|--------|---------|-----------|---------|---------|
| **Lines for login test** | 15 | 25 + config | 20 + config | 10 |
| **Config file needed** | `config.yml` (simple) | `playwright.config.ts` (complex) | `cypress.config.ts` (moderate) | None |
| **Language required** | YAML only | TypeScript/JS | JavaScript | YAML only |
| **async/await needed** | No | Yes, every line | No (chaining) | No |
| **Selector knowledge** | Optional (uses labels) | Yes (locators API) | Yes (CSS selectors) | Yes (selectors) |
| **Imports/boilerplate** | None | `import { test, expect }` | `describe/it` wrapping | None |
| **Tokens for AI to generate** | ~200-400 (generation only / YAML definition) | ~600-800 + config | ~500-700 + config | ~150-300 |
| **Can a non-dev write it?** | Yes | No | Unlikely | Mostly yes |

---

## CRUD Cycle Comparison

ProwlQA's CRUD cycle example (`crud-cycle.yml`) handles login reuse via `runHunt`, create, read, update, delete with dialog handling, and cleanup verification in **~45 lines of YAML**.

The equivalent Playwright test: **~70-90 lines of TypeScript** requiring knowledge of:

- `test.describe` / `test.beforeAll` for login reuse (or `storageState` setup project)
- `page.getByLabel().fill()` / `page.getByRole('button').click()` for each interaction
- `page.on('dialog', ...)` for dialog handling
- `await expect()` for every assertion
- Proper async/await chains
- Error handling patterns

**ProwlQA is ~50% shorter and requires zero programming knowledge.**

---

## Feature Matrix

### ProwlQA vs Playwright vs Cypress

| Feature | ProwlQA | Playwright | Cypress |
|---------|---------|-----------|---------|
| **Language** | YAML | TS/JS/Python/Java/C# | JS/TS |
| **Browser engines** | Chromium, Firefox, WebKit | Chromium, Firefox, WebKit | Chrome-family, Firefox (limited) |
| **Multi-tab support** | No | Yes | No |
| **Network interception** | Planned (P4-005) | Yes (`page.route`, HAR) | Yes (`cy.intercept`) |
| **Visual regression** | Planned (P6-006) | Yes (`toHaveScreenshot`) | Via plugins |
| **Parallel execution** | Planned (P2-006) | Free, native, built-in | Requires Cypress Cloud (paid) |
| **AI agent efficiency** | ~200-400 tokens/test | ~3,700-7,800 tokens/test | ~3,000-6,000 tokens/test |
| **Safety guardrails** | Built-in | None | None |
| **Credential redaction** | Automatic `{{VAR}}` | Manual | Manual |
| **Test composition** | `runHunt` (YAML) | Fixtures, imports | Custom commands |
| **Config complexity** | Low (~10 lines) | High (~30-60 lines) | Moderate (~15-30 lines) |
| **Architecture** | CLI on Playwright | Out-of-process | In-browser |
| **NPM downloads** | New | 20-30M/week | Surpassed by Playwright mid-2024 |

### ProwlQA vs Maestro (Web)

| Feature | ProwlQA | Maestro |
|---------|---------|---------|
| **Web support maturity** | Core focus | Beta, afterthought |
| **Selector precision** | Playwright engine (surgical) | Accessibility-based (simple but fragile) |
| **Multi-browser** | Chromium, Firefox, WebKit | Chromium only |
| **Safety guardrails** | Forbidden selectors, allowed domains, max steps | None |
| **Credential protection** | Automatic `{{VAR}}` redaction | None |
| **Contributor language** | TypeScript + Node.js | Kotlin + Java 17 |
| **AI integration** | CLI-first (any agent) | Proprietary chatbot (MaestroGPT) |
| **Artifacts** | Screenshots every step, console logs, network errors, traces | Basic pass/fail |
| **Network mocking** | Planned (built-in via Playwright) | Requires external tools (WireMock) |
| **Visual regression** | Planned (built-in) | Not available |
| **Flow control** | Planned (repeat, if) | Built-in (repeat, runFlow, when) |
| **Community** | New | 10.6k stars, 103 contributors |

### Other YAML-Based Testing Tools

| Tool | Focus | Notes |
|------|-------|-------|
| **Maestro** | Mobile + Web (YAML) | Covered above |
| **OpenTest** | Web (YAML) | YAML-based, keyword-driven actions |
| **Tavern** | API testing (YAML) | YAML-based API definitions, no browser |
| **Zerocode** | API + Performance (YAML/JSON) | Declarative orchestration, no browser UI |
| **Selenium IDE** | Web (recorded) | Chrome extension, records to JSON/code |
| **Katalon** | Web + Mobile + API | Keyword-driven, GUI-based, commercial |

**Key insight:** There is no widely-adopted, production-grade, YAML-based web testing tool with the depth of Playwright's browser automation. Maestro comes closest but is mobile-first. ProwlQA occupies a unique position.

---

## Competitor Deep Dives

### Playwright

**What it is:** Microsoft's open-source browser automation framework. The gold standard for programmatic web testing.

**Strengths:**
- Full programmatic power — can express any test logic
- 20+ web-first assertions with auto-retry
- Visual regression via `toHaveScreenshot()` with diffing and baseline updates
- Network interception via `page.route()` and HAR recording/playback
- Trace viewer with 11 panels (actions, console, network, source, etc.)
- UI Mode with time-travel debugging
- Auth state persistence via `storageState` with setup projects
- Native parallelism with workers and sharding
- Multi-browser projects (Chrome, Firefox, WebKit, mobile emulation)
- Codegen tool for recording interactions to code
- 8 built-in reporters (list, dot, html, json, junit, blob, GitHub)
- Tag/grep filtering and annotations (slow, skip, fixme)
- Learning curve: 1-2 weeks for devs, 3-4 weeks for QA

**Weaknesses (ProwlQA's opportunity):**
- Requires TypeScript/JS knowledge — excludes non-developers
- Config is complex (`playwright.config.ts` is 30-60 lines minimum)
- Every line requires async/await understanding
- AI agent token cost: ~3,700-7,800 tokens per test (vs ProwlQA's ~200-400)
- No built-in guardrails or safety rails
- No credential redaction in reports
- No opinionated defaults (noConsoleErrors, noNetworkErrors must be manually coded)

### Cypress

**Strengths:**
- Intuitive debugging with time-travel in DevTools
- Simpler setup for JS-heavy SPAs
- `cy.intercept` for network mocking
- Established community and plugin ecosystem

**Weaknesses:**
- Single-browser focus (Chrome-family, limited Firefox)
- Paid parallelism (requires Cypress Cloud)
- No multi-tab support
- No WebKit support
- In-browser architecture (single-tab limitation)
- Heavier dependency tree (160+ deps vs Playwright's minimal)
- Execution speed: up to 4x slower than Playwright
- CI cost: 40-60% higher than Playwright (linear scaling)
- Surpassed by Playwright in NPM downloads mid-2024

### Maestro

See [competitive-analysis.md](./competitive-analysis.md) for the original focused analysis.

**Additional context:** Maestro proved the YAML-declarative model works and has real market demand. Prowl applies that proven model to web testing with better precision, safety, and developer tooling. Maestro's 10.6k stars validate the approach; their web beta's limitations validate the opportunity.

---

## Token Efficiency for AI Agents

### Why This Matters

AI agents (Claude Code, Codex, Cursor, etc.) are increasingly writing and running tests. The token cost of interacting with a testing tool directly impacts:
- Cost per test generation/execution cycle
- How many tests fit in context
- Agent autonomy (fewer tokens = more room for reasoning)

### ProwlQA CLI Token Costs

| Operation | Tokens |
|-----------|--------|
| `prowlqa --help` | ~150 |
| `prowlqa run --help` | ~100 |
| `prowlqa ci --help` | ~120 |
| `prowlqa list --help` | ~50 |
| Full CLI discovery | ~500 |
| Single run result (`--json`) | ~800-1,200 |
| CI result (10 hunts, `--json`) | ~500-800 |
| `prowlqa list --json` | ~50-200 |

**Total for single test run**: ~1,050-3,150 tokens
Includes the full execution cycle: prompts, responses, and parsing/result processing.

### Playwright Token Costs

| Component | Tokens |
|-----------|--------|
| `playwright.config.ts` (typical) | 800-1,200 |
| Single test file (~50 lines) | 400-600 |
| Playwright API type definitions (for context) | 2,000-5,000 |
| Running + interpreting output | 500-1,000 |
| **Total for one test** | **~3,700-7,800** |

### MCP vs CLI Architecture

Playwright's own benchmarks show:
- **MCP approach**: ~114,000 tokens per typical browser automation task
- **CLI approach**: ~27,000 tokens — a **4x reduction**

The difference is architectural:
- MCP returns full accessibility trees and screenshots inline in the context window
- CLI saves snapshots to disk and returns file paths only
- Average DOM size: ~20k-30k tokens on complex pages

Connecting to 5-10 MCP servers can consume 15-20% of an LLM's context window before any work begins. Best practice (2026): run agents only on failed tests during a second pass, cutting token spend by ~70%.

### ProwlQA's MCP Decision

MCP server (P5-001) was initially deprioritized on token-efficiency grounds, then **revived** (2026-05-24) as a planned epic — re-scoped from a generic MCP wrapper to a first-class agent QA interface with automated bug-logging (see the "Agent QA / MCP Server" epic in `docs/backlog.md`). The CLI + library API remains the token-efficient default for agents:
- CLI is **pay-per-use** (~150 tokens for discovery, ~800-1,200 per run)
- MCP imposes a **constant context tax** (~2-3k+ tokens per conversation)
- The MCP server's value is a named-tool interface (run hunts, get structured results, auto-log bugs), not token savings — so it complements rather than replaces the CLI

---

## Honest Wins & Losses

### Where ProwlQA Wins

1. **No code required** — YAML vs TypeScript eliminates the biggest barrier to adoption
2. **AI-agent friendly** — ~200-400 tokens per hunt vs ~3,700-7,800 for Playwright test + config
3. **Built-in guardrails** — `allowedDomains`, `forbiddenSelectors`, `maxSteps` — no equivalent in any competitor
4. **Hunt composition** — `runHunt` enables reuse without understanding fixtures or imports
5. **Opinionated defaults** — `noConsoleErrors`, `noNetworkErrors` assertions are automatic
6. **Deterministic** — Scripted steps, predictable execution, no flake from async race conditions
7. **Credential safety** — Automatic `{{VAR}}` redaction in reports
8. **Artifact richness** — Screenshots every step, console logs, network errors, Playwright traces

### Where ProwlQA Loses (Today)

| Gap | Competitor with it | Backlog item |
|-----|-------------------|--------------|
| Visual regression | Playwright (`toHaveScreenshot`) | P6-006 |
| Network interception/mocking | Playwright (`page.route`), Cypress (`cy.intercept`) | P4-005 |
| Parallel execution | Playwright (workers), Maestro (`--shard`) | P2-006 |
| Conditional logic & loops | Maestro (`repeat`, `when`), Playwright (JS) | P4-001, P4-002 |
| JavaScript escape hatch | Maestro (`evalScript`), Playwright (native) | P4-003 |
| Community size | Maestro (10.6k stars), Playwright (20-30M/week) | Organic growth |
| Interactive debugging | Playwright (UI Mode), Cypress (time-travel) | Not planned for MVP |
| Multi-tab support | Playwright | Not planned |

### Strategic Position

ProwlQA does not compete with Playwright — it is built **on top of** Playwright. The value proposition is a YAML abstraction layer that makes Playwright's power accessible to non-developers and token-efficient for AI agents, with safety guardrails that no competitor offers.

Maestro proved the YAML-declarative model works. ProwlQA applies it to web testing where Maestro is weakest.
