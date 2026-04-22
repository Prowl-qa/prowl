# ProwlQA — Positioning

> Distilled from [competitive-analysis-full.md](./competitive-analysis-full.md). Last updated: 2026-02-16.

---

## Tagline

**"The YAML testing layer for teams and AI agents, powered by Playwright."**

---

## Target Users

| Segment | Description |
|---------|-------------|
| **AI agents** | Claude Code, Codex, Cursor, and other coding agents that write and run tests autonomously |
| **QA engineers** | Manual testers moving to automation who don't want to learn TypeScript |
| **Small teams** | Startups and small dev teams who need test coverage without a dedicated QA hire |
| **Developers** | Full-stack devs who want quick smoke tests without Playwright boilerplate |

---

## Value Props by Audience

### AI Agents
- **10-20x token efficiency** — a hunt YAML is ~200-400 tokens vs ~3,700-7,800 for Playwright test + config
- **Structured JSON output** — `--json` flags on every command for machine consumption
- **Zero context tax** — CLI is pay-per-use, no MCP server eating context window
- **Deterministic execution** — scripted steps produce predictable results every time

### QA Engineers & Non-Developers
- **YAML only** — no TypeScript, no async/await, no imports
- **Label-based selectors** — `fill: "Email"` instead of `page.getByLabel('Email').fill()`
- **Hunt composition** — reuse login flows with `runHunt`, no fixtures to understand
- **Rich artifacts** — screenshots every step, console logs, network errors, traces

### Small Teams & CI
- **One command** — `prowl ci` runs all hunts, exits non-zero on failure
- **Opinionated defaults** — `noConsoleErrors` and `noNetworkErrors` catch regressions automatically
- **Zero config start** — `prowl init` scaffolds everything, ready in 30 seconds

### Developers
- **Built on Playwright** — all the power, none of the boilerplate
- **Safety guardrails** — `allowedDomains`, `forbiddenSelectors`, `maxSteps` prevent runaway tests
- **Credential safety** — `{{VAR}}` interpolation with automatic redaction in reports

---

## What ProwlQA Is

- A **CLI tool** that runs YAML-defined browser tests using Playwright
- A **YAML abstraction layer** over Playwright's browser automation engine
- **Deterministic** — explicit steps, no AI guessing, predictable behavior
- **Opinionated** — sensible defaults, built-in guardrails, structured artifacts
- **Agent-native** — designed for AI consumption from day one (JSON output, token efficiency, structured exit codes)

## What ProwlQA Is NOT

- Not a Playwright replacement — it's built on Playwright
- Not an AI tester — it executes explicit steps (no NLP interpretation)
- Not a mobile testing tool — web only, go deep where Maestro is shallow
- Not a cloud platform (yet) — CLI-first, local execution
- Not a record-and-playback tool — hunts are authored, not recorded

---

## Competitive Moat

**CLI-first agent efficiency.**

Every competitor optimizes for human developers. ProwlQA optimizes for both humans AND AI agents:

- Humans get YAML (no code)
- Agents get structured JSON (minimal tokens)
- Both get guardrails (no other tool has them)

As AI agents write more tests, the tool that costs the fewest tokens per test wins distribution. ProwlQA is 10-20x cheaper than Playwright for an AI agent to use.

---

## Key Differentiators

| | ProwlQA | Playwright | Cypress | Maestro |
|---|---------|-----------|---------|---------|
| **Language** | YAML | TypeScript | JavaScript | YAML |
| **Web maturity** | Core focus | Gold standard | Established | Beta |
| **AI token cost** | ~200-400/test | ~3,700-7,800/test | ~3,000-6,000/test | ~150-300/test |
| **Guardrails** | Built-in | None | None | None |
| **Credential safety** | Automatic | Manual | Manual | None |
| **Config complexity** | ~10 lines | ~30-60 lines | ~15-30 lines | None |
| **Non-dev accessible** | Yes | No | No | Mostly |
| **Multi-browser** | Chromium/FF/WK | Chromium/FF/WK | Chrome-family | Chromium only |
| **Artifacts** | Screenshots + logs + traces | Configurable | Screenshots | Basic |

---

## Marketing Angles

### Lead with Numbers
- "10-20x cheaper for AI agents" — ~200-400 tokens vs ~3,700-7,800 for Playwright
- "50% fewer lines than Playwright" — 45-line CRUD cycle vs 70-90 lines
- "30 seconds to first test" — `prowl init` + edit YAML + `prowl run`
- "Zero code barrier" — YAML only, no TypeScript, no async/await

### Lead with Pain Points
- "Your QA engineer doesn't know TypeScript? They don't need to."
- "Your AI agent burns 7,800 tokens per Playwright test. ProwlQA uses 400."
- "Cypress charges for parallelism. Playwright needs config. ProwlQA just works."

### Lead with Safety
- "The only testing tool with built-in guardrails"
- "Forbidden selectors prevent clicking 'Delete All' in production"
- "Credentials never leak into test reports"

### Lead with Philosophy
- "Maestro proved YAML testing works. ProwlQA brings it to the web."
- "Built on Playwright. Accessible to everyone."
- "Opinionated defaults, escape hatches when you need them."
