import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { computeFingerprint, normalizeError, stepLabel, buildMarker, type BugFailure } from "../src/backlog/fingerprint.js";
import { extractFingerprints, nextTicketId, classifyFingerprint } from "../src/backlog/parse.js";
import { renderTicket, insertTickets, SECTION_HEADING } from "../src/backlog/write.js";
import { updateBacklogFromSuite } from "../src/backlog/index.js";
import type { CiHuntResult, RunResult } from "../src/types/index.js";
import type { RunSuiteResult } from "../src/runner/suite.js";

const baseFailure: BugFailure = {
  hunt: "auth/login",
  stepIndex: 4,
  stepType: "click",
  selector: "#submit",
  error: "Timeout 5000ms waiting for #submit"
};

describe("fingerprint", () => {
  it("is stable for the same failure across volatile error details", () => {
    const a = computeFingerprint(baseFailure);
    const b = computeFingerprint({ ...baseFailure, error: "Timeout 9000ms waiting for #submit" });
    expect(a).toBe(b);
  });

  it("changes when the failing selector or step type changes", () => {
    expect(computeFingerprint(baseFailure)).not.toBe(
      computeFingerprint({ ...baseFailure, selector: "#login" })
    );
    expect(computeFingerprint(baseFailure)).not.toBe(
      computeFingerprint({ ...baseFailure, stepType: "fill" })
    );
  });

  it("ignores the step index so reordering steps keeps the same fingerprint", () => {
    expect(computeFingerprint(baseFailure)).toBe(
      computeFingerprint({ ...baseFailure, stepIndex: 9 })
    );
  });

  it("normalizes volatile numbers and units", () => {
    expect(normalizeError("Timeout 5000ms at 12.5px")).toBe(normalizeError("Timeout 9000ms at 3px"));
  });

  it("builds a human-readable marker", () => {
    const fp = computeFingerprint(baseFailure);
    expect(buildMarker(baseFailure, fp)).toBe(`<!-- prowl:fp=${fp} hunt=auth/login step=4:click@#submit -->`);
  });

  it("labels stepless failures with a dash", () => {
    expect(stepLabel({ hunt: "x", error: "boom" })).toBe("-");
  });
});

describe("parse", () => {
  const active = [
    "## QA Findings (automated)",
    "",
    "### QA-005: auth/login — click (#submit)",
    "<!-- prowl:fp=aaaa1111 hunt=auth/login step=4:click@#submit -->",
    "**Error**: boom"
  ].join("\n");

  const resolved = [
    "# Resolved",
    "",
    "### ~~QA-002: checkout — fill~~",
    "<!-- prowl:fp=bbbb2222 hunt=checkout step=1:fill@#card -->"
  ].join("\n");

  it("maps fingerprints to their ticket ids", () => {
    expect(extractFingerprints(active).get("aaaa1111")).toBe("QA-005");
    expect(extractFingerprints(resolved).get("bbbb2222")).toBe("QA-002");
  });

  it("computes the next id as max + 1 across files", () => {
    expect(nextTicketId([active, resolved])).toBe("QA-006");
    expect(nextTicketId(["no ids here"])).toBe("QA-001");
  });

  it("classifies open, regression, and new fingerprints", () => {
    const activeFps = extractFingerprints(active);
    const resolvedFps = extractFingerprints(resolved);
    expect(classifyFingerprint("aaaa1111", activeFps, resolvedFps)).toEqual({ kind: "open", ticketId: "QA-005" });
    expect(classifyFingerprint("bbbb2222", activeFps, resolvedFps)).toEqual({ kind: "regression", resolvedId: "QA-002" });
    expect(classifyFingerprint("cccc3333", activeFps, resolvedFps)).toEqual({ kind: "new" });
  });
});

describe("write", () => {
  it("renders a ticket with marker, error, and regression reference", () => {
    const ticket = renderTicket({
      id: "QA-007",
      failure: baseFailure,
      marker: buildMarker(baseFailure, "deadbeef"),
      regressionOf: "QA-002",
      date: "2026-05-25"
    });
    expect(ticket).toContain("### QA-007: auth/login — click (#submit)");
    expect(ticket).toContain("prowl:fp=deadbeef");
    expect(ticket).toContain("**Regression of**: QA-002");
    expect(ticket).toContain("**Error**: Timeout 5000ms waiting for #submit");
  });

  it("creates the section when missing", () => {
    const out = insertTickets("", ["### QA-001: x\nbody"]);
    expect(out).toBe(`${SECTION_HEADING}\n\n### QA-001: x\nbody\n`);
  });

  it("inserts before a following section when the agent section already exists", () => {
    const content = [
      `${SECTION_HEADING}`,
      "",
      "### QA-001: existing",
      "",
      "## Completed",
      "",
      "- done"
    ].join("\n");
    const out = insertTickets(content, ["### QA-002: new"]);
    expect(out.indexOf("### QA-002: new")).toBeLessThan(out.indexOf("## Completed"));
    expect(out.indexOf("### QA-001: existing")).toBeLessThan(out.indexOf("### QA-002: new"));
  });
});

describe("updateBacklogFromSuite", () => {
  let tmpDir: string;
  let backlogPath: string;
  let resolvedPath: string;

  function writeRunResult(runDir: string, hunt: string, step: { type: string; selector?: string; error: string }): void {
    fs.mkdirSync(runDir, { recursive: true });
    const run: RunResult = {
      status: "fail",
      exitCode: 1,
      startedAt: new Date().toISOString(),
      durationMs: 50,
      hunt,
      targetUrl: "http://localhost:3000",
      steps: [
        { type: "navigate", status: "pass", durationMs: 10 },
        { type: step.type, status: "fail", durationMs: 20, selector: step.selector, error: step.error }
      ],
      assertions: [],
      artifacts: {}
    };
    fs.writeFileSync(path.join(runDir, "result.json"), JSON.stringify(run));
  }

  function makeSuiteResult(hunts: CiHuntResult[]): RunSuiteResult {
    return {
      result: {
        status: "fail",
        startedAt: new Date().toISOString(),
        durationMs: 100,
        totalHunts: hunts.length,
        passed: hunts.filter((h) => h.status === "pass").length,
        failed: hunts.filter((h) => h.status === "fail").length,
        skipped: hunts.filter((h) => h.status === "skipped").length,
        hunts
      },
      resultPath: path.join(tmpDir, "runs", "ci-x", "ci-result.json")
    };
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-backlog-test-"));
    backlogPath = path.join(tmpDir, "docs", "backlog.md");
    resolvedPath = path.join(tmpDir, "docs", "resolved.md");
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    fs.writeFileSync(backlogPath, "# Backlog\n\n## High Priority\n\n## Completed\n");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates a new ticket for a fresh failure and is idempotent on re-run", () => {
    const runDir = path.join(tmpDir, "runs", "login");
    writeRunResult(runDir, "auth/login", { type: "click", selector: "#submit", error: "Timeout 5000ms" });
    const suite = makeSuiteResult([{ hunt: "auth/login", status: "fail", durationMs: 50, runDir, error: "Timeout 5000ms" }]);

    const first = updateBacklogFromSuite(suite, { backlogPath, resolvedPath, date: "2026-05-25" });
    expect(first.created).toEqual(["QA-001"]);
    const afterFirst = fs.readFileSync(backlogPath, "utf-8");
    expect(afterFirst).toContain(SECTION_HEADING);
    expect(afterFirst).toContain("### QA-001: auth/login — click (#submit)");
    expect(afterFirst).toContain("prowl:fp=");

    const second = updateBacklogFromSuite(suite, { backlogPath, resolvedPath, date: "2026-05-25" });
    expect(second.created).toEqual([]);
    expect(second.skipped).toEqual(["QA-001"]);
    // No duplicate ticket written.
    expect(fs.readFileSync(backlogPath, "utf-8").match(/### QA-/g)).toHaveLength(1);
  });

  it("logs a regression that references the resolved ticket id", () => {
    const runDir = path.join(tmpDir, "runs", "login");
    writeRunResult(runDir, "auth/login", { type: "click", selector: "#submit", error: "Timeout 5000ms" });
    const huntResult: CiHuntResult = { hunt: "auth/login", status: "fail", durationMs: 50, runDir, error: "Timeout 5000ms" };

    // Pre-seed resolved.md with a ticket carrying the same fingerprint.
    const fp = computeFingerprint({ hunt: "auth/login", stepIndex: 1, stepType: "click", selector: "#submit", error: "Timeout 5000ms" });
    fs.writeFileSync(
      resolvedPath,
      `# Resolved\n\n### ~~QA-009: auth/login — click~~\n<!-- prowl:fp=${fp} hunt=auth/login step=1:click@#submit -->\n`
    );

    const summary = updateBacklogFromSuite(makeSuiteResult([huntResult]), { backlogPath, resolvedPath, date: "2026-05-25" });
    expect(summary.regressions).toEqual(["QA-010"]);
    expect(summary.created).toEqual([]);
    const backlog = fs.readFileSync(backlogPath, "utf-8");
    expect(backlog).toContain("### QA-010: auth/login — click (#submit)");
    expect(backlog).toContain("**Regression of**: QA-009");
  });

  it("writes nothing when there are no failures", () => {
    const before = fs.readFileSync(backlogPath, "utf-8");
    const summary = updateBacklogFromSuite(makeSuiteResult([{ hunt: "homepage", status: "pass", durationMs: 30 }]), {
      backlogPath,
      resolvedPath
    });
    expect(summary.created).toEqual([]);
    expect(fs.readFileSync(backlogPath, "utf-8")).toBe(before);
  });

  it("falls back to the error message when a hunt threw without a runDir", () => {
    const suite = makeSuiteResult([{ hunt: "broken", status: "fail", durationMs: 0, error: "Hunt file not found" }]);
    const summary = updateBacklogFromSuite(suite, { backlogPath, resolvedPath, date: "2026-05-25" });
    expect(summary.created).toEqual(["QA-001"]);
    const backlog = fs.readFileSync(backlogPath, "utf-8");
    expect(backlog).toContain("### QA-001: broken — run failed before steps executed");
    expect(backlog).toContain("**Error**: Hunt file not found");
  });
});
