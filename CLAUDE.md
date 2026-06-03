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

## Release Configuration

Project-specific details for the `release-prep-npm` skill. The generic workflow lives in the skill; the specifics for this repo are here.

- **Package**: `prowl-tools` (public, npm). License Apache-2.0.
- **Publish mode**: **CI tag-triggered**. `.github/workflows/publish.yml` runs on pushed tags matching `v*`. It runs `npm ci` → build → lint → test → `npm publish --provenance --access public`, then extracts release notes and creates a GitHub Release. **Do not run `npm publish` locally** — push the tag and let CI publish.
- **Publishing auth (`NPM_TOKEN`)**: the publish step uses the `NPM_TOKEN` GitHub Actions secret in `prowl-tools/prowl`. The token is granular and **expires every 90 days** (last rotated 2026-05-29 → next expiry ~2026-08-27). When it expires, the `npm publish` step fails with a misleading `404 Not Found - PUT .../prowl-tools` (npm masks an auth/permission failure as a 404) even though build/lint/test pass and the tarball is built. Fix: mint a new token (publish rights on `prowl-tools`), update the `NPM_TOKEN` repo secret, then re-run the failed job (`gh run rerun <run-id> --failed`) — no re-tagging needed. Before each release, check the token isn't near expiry.
- **Release notes source**: the workflow extracts the section under `## [<version>]` in `CHANGELOG.md` (version = tag without the `v`). The heading must exist and the section must be non-empty or the release job fails. So before tagging: rename `## [Unreleased]` → `## [x.y.z] - YYYY-MM-DD` and add a fresh empty `## [Unreleased]` above it.
- **Version source of truth**: `package.json`. The CLI reports its version via `CLI_VERSION` in `src/cli/program.ts`, which reads `package.json` — no hardcoded version to update.
- **Bump command**: `npm version <x.y.z> --no-git-tag-version` (updates `package.json` + `package-lock.json`; we own the commit/tag separately).
- **Branch policy**: never commit the bump directly to `main`. Use a `release-vX.Y.Z` branch → PR → merge, then tag from `main`. (PRs are created by the user, not the agent.)
- **Tag step (after the bump is merged to `main`)**: `git tag vX.Y.Z && git push origin vX.Y.Z` — this triggers the publish workflow.
- **Tarball contents** (`files` in `package.json`): `dist`, `examples`, `LICENSE`, `README.md`, and `NOTICE`. Verify with `npm pack --dry-run` — never ship `src/` or `test/`, never omit `dist/` or attribution notices.
- **npm version-history quirk**: an orphaned `1.0.0` exists on npm, but `latest` tracks the `0.1.x` line. Keep releasing in the `0.1.x`/`0.x` line so `latest` advances correctly; do not assume the next version follows `1.0.0`.
- **Downstream — Homebrew**: tap repo is `prowl-tools/homebrew-tap` (local clone: `~/Desktop/Current Projects/Prowl/Repositories/homebrew-tap`), formula at `Formula/prowl.rb`, default branch `main`. The publish workflow does **not** update the tap. The formula pins the npm tarball by full `url` (e.g. `.../prowl-tools-<version>.tgz`) plus `sha256` — there is no separate `version` field. After publishing, update those two lines: set `url` to the new tarball and `sha256` to its hash (`npm view prowl-tools@<version> dist.tarball` and `npm view prowl-tools@<version> dist.integrity`, or download the tarball and `shasum -a 256`), commit, and push the tap repo. NOTE: the formula currently points at the orphaned `1.0.0`, so `brew install` is out of sync with npm `latest` — bumping to `0.1.1` realigns them.
- **Downstream — docs/web**: per Cross-Repo Guidelines, update `prowl-docs` for new commands/step types and `prowl-web` for major feature descriptions.

## Prowl Ecosystem

**GitHub Org**: [prowl-tools](https://github.com/prowl-tools)

| Repo | Purpose | Local Path |
|------|---------|------------|
| `prowl-tools/prowl` | CLI tool (this repo) | `~/Desktop/Current Projects/Prowl/Repositories/prowl` |
| `prowl-tools/prowl-docs` | Documentation site (Docusaurus) | `~/Desktop/Current Projects/Prowl/Repositories/prowl-docs` |
| `prowl-tools/prowl-web` | Marketing landing page (Next.js) | `~/Desktop/Current Projects/Prowl/Repositories/prowl-web` |
| `prowl-tools/prowl-hub` | Community hunt templates | `~/Desktop/Current Projects/Prowl/Repositories/prowl-hub` |
| `prowltools/prowl-twitter-bot` | Twitter bot (@prowl) | `~/Desktop/Current Projects/Prowl/Repositories/prowl-twitter-bot` |

**Backlogs**: `~/Desktop/Backlogs/projects/Prowl/`
**Assets**: `~/Desktop/Current Projects/Prowl/Assets/`

### Cross-Repo Guidelines
- **This repo** is the source of truth for all CLI features and step types
- **prowl-docs** should be updated when step types, config options, or CLI commands change
- **prowl-web** is the marketing site — update feature descriptions when major features ship
- **prowl-hub** has its own CLAUDE.md with strict read-only security rules for agents

### Hunt Authoring in Other Repos
When asked to create hunts (`.prowl/` config and hunt YAML files) in another repo, create the YAML files and stop. Do NOT run `prowl ci`, `prowl run`, or any hunt execution commands. All hunts will be run by the user as an end user so they can experience the tool from a user's perspective.

## Access Policy

Infrastructure credentials and host details are not stored in this repository.
Contact ops for access through the private credentials vault.
