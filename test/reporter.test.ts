import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeSummary, escapeMd } from "../src/reporter/summary.js";
import { writeResult } from "../src/reporter/result.js";
import type { RunResult } from "../src/types/index.js";

function makeResult(overrides?: Partial<RunResult>): RunResult {
  return {
    status: "pass",
    exitCode: 0,
    startedAt: "2026-02-12T00:00:00.000Z",
    durationMs: 1234,
    hunt: "sample",
    targetUrl: "http://localhost",
    steps: [{ type: "navigate", status: "pass", durationMs: 10 }],
    assertions: [{ type: "urlIncludes", value: "/", status: "pass" }],
    artifacts: { screenshots: [] },
    ...overrides
  };
}

describe("reporter", () => {
  it("writes summary and result files", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-report-"));
    try {
      const result = makeResult();

      const summaryFile = writeSummary(runDir, result);
      const resultFile = writeResult(runDir, result);

      expect(fs.existsSync(path.join(runDir, summaryFile))).toBe(true);
      expect(fs.existsSync(path.join(runDir, resultFile))).toBe(true);
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });
});

describe("writeSummary content", () => {
  it("includes status, hunt, target, and duration", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-summary-"));
    try {
      const result = makeResult({ hunt: "login-flow", targetUrl: "http://example.com", durationMs: 5000 });
      writeSummary(runDir, result);
      const content = fs.readFileSync(path.join(runDir, "summary.md"), "utf-8");

      expect(content).toContain("Status: PASS");
      expect(content).toContain("Hunt: login-flow");
      expect(content).toContain("Target: http://example.com");
      expect(content).toContain("Duration: 5000ms");
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });

  it("formats steps with status, type, and duration", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-summary-"));
    try {
      const result = makeResult({
        steps: [
          { type: "navigate", status: "pass", durationMs: 100 },
          { type: "click", status: "fail", durationMs: 50, selector: "#btn", error: "not found" }
        ]
      });
      writeSummary(runDir, result);
      const content = fs.readFileSync(path.join(runDir, "summary.md"), "utf-8");

      expect(content).toContain("- [PASS] navigate (100ms)");
      expect(content).toContain("- [FAIL] click (50ms) selector=#btn error=not found");
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });

  it("formats assertions with status and value", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-summary-"));
    try {
      const result = makeResult({
        assertions: [
          { type: "urlIncludes", value: "/dashboard", status: "pass" },
          { type: "noConsoleErrors", status: "fail", error: "3 errors found" }
        ]
      });
      writeSummary(runDir, result);
      const content = fs.readFileSync(path.join(runDir, "summary.md"), "utf-8");

      expect(content).toContain("- [PASS] urlIncludes value=/dashboard");
      expect(content).toContain("- [FAIL] noConsoleErrors error=3 errors found");
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });

  it("includes artifact paths", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-summary-"));
    try {
      const result = makeResult({
        artifacts: {
          summary: "summary.md",
          console: "console.log",
          trace: "trace.zip",
          networkHar: "network.har",
          screenshots: ["screenshots/final.png"]
        }
      });
      writeSummary(runDir, result);
      const content = fs.readFileSync(path.join(runDir, "summary.md"), "utf-8");

      expect(content).toContain("- summary: summary.md");
      expect(content).toContain("- console: console.log");
      expect(content).toContain("- trace: trace.zip");
      expect(content).toContain("- network: network.har");
      expect(content).toContain("- screenshot: screenshots/final.png");
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });

  it("handles empty steps and assertions", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-summary-"));
    try {
      const result = makeResult({ steps: [], assertions: [] });
      writeSummary(runDir, result);
      const content = fs.readFileSync(path.join(runDir, "summary.md"), "utf-8");

      expect(content).toContain("## Steps");
      expect(content).toContain("## Assertions");
      expect(content).not.toContain("- [PASS]");
      expect(content).not.toContain("- [FAIL]");
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });
});

describe("markdown escaping", () => {
  it("escapes markdown special characters in step values and errors", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-escape-"));
    try {
      const result = makeResult({
        steps: [
          { type: "fill", status: "pass", durationMs: 10, value: "user*name_test" },
          { type: "click", status: "fail", durationMs: 5, error: "Element `#btn` not [found]" }
        ]
      });
      writeSummary(runDir, result);
      const content = fs.readFileSync(path.join(runDir, "summary.md"), "utf-8");

      expect(content).toContain("value=user\\*name\\_test");
      expect(content).toContain("error=Element \\`\\#btn\\` not \\[found\\]");
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });

  it("escapeMd escapes all markdown special characters", () => {
    expect(escapeMd("|`*_{}[]()#+\\-!")).toBe("\\|\\`\\*\\_\\{\\}\\[\\]\\(\\)\\#\\+\\\\\\-\\!");
  });
});

describe("writeResult content", () => {
  it("writes valid JSON matching the RunResult structure", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-result-"));
    try {
      const result = makeResult({
        status: "fail",
        exitCode: 1,
        hunt: "checkout",
        steps: [
          { type: "navigate", status: "pass", durationMs: 10 },
          { type: "click", status: "fail", durationMs: 5, error: "timeout" }
        ],
        assertions: [{ type: "urlIncludes", value: "/done", status: "fail", error: "URL mismatch" }]
      });
      writeResult(runDir, result);
      const raw = fs.readFileSync(path.join(runDir, "result.json"), "utf-8");
      const parsed = JSON.parse(raw);

      expect(parsed.status).toBe("fail");
      expect(parsed.exitCode).toBe(1);
      expect(parsed.hunt).toBe("checkout");
      expect(parsed.steps).toHaveLength(2);
      expect(parsed.assertions).toHaveLength(1);
      expect(parsed.assertions[0].error).toBe("URL mismatch");
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });
});
