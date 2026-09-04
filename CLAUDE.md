# CLAUDE.md — Prowl CLI

> Workspace-wide conventions (mission, branding, repo map, stack baseline, Definition of Done,
> git/backlog policy) live in the **workspace `CLAUDE.md`** at the root of this workspace
> (`../../CLAUDE.md`) and load automatically. This file covers only what is specific to `prowl`.

## Project Context
Prowl is the CLI QA testing tool at the center of the suite (npm `prowl-tools`). It:
- Executes explicit, scripted test steps (no natural language in MVP)
- Uses Playwright for browser automation
- Produces developer-ready artifacts and reports (screenshots, traces, repro steps)
- Is CLI-first, file-based storage, no UI or database required

It is the **source of truth** for the shared toolchain and the raw-`fetch` multi-provider LLM
abstraction (`src/generator/ai.ts`) that other repos reuse.

## Key Design Principles
1. **Determinism** — scripted steps, predictable behavior
2. **Stable selectors** — prefer `data-testid`, accessible roles
3. **Developer-ready reports** — screenshots, traces, repro steps
4. **Guardrails** — forbidden selectors, allowed domains, max steps
5. **File-based storage** — no database for MVP

## Version source of truth
`package.json`. The CLI reports its version via `CLI_VERSION` in `src/cli/program.ts`, which
reads `package.json` — no hardcoded version to update.

## Release Configuration
Project-specific details for the `release-prep-npm` skill (the generic workflow lives in the skill).

- **Package**: `prowl-tools` (public, npm). License Apache-2.0.
- **Publish mode**: **CI tag-triggered**. `.github/workflows/publish.yml` runs on pushed tags
  matching `v*`: `npm ci` → build → lint → test → `npm publish --provenance --access public`,
  then extracts release notes and creates a GitHub Release. **Do not run `npm publish` locally** —
  push the tag and let CI publish.
- **Publishing auth (OIDC Trusted Publishing — no token)**: since v0.1.5 (PROWL-057,
  2026-08-21) the publish step authenticates via GitHub Actions OIDC (`id-token: write`) with
  the trusted publisher configured on the npm package (GitHub Actions · `prowl-tools/prowl` ·
  `publish.yml`). There is no `NPM_TOKEN` secret and nothing expires or rotates. OIDC needs
  Node ≥ 22.14.0 / npm ≥ 11.5.1 (the workflow pins these). The package's publishing access is
  "require 2FA and disallow bypass tokens".
- **Release notes source**: the workflow extracts the section under `## [<version>]` in
  `CHANGELOG.md` (version = tag without the `v`). The heading must exist and be non-empty or the
  release job fails. Before tagging: rename `## [Unreleased]` → `## [x.y.z] - YYYY-MM-DD` and add
  a fresh empty `## [Unreleased]` above it.
- **Bump command**: `npm version <x.y.z> --no-git-tag-version` (updates `package.json` +
  `package-lock.json`; we own the commit/tag separately).
- **Branch policy**: never commit the bump to `main`. Use a `release-vX.Y.Z` branch → PR → merge,
  then tag from `main` (`git tag vX.Y.Z && git push origin vX.Y.Z`) to trigger publish.
- **Tarball contents** (`files` in `package.json`): `dist`, `examples`, `LICENSE`, `README.md`,
  `NOTICE`. Verify with `npm pack --dry-run` — never ship `src/`/`test/`, never omit `dist/` or
  attribution notices.
- **npm version-history quirk**: an orphaned `1.0.0` exists on npm, but `latest` tracks the
  `0.1.x` line. Keep releasing in the `0.1.x`/`0.x` line so `latest` advances; do not assume the
  next version follows `1.0.0`.
- **Downstream — Homebrew**: tap repo `prowl-tools/homebrew-tap`, formula `Formula/prowl.rb`,
  default branch `main`. The publish workflow does **not** update the tap. The formula pins the
  npm tarball by full `url` plus `sha256` (no separate `version` field). After publishing, set
  `url` to the new tarball and `sha256` to its hash (`npm view prowl-tools@<version> dist.tarball`
  and `… dist.integrity`, or download + `shasum -a 256`), commit, and push the tap. NOTE: the
  formula currently points at the orphaned `1.0.0`, so `brew install` is out of sync with npm
  `latest` — bumping realigns them.
- **Downstream — docs/web**: update `prowl-docs` for new commands/step types and `prowl-web` for
  major feature descriptions (see workspace cross-repo duties).
- **Post-release — blog post (content-writer)**: after the tag is pushed and the publish
  verified, invoke the **`content-writer` agent** (defined at `~/.claude/agents/content-writer.md`)
  for the release's blog post. It researches the release, interviews the owner, and drafts a
  story/how-to MDX post into `prowl-web/content/blog/` on a branch for the owner's review — it
  never publishes on its own. Skip only if the owner says the release doesn't warrant a post.

## Hunt Authoring in Other Repos
When asked to create hunts (`.prowl/` config and hunt YAML files) in another repo, create the
YAML files and stop. Do NOT run `prowl ci`, `prowl run`, or any hunt-execution command — all
hunts are run by the user, so they experience the tool from a user's perspective.
