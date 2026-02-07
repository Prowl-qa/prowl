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

### FEAT-002: `setInputFiles` Step Type
**Priority**: Medium
**Found during**: Profile page hunt planning (2026-02-06)
**Description**: File upload inputs (e.g., avatar upload on the dispatcher Profile page) require Playwright's `setInputFiles()` API. Neither `fill` nor `click` can set a file on `<input type="file">` elements, leaving file upload flows untestable.
**Acceptance Criteria**:
- New step type `setInputFiles: { selector, files }` where `files` is a path (or array of paths) relative to the `.prowl/` directory
- Schema validation added to `src/config/schema.ts`
- Step execution added to `src/runner/steps.ts`
- Unit test coverage in `test/steps.test.ts`

### FEAT-003: `onDialog` Step Type (Dialog Handler)
**Priority**: High
**Found during**: Orders page hunt planning (2026-02-06)
**Description**: Delete flows in the dispatcher app use `window.confirm()` for confirmation dialogs. Playwright requires a dialog handler (`page.on('dialog')`) to be set up *before* the action that triggers the dialog. Without this, Prowl cannot test any flow that involves browser-native `alert()`, `confirm()`, or `prompt()` dialogs.
**Blocked hunts**:
- `orders-delete` hunt: Cannot be created until this feature is implemented. Delete order (single and bulk) uses `window.confirm()` which Prowl cannot interact with today.
- Without `orders-delete`, the `orders-create` hunt is not idempotent — re-running it will fail because the test order (`PROWL-TEST-001`) already exists. Implementing this feature unblocks a full create→edit→delete cycle that cleans up after itself.
**Design notes**:
- The step must be placed *before* the step that triggers the dialog (e.g., before a `click` on a delete button)
- It should set up a one-time `page.once('dialog')` listener that accepts or dismisses the dialog
- Syntax proposal: `onDialog: { action: "accept" }` or `onDialog: { action: "dismiss" }`
**Acceptance Criteria**:
- New step type `onDialog: { action }` where action is `"accept"` or `"dismiss"`
- Sets up a `page.once('dialog', ...)` listener that fires on the next dialog
- Schema validation added to `src/config/schema.ts`
- Step execution added to `src/runner/steps.ts`
- Unit test coverage in `test/steps.test.ts`

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
