# Prowl Rebrand — Name Change Instructions

> **Status:** Planned (not yet executed). This is the canonical, repo-local checklist for the Prowl rebrand.
> It is derived from one shared spec — **do not invent names; use exactly what's below** so every repo stays consistent.
> The master external/manual checklist lives in **`prowl-web` → `docs/name-change-instructions.md`**.

## Background

"Prowl QA" is being promoted from a single product into **Prowl**, an umbrella brand for a suite of
developer tools, sitting under a holding company, **Genkei Labs**. The legacy name "Prowl QA" and the
domain `prowlqa.dev` are retired.

## Locked decisions

- **Holding company:** Genkei Labs (`genkeilabs.com`) — quiet parent. Products carry a light
  "Brought to you by Genkei Labs" signature; the parent is not the hero brand.
- **Umbrella brand:** **Prowl** — both the suite name *and* the flagship CLI tool's name (Google-style:
  "Prowl" the suite vs. "the Prowl CLI" the tool; disambiguate in prose where needed).
- **Flagship CLI tool:** "Prowl" (formerly "Prowl QA"). npm package, binary, and command all become
  **`prowl`** (was `prowlqa`).
- **Products, repos & domains:**

  | Product | Domain | Repo |
  |---|---|---|
  | Prowl — suite hub (leads with the CLI tool) | `prowl.tools` | `prowl-web` |
  | Documentation | `docs.prowl.tools` | `prowl-docs` |
  | Prowl Hub | `hub.prowl.tools` | `prowl-hub` |
  | Prowl Infra | `infra.prowl.tools` | `prowl-infra-hub` |
  | Prowl Code Review *(future, backlog only)* | `review.prowl.tools` *(reserved)* | `prowl-code-review` |
  | Prowl CLI tool | *no own subdomain — hero of `prowl.tools`, reference at `docs.prowl.tools`* | `prowl` |

- **GitHub org:** `Prowl-qa` → **`prowl-tools`** (`github.com/prowl-tools/…`). GitHub auto-redirects old URLs, but update references anyway.
- **CLI project config dir:** `.prowlqa/` → **`.prowl/`** — the CLI must keep reading `.prowlqa/` during a deprecation window (back-compat), emitting a warning.

## Global find → replace

Apply repo-wide, **longest / most-specific tokens first**, then eyeball every hit (some are historical and should keep their meaning):

| Find | → Replace | Notes |
|---|---|---|
| `docs.prowlqa.dev` | `docs.prowl.tools` | do before the next row |
| `prowlqa.dev` | `prowl.tools` | |
| `github.com/Prowl-qa` | `github.com/prowl-tools` | |
| `Prowl-qa` | `prowl-tools` | org refs only — check context |
| `.prowlqa/` | `.prowl/` | config dir — see back-compat note |
| `prowlai` | `prowl` | pre-existing typo — fix it |
| `prowlqa` | `prowl` | package / command / handle — check context |
| `Prowl QA` | `Prowl` | product name in prose |

---

## This repo's changes — `prowl` (the CLI tool)

This is the source of truth for the tool itself, and its rename has the most teeth (it breaks installs),
so coordinate the package/command rename with the **npm** and **Homebrew** steps in the master checklist.

### Package & binary
- `package.json`: `name` `prowlqa` → `prowl`; `bin` entry → `prowl`; update `repository.url`,
  `homepage` (`https://prowl.tools`), `bugs.url` (`https://github.com/prowl-tools/prowl/issues`),
  `description`, and keywords.
- `src/cli/program.ts`: program/command name → `prowl`; update the usage/help banner and any branded strings.

### Config-directory back-compat (important)
- `src/config/loader.ts`: resolve **`.prowl/`** first; if absent, fall back to **`.prowlqa/`** with a one-line
  deprecation warning. Keep the fallback for at least one minor-version window.
- `examples/config.yml`, `examples/hunts/hello.yml`: move to `.prowl/` conventions and refresh references.
- `init` command (`src/cli/commands/init.ts`): scaffold `.prowl/`, not `.prowlqa/`.

### Source strings & URLs
- Sweep `src/` for user-facing brand/URL strings: `src/cli/commands/*` (ci, flaky, generate, history,
  init, login, mcp), `src/browser/controller.ts`, `src/generator/prompt.ts`,
  `src/mcp/{server,projects}.ts` (MCP server name if branded), `src/reporter/summary.ts`. Apply the global table.

### Docs & meta
- `README.md`, `AGENTS.md`, `CLAUDE.md`, `NOTICE`, `CHANGELOG.md`: rebrand prose + install commands
  (`npm i -g prowlqa` → `npm i -g prowl`) + links. Add a CHANGELOG entry documenting the rename and the
  `prowlqa` deprecation.
- `docs/research/*` (competitive-analysis, positioning, primary-icp): strategic/historical — update product
  naming and domains but preserve the analysis. Update `docs/backlog.md`, `docs/resolved.md`.

### Tests
- Update expected strings in `test/assertions.test.ts`, `test/ci.test.ts`, `test/backlog.test.ts`, and any
  fixture/snapshot asserting `prowlqa` / `.prowlqa/` / old URLs. Run the suite after.

### npm migration (paired with master checklist #5)
- Publish under `prowl`. Then `npm deprecate "prowlqa@*" "Renamed to 'prowl' — install: npm i -g prowl"`.
  Optionally ship one final `prowlqa` release whose `postinstall` prints the migration notice.
