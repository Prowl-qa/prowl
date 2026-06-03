import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const mockRunHunt = vi.fn();
const mockLoadConfig = vi.fn();
const mockListHunts = vi.fn();
const mockLoadHuntTags = vi.fn();
const mockRunWithConcurrency = vi.fn();

vi.mock("../src/runner/index.js", () => ({
  runHunt: (...args: unknown[]) => mockRunHunt(...args)
}));

vi.mock("../src/config/loader.js", () => ({
  loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
  listHunts: (...args: unknown[]) => mockListHunts(...args),
  loadHuntTags: (...args: unknown[]) => mockLoadHuntTags(...args)
}));

vi.mock("../src/cli/output.js", () => ({
  printHuntHeader: vi.fn(),
  printStepResult: vi.fn(),
  printHuntSummary: vi.fn()
}));

vi.mock("../src/cli/mascot.js", () => ({
  resultMascot: vi.fn(() => "")
}));

vi.mock("../src/utils/concurrency.js", () => ({
  runWithConcurrency: (...args: unknown[]) => mockRunWithConcurrency(...args)
}));

import { buildCiCommand } from "../src/cli/commands/ci.js";
import { printCiSummary, writeCiResult, countCiResults, resolveCiStatus } from "../src/reporter/ci-summary.js";
import type { CiHuntResult, CiResult, RunResult } from "../src/types/index.js";

function makeRunResult(huntName: string, status: "pass" | "fail"): { result: RunResult; runDir: string } {
  return {
    result: {
      status,
      exitCode: status === "pass" ? 0 : 1,
      hunt: huntName,
      durationMs: 100,
      startedAt: new Date().toISOString(),
      targetUrl: "http://localhost:3000",
      steps: [],
      assertions: [],
      artifacts: {}
    },
    runDir: `prowl/runs/${huntName}`
  };
}

function makeFailedRunResult(huntName: string, message: string): { result: RunResult; runDir: string } {
  const run = makeRunResult(huntName, "fail");
  run.result.steps = [
    {
      type: "click",
      status: "fail",
      durationMs: 12,
      error: message
    }
  ];
  return run;
}

describe("ci command", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRunWithConcurrency.mockImplementation(
      async (tasks: Array<() => Promise<unknown>>, concurrency: number) => {
        const normalizedConcurrency =
          Number.isFinite(concurrency) && concurrency > 0
            ? Math.floor(concurrency)
            : 1;
        const results: Array<{ status: "fulfilled"; value: unknown } | { status: "rejected"; reason: unknown }> =
          new Array(tasks.length);
        let nextIndex = 0;

        async function worker() {
          while (nextIndex < tasks.length) {
            const index = nextIndex;
            nextIndex += 1;
            try {
              const value = await tasks[index]();
              results[index] = { status: "fulfilled", value };
            } catch (reason) {
              results[index] = { status: "rejected", reason };
            }
          }
        }

        const workers = Array.from(
          { length: Math.min(normalizedConcurrency, tasks.length) },
          () => worker()
        );
        await Promise.all(workers);
        return results;
      }
    );
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("runs all hunts and exits 0 when all pass", async () => {
    mockLoadConfig.mockReturnValue({ config: {}, configDir: "/tmp/.prowl" });
    mockListHunts.mockReturnValue(["homepage", "login-flow"]);
    mockRunHunt
      .mockResolvedValueOnce(makeRunResult("homepage", "pass"))
      .mockResolvedValueOnce(makeRunResult("login-flow", "pass"));

    const cmd = buildCiCommand();
    await cmd.parseAsync(["node", "prowl"]);

    expect(mockRunHunt).toHaveBeenCalledTimes(2);
    expect(process.exitCode).toBe(0);
  });

  it("exits 1 when any hunt fails", async () => {
    mockLoadConfig.mockReturnValue({ config: {}, configDir: "/tmp/.prowl" });
    mockListHunts.mockReturnValue(["homepage", "checkout"]);
    mockRunHunt
      .mockResolvedValueOnce(makeRunResult("homepage", "pass"))
      .mockResolvedValueOnce(makeRunResult("checkout", "fail"));

    const cmd = buildCiCommand();
    await cmd.parseAsync(["node", "prowl"]);

    expect(mockRunHunt).toHaveBeenCalledTimes(2);
    expect(process.exitCode).toBe(1);
  });

  it("prints warning and exits 2 when no hunts found", async () => {
    mockLoadConfig.mockReturnValue({ config: {}, configDir: "/tmp/.prowl" });
    mockListHunts.mockReturnValue([]);

    const cmd = buildCiCommand();
    await cmd.parseAsync(["node", "prowl"]);

    expect(mockRunHunt).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("No hunts found"));
    expect(process.exitCode).toBe(2);
  });

  it("exits 2 when all hunts are skipped by tag filters", async () => {
    mockLoadConfig.mockReturnValue({ config: {}, configDir: "/tmp/.prowl" });
    mockListHunts.mockReturnValue(["homepage", "login-flow"]);
    mockLoadHuntTags.mockReturnValue(["regression"]);

    const cmd = buildCiCommand();
    await cmd.parseAsync(["node", "prowl", "--include-tags", "smoke"]);

    expect(mockRunHunt).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("All hunts were skipped"));
    expect(process.exitCode).toBe(2);
  });

  it("filters hunts with --include-tags", async () => {
    mockLoadConfig.mockReturnValue({ config: {}, configDir: "/tmp/.prowl" });
    mockListHunts.mockReturnValue(["homepage", "login-flow", "checkout"]);
    mockLoadHuntTags
      .mockReturnValueOnce(["smoke"])
      .mockReturnValueOnce(["regression"])
      .mockReturnValueOnce(["smoke", "critical"]);
    mockRunHunt
      .mockResolvedValueOnce(makeRunResult("homepage", "pass"))
      .mockResolvedValueOnce(makeRunResult("checkout", "pass"));

    const cmd = buildCiCommand();
    await cmd.parseAsync(["node", "prowl", "--include-tags", "smoke"]);

    expect(mockRunHunt).toHaveBeenCalledTimes(2);
    expect(mockRunHunt).toHaveBeenCalledWith(expect.objectContaining({ huntName: "homepage" }));
    expect(mockRunHunt).toHaveBeenCalledWith(expect.objectContaining({ huntName: "checkout" }));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Skipped"));
  });

  it("rejects empty --include-tags values", async () => {
    const cmd = buildCiCommand();

    await expect(
      cmd.parseAsync(["node", "prowl", "--include-tags", " , "])
    ).rejects.toThrow("--include-tags requires at least one non-empty tag");
  });

  it("rejects empty --exclude-tags values", async () => {
    const cmd = buildCiCommand();

    await expect(
      cmd.parseAsync(["node", "prowl", "--exclude-tags", " , "])
    ).rejects.toThrow("--exclude-tags requires at least one non-empty tag");
  });

  it("filters hunts with --exclude-tags", async () => {
    mockLoadConfig.mockReturnValue({ config: {}, configDir: "/tmp/.prowl" });
    mockListHunts.mockReturnValue(["homepage", "slow-test"]);
    mockLoadHuntTags
      .mockReturnValueOnce(["smoke"])
      .mockReturnValueOnce(["slow"]);
    mockRunHunt.mockResolvedValueOnce(makeRunResult("homepage", "pass"));

    const cmd = buildCiCommand();
    await cmd.parseAsync(["node", "prowl", "--exclude-tags", "slow"]);

    expect(mockRunHunt).toHaveBeenCalledTimes(1);
    expect(mockRunHunt).toHaveBeenCalledWith(expect.objectContaining({ huntName: "homepage" }));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Skipped"));
  });

  it("filters hunts with combined --include-tags and --exclude-tags", async () => {
    mockLoadConfig.mockReturnValue({ config: {}, configDir: "/tmp/.prowl" });
    mockListHunts.mockReturnValue(["fast-smoke", "slow-smoke", "regression"]);
    mockLoadHuntTags
      .mockReturnValueOnce(["smoke", "fast"])
      .mockReturnValueOnce(["smoke", "slow"])
      .mockReturnValueOnce(["regression"]);
    mockRunHunt.mockResolvedValueOnce(makeRunResult("fast-smoke", "pass"));

    const cmd = buildCiCommand();
    await cmd.parseAsync(["node", "prowl", "--include-tags", "smoke", "--exclude-tags", "slow"]);

    // "fast-smoke" matches include (smoke) and doesn't match exclude → runs
    // "slow-smoke" matches include (smoke) but also matches exclude (slow) → skipped
    // "regression" doesn't match include (smoke) → skipped
    expect(mockRunHunt).toHaveBeenCalledTimes(1);
    expect(mockRunHunt).toHaveBeenCalledWith(expect.objectContaining({ huntName: "fast-smoke" }));
  });

  it("continues running remaining hunts when one throws", async () => {
    mockLoadConfig.mockReturnValue({ config: {}, configDir: "/tmp/.prowl" });
    mockListHunts.mockReturnValue(["homepage", "broken", "login-flow"]);
    mockRunHunt
      .mockResolvedValueOnce(makeRunResult("homepage", "pass"))
      .mockRejectedValueOnce(new Error("Hunt file not found"))
      .mockResolvedValueOnce(makeRunResult("login-flow", "pass"));

    const cmd = buildCiCommand();
    await cmd.parseAsync(["node", "prowl"]);

    expect(mockRunHunt).toHaveBeenCalledTimes(3);
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Hunt file not found"));
  });

  it("passes --config flag through to loadConfig", async () => {
    mockLoadConfig.mockReturnValue({ config: {}, configDir: "/tmp/custom/.prowl" });
    mockListHunts.mockReturnValue(["homepage"]);
    mockRunHunt.mockResolvedValueOnce(makeRunResult("homepage", "pass"));

    const cmd = buildCiCommand();
    await cmd.parseAsync(["node", "prowl", "--config", "/tmp/custom/.prowl/config.yml"]);

    expect(mockLoadConfig).toHaveBeenCalledWith("/tmp/custom/.prowl/config.yml");
    expect(mockRunHunt).toHaveBeenCalledWith(
      expect.objectContaining({ configPath: "/tmp/custom/.prowl/config.yml" })
    );
  });

  it("passes --url override to each runHunt call", async () => {
    mockLoadConfig.mockReturnValue({ config: {}, configDir: "/tmp/.prowl" });
    mockListHunts.mockReturnValue(["homepage", "login-flow"]);
    mockRunHunt
      .mockResolvedValueOnce(makeRunResult("homepage", "pass"))
      .mockResolvedValueOnce(makeRunResult("login-flow", "pass"));

    const cmd = buildCiCommand();
    await cmd.parseAsync(["node", "prowl", "--url", "http://staging.example.com"]);

    for (const call of mockRunHunt.mock.calls) {
      expect(call[0]).toMatchObject({ urlOverride: "http://staging.example.com" });
    }
  });

  it("passes --browser flag to each runHunt call", async () => {
    mockLoadConfig.mockReturnValue({ config: {}, configDir: "/tmp/.prowl" });
    mockListHunts.mockReturnValue(["homepage"]);
    mockRunHunt.mockResolvedValueOnce(makeRunResult("homepage", "pass"));

    const cmd = buildCiCommand();
    await cmd.parseAsync(["node", "prowl", "--browser", "firefox"]);

    expect(mockRunHunt).toHaveBeenCalledWith(
      expect.objectContaining({ browser: "firefox" })
    );
  });

  it("passes --channel flag to each runHunt call", async () => {
    mockLoadConfig.mockReturnValue({ config: {}, configDir: "/tmp/.prowl" });
    mockListHunts.mockReturnValue(["homepage"]);
    mockRunHunt.mockResolvedValueOnce(makeRunResult("homepage", "pass"));

    const cmd = buildCiCommand();
    await cmd.parseAsync(["node", "prowl", "--channel", "chrome"]);

    expect(mockRunHunt).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "chrome" })
    );
  });

  it("passes --viewport flag to each runHunt call", async () => {
    mockLoadConfig.mockReturnValue({ config: {}, configDir: "/tmp/.prowl" });
    mockListHunts.mockReturnValue(["homepage"]);
    mockRunHunt.mockResolvedValueOnce(makeRunResult("homepage", "pass"));

    const cmd = buildCiCommand();
    await cmd.parseAsync(["node", "prowl", "--viewport", "1920x1080"]);

    expect(mockRunHunt).toHaveBeenCalledWith(
      expect.objectContaining({ viewport: "1920x1080" })
    );
  });

  it("passes --junit flag to each runHunt call", async () => {
    mockLoadConfig.mockReturnValue({ config: {}, configDir: "/tmp/.prowl" });
    mockListHunts.mockReturnValue(["homepage", "login-flow"]);
    mockRunHunt
      .mockResolvedValueOnce(makeRunResult("homepage", "pass"))
      .mockResolvedValueOnce(makeRunResult("login-flow", "pass"));

    const cmd = buildCiCommand();
    await cmd.parseAsync(["node", "prowl", "--junit"]);

    for (const call of mockRunHunt.mock.calls) {
      expect(call[0]).toMatchObject({ junit: true });
    }
  });

  it("outputs valid JSON with --json flag", async () => {
    mockLoadConfig.mockReturnValue({ config: {}, configDir: "/tmp/.prowl" });
    mockListHunts.mockReturnValue(["homepage", "login-flow"]);
    mockRunHunt
      .mockResolvedValueOnce(makeRunResult("homepage", "pass"))
      .mockResolvedValueOnce(makeRunResult("login-flow", "pass"));

    const cmd = buildCiCommand();
    await cmd.parseAsync(["node", "prowl", "--json"]);

    // Find the JSON output call (the one with valid JSON)
    const jsonCall = logSpy.mock.calls.find((call) => {
      try { JSON.parse(call[0]); return true; } catch { return false; }
    });
    expect(jsonCall).toBeDefined();

    const parsed: CiResult = JSON.parse(jsonCall![0]);
    expect(parsed.status).toBe("pass");
    expect(parsed.totalHunts).toBe(2);
    expect(parsed.passed).toBe(2);
    expect(parsed.failed).toBe(0);
    expect(parsed.hunts).toHaveLength(2);
    expect(parsed.hunts[0]).toMatchObject({ hunt: "homepage", status: "pass" });
    expect(parsed.hunts[1]).toMatchObject({ hunt: "login-flow", status: "pass" });
  });

  it("outputs JSON with no-hunts status when no hunts found with --json", async () => {
    mockLoadConfig.mockReturnValue({ config: {}, configDir: "/tmp/.prowl" });
    mockListHunts.mockReturnValue([]);

    const cmd = buildCiCommand();
    await cmd.parseAsync(["node", "prowl", "--json"]);

    const jsonCall = logSpy.mock.calls.find((call) => {
      try { JSON.parse(call[0]); return true; } catch { return false; }
    });
    expect(jsonCall).toBeDefined();

    const parsed: CiResult = JSON.parse(jsonCall![0]);
    expect(parsed.status).toBe("no-hunts");
    expect(parsed.totalHunts).toBe(0);
    expect(process.exitCode).toBe(2);
  });

  it("runs hunts in parallel with --parallel", async () => {
    mockLoadConfig.mockReturnValue({ config: {}, configDir: "/tmp/.prowl" });
    mockListHunts.mockReturnValue(["homepage", "login-flow", "checkout"]);
    mockRunHunt
      .mockResolvedValueOnce(makeRunResult("homepage", "pass"))
      .mockResolvedValueOnce(makeRunResult("login-flow", "pass"))
      .mockResolvedValueOnce(makeRunResult("checkout", "pass"));

    const cmd = buildCiCommand();
    await cmd.parseAsync(["node", "prowl", "--parallel", "2"]);

    expect(mockRunHunt).toHaveBeenCalledTimes(3);
    expect(process.exitCode).toBe(0);
  });

  it("--parallel 1 is identical to default sequential", async () => {
    mockLoadConfig.mockReturnValue({ config: {}, configDir: "/tmp/.prowl" });
    mockListHunts.mockReturnValue(["homepage"]);
    mockRunHunt.mockResolvedValueOnce(makeRunResult("homepage", "pass"));

    const cmd = buildCiCommand();
    await cmd.parseAsync(["node", "prowl", "--parallel", "1"]);

    expect(mockRunHunt).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(0);
  });

  it("parallel mode suppresses per-step output", async () => {
    mockLoadConfig.mockReturnValue({ config: {}, configDir: "/tmp/.prowl" });
    mockListHunts.mockReturnValue(["homepage", "login-flow"]);
    mockRunHunt
      .mockResolvedValueOnce(makeRunResult("homepage", "pass"))
      .mockResolvedValueOnce(makeRunResult("login-flow", "pass"));

    const cmd = buildCiCommand();
    await cmd.parseAsync(["node", "prowl", "--parallel", "2"]);

    // Parallel mode passes undefined for onStep
    for (const call of mockRunHunt.mock.calls) {
      expect(call[0].onStep).toBeUndefined();
    }
  });

  it("prints failure reasons after a parallel run", async () => {
    mockLoadConfig.mockReturnValue({ config: {}, configDir: "/tmp/.prowl" });
    mockListHunts.mockReturnValue(["homepage", "checkout"]);
    mockRunHunt
      .mockResolvedValueOnce(makeRunResult("homepage", "pass"))
      .mockRejectedValueOnce(new Error("checkout timed out"));

    const cmd = buildCiCommand();
    await cmd.parseAsync(["node", "prowl", "--parallel", "2"]);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("checkout timed out"));
    expect(process.exitCode).toBe(1);
  });

  it("prints returned failure details after a parallel run", async () => {
    mockLoadConfig.mockReturnValue({ config: {}, configDir: "/tmp/.prowl" });
    mockListHunts.mockReturnValue(["checkout"]);
    mockRunHunt.mockResolvedValueOnce(makeFailedRunResult("checkout", "button was not visible"));

    const cmd = buildCiCommand();
    await cmd.parseAsync(["node", "prowl", "--parallel", "2"]);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("button was not visible"));
    expect(process.exitCode).toBe(1);
  });

  it("rejects --parallel 0", async () => {
    const cmd = buildCiCommand();
    await expect(
      cmd.parseAsync(["node", "prowl", "--parallel", "0"])
    ).rejects.toThrow("--parallel must be a positive integer");
  });

  it("rejects non-integer --parallel values", async () => {
    const cmd = buildCiCommand();
    await expect(
      cmd.parseAsync(["node", "prowl", "--parallel", "1.5"])
    ).rejects.toThrow("--parallel must be a positive integer");
  });

  it("preserves hunt name when a parallel task is rejected", async () => {
    mockLoadConfig.mockReturnValue({ config: {}, configDir: "/tmp/.prowl" });
    mockListHunts.mockReturnValue(["homepage"]);
    mockRunWithConcurrency.mockResolvedValueOnce([
      { status: "rejected", reason: new Error("Task crashed") }
    ]);

    const cmd = buildCiCommand();
    await cmd.parseAsync(["node", "prowl", "--parallel", "2", "--json"]);

    const jsonCall = logSpy.mock.calls.find((call) => {
      try { JSON.parse(call[0]); return true; } catch { return false; }
    });
    expect(jsonCall).toBeDefined();
    const parsed: CiResult = JSON.parse(jsonCall![0]);
    expect(parsed.hunts[0]).toMatchObject({
      hunt: "homepage",
      status: "fail",
      error: "Task crashed"
    });
  });

  it("suppresses formatted output with --json flag", async () => {
    const { printHuntHeader, printStepResult, printHuntSummary } = await import("../src/cli/output.js");
    const { resultMascot } = await import("../src/cli/mascot.js");

    mockLoadConfig.mockReturnValue({ config: {}, configDir: "/tmp/.prowl" });
    mockListHunts.mockReturnValue(["homepage"]);
    mockRunHunt.mockResolvedValueOnce(makeRunResult("homepage", "pass"));

    const cmd = buildCiCommand();
    await cmd.parseAsync(["node", "prowl", "--json"]);

    expect(printHuntHeader).not.toHaveBeenCalled();
    expect(printStepResult).not.toHaveBeenCalled();
    expect(printHuntSummary).not.toHaveBeenCalled();
    expect(resultMascot).not.toHaveBeenCalled();
  });
});

describe("countCiResults", () => {
  it("counts pass, fail, and skipped results", () => {
    const results: CiHuntResult[] = [
      { hunt: "a", status: "pass", durationMs: 100 },
      { hunt: "b", status: "fail", durationMs: 200 },
      { hunt: "c", status: "skipped", durationMs: 0 },
      { hunt: "d", status: "pass", durationMs: 150 }
    ];
    const counts = countCiResults(results);
    expect(counts).toEqual({ passed: 2, failed: 1, skipped: 1 });
  });

  it("returns zeros for empty results", () => {
    expect(countCiResults([])).toEqual({ passed: 0, failed: 0, skipped: 0 });
  });
});

describe("resolveCiStatus", () => {
  it("returns 'no-hunts' for empty results", () => {
    expect(resolveCiStatus([])).toBe("no-hunts");
  });

  it("returns 'fail' when any hunt fails", () => {
    const results: CiHuntResult[] = [
      { hunt: "a", status: "pass", durationMs: 100 },
      { hunt: "b", status: "fail", durationMs: 200 }
    ];
    expect(resolveCiStatus(results)).toBe("fail");
  });

  it("returns 'pass' when all hunts pass", () => {
    const results: CiHuntResult[] = [
      { hunt: "a", status: "pass", durationMs: 100 },
      { hunt: "b", status: "pass", durationMs: 200 }
    ];
    expect(resolveCiStatus(results)).toBe("pass");
  });

  it("returns 'pass' when mix of pass and skipped", () => {
    const results: CiHuntResult[] = [
      { hunt: "a", status: "pass", durationMs: 100 },
      { hunt: "b", status: "skipped", durationMs: 0 }
    ];
    expect(resolveCiStatus(results)).toBe("pass");
  });

  it("returns 'all-skipped' when every hunt is skipped", () => {
    const results: CiHuntResult[] = [
      { hunt: "a", status: "skipped", durationMs: 0 },
      { hunt: "b", status: "skipped", durationMs: 0 }
    ];
    expect(resolveCiStatus(results)).toBe("all-skipped");
  });
});

describe("printCiSummary", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints pass/fail/skip counts", () => {
    const results: CiHuntResult[] = [
      { hunt: "homepage", status: "pass", durationMs: 320 },
      { hunt: "login-flow", status: "pass", durationMs: 1240 },
      { hunt: "checkout", status: "fail", durationMs: 890 },
      { hunt: "admin", status: "skipped", durationMs: 0 }
    ];

    printCiSummary(results, 2450);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("CI Summary");
    expect(output).toContain("homepage");
    expect(output).toContain("checkout");
    expect(output).toContain("2 passed");
    expect(output).toContain("1 failed");
    expect(output).toContain("1 skipped");
  });
});

describe("writeCiResult", () => {
  it("writes ci-result.json with correct structure", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-ci-test-"));
    const ciRunDir = path.join(tmpDir, "ci-run");

    const results: CiHuntResult[] = [
      { hunt: "homepage", status: "pass", durationMs: 320, runDir: "/tmp/runs/1" },
      { hunt: "checkout", status: "fail", durationMs: 890, error: "assertion failed" },
      { hunt: "admin", status: "skipped", durationMs: 0 }
    ];

    const filePath = writeCiResult(ciRunDir, results, "2026-02-15T10:30:45.000Z", 1210);

    expect(fs.existsSync(filePath)).toBe(true);

    const content: CiResult = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(content.status).toBe("fail");
    expect(content.startedAt).toBe("2026-02-15T10:30:45.000Z");
    expect(content.durationMs).toBe(1210);
    expect(content.totalHunts).toBe(3);
    expect(content.passed).toBe(1);
    expect(content.failed).toBe(1);
    expect(content.skipped).toBe(1);
    expect(content.hunts).toHaveLength(3);
    expect(content.hunts[0]).toMatchObject({ hunt: "homepage", status: "pass" });
    expect(content.hunts[1]).toMatchObject({ hunt: "checkout", status: "fail", error: "assertion failed" });
    expect(content.hunts[2]).toMatchObject({ hunt: "admin", status: "skipped" });

    fs.rmSync(tmpDir, { recursive: true });
  });

  it("writes pass status when all hunts pass", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-ci-test-"));
    const ciRunDir = path.join(tmpDir, "ci-run");

    const results: CiHuntResult[] = [
      { hunt: "homepage", status: "pass", durationMs: 320 }
    ];

    const filePath = writeCiResult(ciRunDir, results, "2026-02-15T10:30:45.000Z", 320);

    const content: CiResult = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(content.status).toBe("pass");
    expect(content.passed).toBe(1);
    expect(content.failed).toBe(0);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it("writes all-skipped status when every hunt is skipped", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-ci-test-"));
    const ciRunDir = path.join(tmpDir, "ci-run");

    const results: CiHuntResult[] = [
      { hunt: "homepage", status: "skipped", durationMs: 0 },
      { hunt: "login", status: "skipped", durationMs: 0 }
    ];

    const filePath = writeCiResult(ciRunDir, results, "2026-02-15T10:30:45.000Z", 50);

    const content: CiResult = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(content.status).toBe("all-skipped");
    expect(content.passed).toBe(0);
    expect(content.skipped).toBe(2);

    fs.rmSync(tmpDir, { recursive: true });
  });
});
