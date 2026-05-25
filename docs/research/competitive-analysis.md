# Prowl - Competitive Analysis

## Primary Competitor: Maestro (mobile-dev-inc)
- **Website**: maestro.dev | **GitHub**: 10.6k stars, 103 contributors
- **Funding**: $4M raised ($3M seed, Feb 2025)
- **Language**: Kotlin (77%) — requires Java 17+
- **License**: Apache 2.0
- **Pricing**: Free CLI, cloud at $250/device/mo (mobile), $125/browser/mo (web), enterprise custom
- **Commands**: 47+ YAML actions (tapOn, inputText, assertVisible, scroll, swipe, repeat, runFlow, evalScript, etc.)
- **Extras**: MaestroGPT (AI chatbot), Maestro Studio (desktop IDE), cloud parallel execution, VS Code extensions
- **MaestroGPT details** (researched 2026-02-12): MaestroGPT is a documentation-aware chatbot — it answers Maestro syntax questions and generates YAML flows from natural language. It is NOT an autonomous AI tester. Available via `maestro chat` CLI, Maestro Studio, and Maestro Console. Separate from the chatbot, Maestro also has AI test commands (`assertWithAI`, `assertNoDefectsWithAI`, `extractTextWithAI`) that use screenshot + vision LLM analysis. These work via Maestro's cloud proxy or BYOK with OpenAI (`gpt-4o`) / Anthropic (`claude-3-5-sonnet`). All AI features are free with a free account. Prowl's agent-native approach — structured JSON output (`analyze --json`, `run --json`, `ci --json`) plus a programmatic library API, with an MCP server planned (P5-001) — lets any AI agent drive Prowl, vs. Maestro's proprietary chatbot.

**Maestro's strengths**:
- Simpler syntax (`tapOn: "Sign In"` vs explicit selectors)
- MaestroGPT for AI-assisted test authoring (chatbot, not autonomous AI — see note above)
- Maestro Studio desktop IDE for visual test building
- Cloud execution with parallel runs
- Built-in CI/CD PR integration with JUnit XML output
- Continuous mode (file watcher re-runs on save)
- Flow composition (`runFlow`) for reusable sub-flows
- Tags for filtering test suites
- JavaScript injection for complex logic
- Repeat/retry/conditional flow control
- Random data generators (email, name, number, etc.)
- Large community and adoption (10.6k stars)

**Maestro's weaknesses (Prowl's opportunities)**:
- Web support is in Beta — Chromium only, no locale support, no viewport configuration
- Accessibility-based selectors break on complex web apps (duplicate labels, dynamic content, shadow DOM)
- No guardrails (forbidden selectors, allowed domains, max steps)
- No variable redaction in reports (credential leak risk)
- Kotlin codebase excludes most web developers from contributing
- 415 open issues — scale is creating maintenance burden
- 7-minute cloud execution timeout
- No real iOS device support (simulator only)
- Network mocking requires external tools (WireMock, MockServer)
- No visual regression testing (screenshot diffing)
- Limited JavaScript engine (Rhino, migrating to GraalJS)
- Windows requires WSL2 — friction for Windows developers

## Differentiation Strategy

Prowl's positioning: **"The best YAML testing tool for web applications."**

Do not compete on mobile. Go deep on web where Maestro is shallow.

| Differentiator | Maestro | Prowl |
|---------------|---------|-------|
| Web support maturity | Beta, afterthought | Core focus |
| Selector precision | Accessibility-based (simple but fragile) | Playwright engine (surgical precision) |
| Safety guardrails | None | Forbidden selectors, allowed domains, max steps |
| Credential protection | None | Automatic `{{VAR}}` redaction in reports |
| Random data generation | Built-in generators for email, name, number, etc. | Built-in `RANDOM_*` interpolation vars (`RANDOM_EMAIL`, `RANDOM_NAME`, `RANDOM_NUMBER`, etc.) |
| Contributor accessibility | Kotlin + Java 17 | TypeScript + Node.js |
| AI integration approach | Chat sidebar (MaestroGPT) | Agent-native: JSON output + library API (any AI agent can generate/run hunts); MCP server planned |
| Artifact richness | Basic pass/fail | Screenshots every step, console logs, network errors, Playwright traces |
| Network mocking | Requires external tools | Built-in (planned — Playwright `page.route()`) |
| Visual regression | Not available | Built-in screenshot diffing (planned) |
| Multi-browser | Chromium only | Chromium, Firefox, WebKit via Playwright (planned) |

Key insight: Maestro proved the YAML-declarative model works and has real market demand. Prowl applies that proven model to web testing with better precision, safety, and developer tooling.
