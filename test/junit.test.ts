import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeJunit, escapeXml } from "../src/reporter/junit.js";
import type { RunResult } from "../src/types/index.js";

function makeResult(overrides?: Partial<RunResult>): RunResult {
  return {
    status: "pass",
    exitCode: 0,
    startedAt: "2026-02-15T10:00:00.000Z",
    durationMs: 1234,
    hunt: "homepage",
    targetUrl: "http://localhost",
    steps: [{ type: "navigate", status: "pass", durationMs: 200 }],
    assertions: [{ type: "urlIncludes", value: "/", status: "pass" }],
    artifacts: { screenshots: [] },
    ...overrides
  };
}

describe("writeJunit", () => {
  it("writes junit.xml file to run directory", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-junit-"));
    try {
      const result = makeResult();
      const fileName = writeJunit(runDir, result);

      expect(fileName).toBe("junit.xml");
      expect(fs.existsSync(path.join(runDir, "junit.xml"))).toBe(true);
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });

  it("produces valid XML structure", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-junit-"));
    try {
      const result = makeResult();
      writeJunit(runDir, result);
      const content = fs.readFileSync(path.join(runDir, "junit.xml"), "utf-8");

      expect(content).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(content).toContain("<testsuites>");
      expect(content).toContain("</testsuites>");
      expect(content).toContain("<testsuite ");
      expect(content).toContain("</testsuite>");
      expect(content).toContain("<testcase ");
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });

  it("maps steps to testcases with correct names", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-junit-"));
    try {
      const result = makeResult({
        steps: [
          { type: "navigate", status: "pass", durationMs: 200 },
          { type: "click", status: "pass", durationMs: 50 }
        ]
      });
      writeJunit(runDir, result);
      const content = fs.readFileSync(path.join(runDir, "junit.xml"), "utf-8");

      expect(content).toContain('name="step 1: navigate"');
      expect(content).toContain('name="step 2: click"');
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });

  it("maps assertions to testcases", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-junit-"));
    try {
      const result = makeResult({
        assertions: [
          { type: "urlIncludes", value: "/dashboard", status: "pass" },
          { type: "noConsoleErrors", status: "pass" }
        ]
      });
      writeJunit(runDir, result);
      const content = fs.readFileSync(path.join(runDir, "junit.xml"), "utf-8");

      expect(content).toContain('name="assertion: urlIncludes"');
      expect(content).toContain('name="assertion: noConsoleErrors"');
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });

  it("includes failure elements for failed steps", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-junit-"));
    try {
      const result = makeResult({
        status: "fail",
        exitCode: 1,
        steps: [
          { type: "navigate", status: "pass", durationMs: 200 },
          { type: "click", status: "fail", durationMs: 50, error: "Element not found" }
        ]
      });
      writeJunit(runDir, result);
      const content = fs.readFileSync(path.join(runDir, "junit.xml"), "utf-8");

      expect(content).toContain('<failure message="Element not found" type="step">Element not found</failure>');
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });

  it("includes failure elements for failed assertions", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-junit-"));
    try {
      const result = makeResult({
        status: "fail",
        exitCode: 1,
        assertions: [
          { type: "urlIncludes", value: "/dashboard", status: "fail", error: "URL mismatch" }
        ]
      });
      writeJunit(runDir, result);
      const content = fs.readFileSync(path.join(runDir, "junit.xml"), "utf-8");

      expect(content).toContain('<failure message="URL mismatch" type="assertion">URL mismatch</failure>');
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });

  it("computes correct tests, failures, and time attributes", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-junit-"));
    try {
      const result = makeResult({
        status: "fail",
        exitCode: 1,
        durationMs: 1500,
        steps: [
          { type: "navigate", status: "pass", durationMs: 200 },
          { type: "click", status: "fail", durationMs: 50, error: "timeout" }
        ],
        assertions: [
          { type: "urlIncludes", value: "/", status: "pass" },
          { type: "noConsoleErrors", status: "fail", error: "3 errors" }
        ]
      });
      writeJunit(runDir, result);
      const content = fs.readFileSync(path.join(runDir, "junit.xml"), "utf-8");

      expect(content).toContain('tests="4"');
      expect(content).toContain('failures="2"');
      expect(content).toContain('errors="0"');
      expect(content).toContain('time="1.500"');
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });

  it("escapes XML special characters in error messages", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-junit-"));
    try {
      const result = makeResult({
        status: "fail",
        exitCode: 1,
        steps: [
          { type: "click", status: "fail", durationMs: 50, error: 'Expected <div class="foo"> & "bar"' }
        ]
      });
      writeJunit(runDir, result);
      const content = fs.readFileSync(path.join(runDir, "junit.xml"), "utf-8");

      expect(content).toContain("&amp;");
      expect(content).toContain("&lt;");
      expect(content).toContain("&gt;");
      expect(content).toContain("&quot;");
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });

  it("handles empty steps and assertions gracefully", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-junit-"));
    try {
      const result = makeResult({ steps: [], assertions: [] });
      writeJunit(runDir, result);
      const content = fs.readFileSync(path.join(runDir, "junit.xml"), "utf-8");

      expect(content).toContain('tests="0"');
      expect(content).toContain('failures="0"');
      expect(content).not.toContain("<testcase");
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });
});

describe("escapeXml", () => {
  it("escapes all XML special characters", () => {
    expect(escapeXml('&<>"\'test')).toBe("&amp;&lt;&gt;&quot;&apos;test");
  });

  it("returns plain text unchanged", () => {
    expect(escapeXml("hello world")).toBe("hello world");
  });
});
