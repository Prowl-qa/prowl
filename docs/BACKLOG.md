# Prowl(AI) - Product Backlog

## Phase 2: CI Integration & Automated Issue Reporting

### P2-001: `prowlai ci` Command
**Priority**: High
**Description**: Add a `ci` subcommand that runs all hunts in `.prowl/hunts/` sequentially and produces a combined pass/fail exit code. Designed for unattended execution in CI pipelines or scheduled cron jobs.
**Acceptance Criteria**:
- Runs every `.yml` hunt in the hunts directory
- Returns exit code 0 if all pass, 1 if any fail
- Outputs a combined summary report across all hunts
- Supports `--config` flag to override config path

### P2-002: GitHub Issue Creation on Failure
**Priority**: High
**Description**: When `prowlai ci` detects a failure, automatically create a GitHub issue using `gh issue create` with failure details, screenshots, and repro steps parsed from the hunt YAML and `result.json`.
**Acceptance Criteria**:
- Issue title includes hunt name and failure reason
- Issue body includes: failure summary, repro steps from hunt YAML, assertion results
- Screenshots attached or linked
- Labels applied (e.g., `prowl-regression`, `automated`)
- Deduplication: don't create a duplicate issue if one already exists for the same hunt

### P2-003: Configurable Issue Reporting
**Priority**: Medium
**Description**: Add a `reporting` section to `config.yml` that controls where and how issues are filed.
**Acceptance Criteria**:
- Config option for target repo (`reporting.github.repo`)
- Config option for labels (`reporting.github.labels`)
- Config option to enable/disable auto-issue creation (`reporting.github.enabled`)
- Config option for assignees (`reporting.github.assignees`)

---

## Bugs

*No open bugs.*

---

## Phase 3: Agent-Driven Fix Pipeline

### P3-001: GitHub Actions Workflow for Scheduled Prowl Runs
**Priority**: High
**Description**: Provide a reusable GitHub Actions workflow that runs `prowlai ci` on a schedule (e.g., nightly) or on PR events against a target application.
**Acceptance Criteria**:
- Workflow template that users can copy into their repos
- Configurable schedule (cron) and trigger events
- Prowl installed and executed within the action
- Artifacts (screenshots, reports) uploaded as workflow artifacts
- Issue creation triggered on failure

### P3-002: Claude/Codex Agent Issue Pickup
**Priority**: High
**Description**: When a `prowl-regression` labeled issue is created, trigger a Claude or Codex agent to read the issue, analyze the failure, and open a fix PR.
**Acceptance Criteria**:
- Agent triggered by issue label via GitHub Actions
- Agent reads issue body for failure context (hunt YAML, assertion results, screenshots)
- Agent checks out the repo, identifies the likely source of the failure
- Agent opens a draft PR with the proposed fix
- PR references the original issue

### P3-003: Feedback Loop - Re-run Prowl on Fix PRs
**Priority**: Medium
**Description**: When a fix PR is opened by the agent, automatically re-run the failed Prowl hunt against the PR branch to verify the fix before review.
**Acceptance Criteria**:
- GitHub Actions triggers `prowlai run <failed-hunt>` on the PR branch
- Results posted as a PR comment (pass/fail with screenshots)
- PR auto-labeled as `prowl-verified` if the hunt passes

---

## Phase 4: Step Type Expansion

*All Phase 4 items resolved.*

---

## Resolved

### ~~FEAT-001: `selectOption` Step Type~~
**Resolved**: 2026-02-06 (commit aa9188c)
**Description**: Added `selectOption: { selector, value }` step type for `<select>` dropdowns.

### ~~BUG-001: Nested Variable Interpolation Not Supported~~
**Resolved**: 2026-02-07 (commit 72fd515)
**Description**: Hunt var values referencing env vars via `{{...}}` are now pre-interpolated against env vars before merging into the lookup map. Regression test added.

### ~~BUG-002: `init` Command Path Resolution Broken After Bundling~~
**Resolved**: 2026-02-07 (commit 72fd515)
**Found during**: End-user workflow review (2026-02-07)
**Description**: `getPackageRoot()` in `src/cli/commands/init.ts` used a hardcoded `"../../../"` relative path that only worked for the source layout. After tsup bundles to `dist/index.js`, the path resolved 2 levels above the project root. Replaced with a directory walk that finds the nearest `package.json`.

### ~~BUG-003: `examples/` Not Included in npm Package~~
**Resolved**: 2026-02-07 (commit 72fd515)
**Found during**: End-user workflow review (2026-02-07)
**Description**: `package.json` `files` field only included `"dist"`, so `examples/` was excluded from `npm publish`. The `init` command copies from `examples/`, so it would fail after `npm install -g`. Added `"examples"` to the `files` array.

### ~~FEAT-002: `setInputFiles` Step Type~~
**Resolved**: 2026-02-07
**Description**: Added `setInputFiles: { selector, files }` step type for `<input type="file">` elements. Supports single file or array of paths relative to `.prowl/` directory. Unit tests added.

### ~~FEAT-003: `onDialog` Step Type (Dialog Handler)~~
**Resolved**: 2026-02-07
**Description**: Added `onDialog: { action }` step type where action is `"accept"` or `"dismiss"`. Sets up a `page.once('dialog')` listener for browser-native dialogs. Unblocks delete flow hunts and idempotent test cycles. Unit tests added.
