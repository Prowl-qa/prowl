import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeSummary } from "../src/reporter/summary.js";
import { writeResult } from "../src/reporter/result.js";
import type { RunResult } from "../src/types/index.js";

describe("reporter", () => {
  it("writes summary and result files", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-report-"));
    try {
      const result: RunResult = {
        status: "pass",
        exitCode: 0,
        startedAt: new Date().toISOString(),
        durationMs: 1234,
        goal: "sample",
        targetUrl: "http://localhost",
        steps: [{ type: "navigate", status: "pass", durationMs: 10 }],
        assertions: [{ type: "urlIncludes", value: "/", status: "pass" }],
        artifacts: { screenshots: [] }
      };

      const summaryFile = writeSummary(runDir, result);
      const resultFile = writeResult(runDir, result);

      expect(fs.existsSync(path.join(runDir, summaryFile))).toBe(true);
      expect(fs.existsSync(path.join(runDir, resultFile))).toBe(true);
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });
});
