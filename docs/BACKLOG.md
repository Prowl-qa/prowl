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
