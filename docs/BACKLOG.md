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

### BUG-001: Nested Variable Interpolation Not Supported
**Priority**: High
**Found during**: Dispatcher login test (2026-02-06)
**Description**: Hunt `vars` that reference env vars via `{{...}}` syntax are not recursively interpolated. If a hunt defines `vars: { TEST_EMAIL: "{{DISPATCH_TEST_EMAIL}}" }` and a step uses `{{TEST_EMAIL}}`, the resolved value is the literal string `{{DISPATCH_TEST_EMAIL}}` instead of the actual env var value.
**Root cause**: `interpolateHunt` in `src/config/interpolate.ts` spreads env vars first, then hunt vars override them. Hunt var *values* are never interpolated against env vars before being added to the lookup map.
**Workaround**: Reference env vars directly in steps (e.g., `{{DISPATCH_TEST_EMAIL}}`) instead of going through intermediate hunt vars.
**Acceptance Criteria**:
- Hunt var values are interpolated against env vars before being used
- `vars: { TEST_EMAIL: "{{DISPATCH_TEST_EMAIL}}" }` followed by `{{TEST_EMAIL}}` in a step resolves to the actual env var value
- Existing behavior (direct env var references, plain string vars) is unchanged
- Unit test added covering nested interpolation

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

### FEAT-001: `selectOption` Step Type
**Priority**: High
**Found during**: Profile page hunt planning (2026-02-06)
**Description**: `<select>` dropdowns require Playwright's `selectOption()` API. The current `fill` step uses Playwright's `.fill()` which does not work on `<select>` elements, leaving dropdown interactions untestable.
**Blocked hunts**:
- Profile page: Locale and Timezone dropdowns
- Orders page: Status, Driver, and Vehicle dropdowns in the order form
**Acceptance Criteria**:
- New step type `selectOption: { selector, value }` that calls `page.locator(selector).selectOption(value)`
- Value supports `{{VAR}}` interpolation
- Schema validation added to `src/config/schema.ts`
- Step execution added to `src/runner/steps.ts`
- Unit test coverage in `test/steps.test.ts`

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
