# Prowl Primary ICP

## The First Adopter

**QA engineers on small teams working alongside AI-assisted developers.**

They are the person on a 5–25 person product team who owns test coverage. Their developers ship code produced in large part by AI agents. That code needs independent validation before it reaches production, and the QA engineer is the person accountable for that signal. Prowl exists for them.

## Persona Profile

- **Role:** QA Engineer, QA Lead, or engineer with a QA hat (often the only one on the team)
- **Team size:** 5–25 people, usually one product
- **Stack:** Web app (React/Vue/Svelte/etc.), deployed via CI, GitHub- or GitLab-hosted
- **Technical level:** Comfortable with YAML, CLI tools, and CI pipelines. Not necessarily a TypeScript expert.
- **How their team works:** Developers use Claude, Copilot, Cursor, or similar to write 50–100% of their code. The QA engineer validates that what ships actually works.

## Pain They Are Solving

1. **Agent-written code outpaces their ability to write tests for it.** Features land faster than they can author coverage in Playwright or Cypress.
2. **Tests written in TypeScript are hard to review.** When a developer (or agent) changes a test, the QA engineer wants to verify intent without reading 200 lines of framework code.
3. **Manual regression passes don't scale.** Every release, the same flows get clicked through by hand. It's tedious and error-prone.
4. **No shared language between humans and agents for describing test intent.** Developers write tests in code, QA writes tickets in prose, and neither translates cleanly.
5. **Trust erodes when tests become opaque.** Flaky, unreadable test suites get ignored, which defeats the purpose.

## Alternatives They Use Today

| Alternative | Why they leave it |
|---|---|
| **Playwright (raw)** | Powerful but verbose. Requires TypeScript fluency to read or modify. Hard to hand off to non-developers. |
| **Cypress** | Same issue — JS framework lock-in and learning curve. |
| **Manual regression** | Doesn't scale. Misses regressions. QA engineer spends hours on rote clicking instead of exploratory testing. |
| **Skipping tests entirely** | Common in vibe-coded/AI-assisted projects. Works until it catastrophically doesn't. |

## Why Prowl Wins for Them

1. **YAML hunts are readable by everyone on the team.** A developer, a QA engineer, a PM, and an AI agent can all read the same hunt file and agree on what it does. That shared substrate is the product.
2. **Agents can author hunts as easily as humans can.** `prowl generate` lets an agent draft tests from a URL and intent. The QA engineer reviews the YAML, not a 200-line code change.
3. **Deterministic and CI-native by design.** JSON output, guardrails, exit codes — fits existing pipelines without bespoke glue.
4. **The QA engineer becomes the reviewer, not the author.** Prowl lets agents do the heavy lifting while the QA engineer applies judgment — the role evolves from bottleneck to quality gatekeeper.
5. **Playwright underneath.** No fidelity tradeoff. Same browser, same selectors, same power — just a readable surface on top.

## The Positioning in One Sentence

> **Prowl is the shared test layer for teams where AI agents write most of the code and humans stay accountable for what ships.**

## Secondary / Adjacent Audiences

These will benefit from Prowl and may adopt over time, but they are not the first target. Messaging, onboarding, and feature priorities should be built for the primary ICP above — not averaged across everyone.

- **Junior developers** on AI-assisted teams who want to contribute tests without framework fluency
- **Solo/indie developers** adding coverage to side projects or vibe-coded apps
- **Consultants / agencies** building for SMB clients who need reusable test artifacts across projects
- **AI agent builders** who need programmatic, deterministic browser testing as a tool in their agent's toolkit
