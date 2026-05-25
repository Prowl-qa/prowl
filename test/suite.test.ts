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

vi.mock("../src/utils/concurrency.js", () => ({
  runWithConcurrency: (...args: unknown[]) => mockRunWithConcurrency(...args)
}));

import { runSuite } from "../src/runner/suite.js";
import type { CiResult, RunResult } from "../src/types/index.js";

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
    runDir: `prowlqa/runs/${huntName}`
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

describe("runSuite", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-suite-test-"));
    mockLoadConfig.mockReturnValue({ config: {}, configDir: tmpDir });
    mockRunWithConcurrency.mockImplementation(
      async (tasks: Array<() => Promise<unknown>>) => {
        const results: Array<{ status: "fulfilled"; value: unknown } | { status: "rejected"; reason: unknown }> = [];
        for (const task of tasks) {
          try {
            results.push({ status: "fulfilled", value: await task() });
          } catch (reason) {
            results.push({ status: "rejected", reason });
          }
        }
        return results;
      }
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("runs hunts sequentially in listHunts order and returns a pass CiResult", async () => {
    mockListHunts.mockReturnValue(["a", "b", "c"]);
    mockRunHunt
      .mockResolvedValueOnce(makeRunResult("a", "pass"))
      .mockResolvedValueOnce(makeRunResult("b", "pass"))
      .mockResolvedValueOnce(makeRunResult("c", "pass"));

    const { result, resultPath } = await runSuite({});

    expect(mockRunHunt.mock.calls.map((c) => (c[0] as { huntName: string }).huntName)).toEqual(["a", "b", "c"]);
    expect(result.status).toBe("pass");
    expect(result.totalHunts).toBe(3);
    expect(result.passed).toBe(3);
    expect(result.hunts.map((h) => h.hunt)).toEqual(["a", "b", "c"]);
    expect(resultPath).not.toBeNull();
    const onDisk: CiResult = JSON.parse(fs.readFileSync(resultPath!, "utf-8"));
    expect(onDisk.status).toBe("pass");
  });

  it("reports fail status and keeps running after a hunt throws", async () => {
    mockListHunts.mockReturnValue(["a", "broken", "c"]);
    mockRunHunt
      .mockResolvedValueOnce(makeRunResult("a", "pass"))
      .mockRejectedValueOnce(new Error("Hunt file not found"))
      .mockResolvedValueOnce(makeRunResult("c", "pass"));

    const { result } = await runSuite({});

    expect(mockRunHunt).toHaveBeenCalledTimes(3);
    expect(result.status).toBe("fail");
    expect(result.failed).toBe(1);
    expect(result.hunts[1]).toMatchObject({ hunt: "broken", status: "fail", error: "Hunt file not found" });
  });

  it("returns no-hunts status with a null resultPath and never runs hunts", async () => {
    mockListHunts.mockReturnValue([]);

    const { result, resultPath } = await runSuite({});

    expect(mockRunHunt).not.toHaveBeenCalled();
    expect(result.status).toBe("no-hunts");
    expect(result.totalHunts).toBe(0);
    expect(resultPath).toBeNull();
  });

  it("filters hunts by include/exclude tags and records skips", async () => {
    mockListHunts.mockReturnValue(["smoke-1", "regression-1", "slow-smoke"]);
    mockLoadHuntTags
      .mockReturnValueOnce(["smoke"])
      .mockReturnValueOnce(["regression"])
      .mockReturnValueOnce(["smoke", "slow"]);
    mockRunHunt.mockResolvedValueOnce(makeRunResult("smoke-1", "pass"));

    const skipped: Array<{ hunt: string; reason: string }> = [];
    const { result } = await runSuite({
      includeTags: ["smoke"],
      excludeTags: ["slow"],
      hooks: { onHuntSkipped: (hunt, reason) => skipped.push({ hunt, reason }) }
    });

    // smoke-1 runs; regression-1 skipped (no include match); slow-smoke skipped (exclude match)
    expect(mockRunHunt).toHaveBeenCalledTimes(1);
    expect(mockRunHunt).toHaveBeenCalledWith(expect.objectContaining({ huntName: "smoke-1" }));
    expect(result.passed).toBe(1);
    expect(result.skipped).toBe(2);
    expect(result.hunts.map((h) => h.hunt)).toEqual(["smoke-1", "regression-1", "slow-smoke"]);
    expect(skipped).toEqual([
      { hunt: "regression-1", reason: "include" },
      { hunt: "slow-smoke", reason: "exclude" }
    ]);
  });

  it("treats empty tag arrays as no filter", async () => {
    mockListHunts.mockReturnValue(["a", "b"]);
    mockRunHunt
      .mockResolvedValueOnce(makeRunResult("a", "pass"))
      .mockResolvedValueOnce(makeRunResult("b", "pass"));

    const { result } = await runSuite({ includeTags: [], excludeTags: [] });

    expect(mockLoadHuntTags).not.toHaveBeenCalled();
    expect(mockRunHunt).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("pass");
  });

  it("keeps hook failures separate from hunt outcomes", async () => {
    mockListHunts.mockReturnValue(["a", "b"]);
    mockLoadHuntTags
      .mockReturnValueOnce(["smoke"])
      .mockReturnValueOnce(["regression"]);
    mockRunHunt.mockResolvedValueOnce(makeRunResult("a", "pass"));

    const { result } = await runSuite({
      includeTags: ["smoke"],
      hooks: {
        onHuntStart: () => {
          throw new Error("start hook failed");
        },
        onHuntSuccess: () => {
          throw new Error("success hook failed");
        },
        onHuntSkipped: () => {
          throw new Error("skip hook failed");
        }
      }
    });

    expect(result.status).toBe("pass");
    expect(result.hunts).toEqual([
      expect.objectContaining({ hunt: "a", status: "pass" }),
      expect.objectContaining({ hunt: "b", status: "skipped" })
    ]);
  });

  it("does not let a failing onHuntFailure hook replace the original run error", async () => {
    mockListHunts.mockReturnValue(["broken"]);
    mockRunHunt.mockRejectedValueOnce(new Error("Hunt file not found"));

    const { result } = await runSuite({
      hooks: {
        onHuntFailure: () => {
          throw new Error("failure hook failed");
        }
      }
    });

    expect(result.status).toBe("fail");
    expect(result.hunts[0]).toMatchObject({
      hunt: "broken",
      status: "fail",
      error: "Hunt file not found"
    });
  });

  it("routes non-throwing failed runs through the failure hook", async () => {
    mockListHunts.mockReturnValue(["checkout"]);
    mockRunHunt.mockResolvedValueOnce(makeFailedRunResult("checkout", "button was not visible"));
    const onHuntSuccess = vi.fn();
    const onHuntFailure = vi.fn();

    const { result } = await runSuite({
      hooks: { onHuntSuccess, onHuntFailure }
    });

    expect(onHuntSuccess).not.toHaveBeenCalled();
    expect(onHuntFailure).toHaveBeenCalledWith("checkout", "button was not visible");
    expect(result.status).toBe("fail");
    expect(result.hunts[0]).toMatchObject({
      hunt: "checkout",
      status: "fail",
      error: "button was not visible"
    });
  });

  it("does not let an onStep hook failure change a passing hunt outcome", async () => {
    mockListHunts.mockReturnValue(["a"]);
    mockRunHunt.mockImplementationOnce(async (options: { onStep?: (result: unknown, step: unknown, index: number) => void }) => {
      options.onStep?.(
        { type: "navigate", status: "pass", durationMs: 1 },
        { navigate: "/" },
        0
      );
      return makeRunResult("a", "pass");
    });

    const { result } = await runSuite({
      hooks: {
        onStep: () => {
          throw new Error("step hook failed");
        }
      }
    });

    expect(result.status).toBe("pass");
    expect(result.hunts[0]).toMatchObject({ hunt: "a", status: "pass" });
  });

  it("runs hunts through the concurrency pool when parallel > 1", async () => {
    mockListHunts.mockReturnValue(["a", "b", "c"]);
    mockRunHunt
      .mockResolvedValueOnce(makeRunResult("a", "pass"))
      .mockResolvedValueOnce(makeRunResult("b", "pass"))
      .mockResolvedValueOnce(makeRunResult("c", "pass"));

    const { result } = await runSuite({ parallel: 2 });

    expect(mockRunWithConcurrency).toHaveBeenCalledTimes(1);
    expect(mockRunWithConcurrency.mock.calls[0][1]).toBe(2);
    expect(result.status).toBe("pass");
    expect(result.totalHunts).toBe(3);
  });

  it("forwards run options and the onStep hook to runHunt", async () => {
    mockListHunts.mockReturnValue(["a"]);
    mockRunHunt.mockResolvedValueOnce(makeRunResult("a", "pass"));
    const onStep = vi.fn();

    await runSuite({
      urlOverride: "http://staging.example.com",
      browser: "firefox",
      junit: true,
      hooks: { onStep }
    });

    const runOptions = mockRunHunt.mock.calls[0][0] as {
      huntName: string;
      urlOverride: string;
      browser: string;
      junit: boolean;
      onStep?: (result: unknown, step: unknown, index: number) => void;
    };
    expect(runOptions).toMatchObject({
      huntName: "a",
      urlOverride: "http://staging.example.com",
      browser: "firefox",
      junit: true
    });
    expect(runOptions.onStep).toEqual(expect.any(Function));

    const stepResult = { type: "navigate", status: "pass", durationMs: 1 };
    const step = { navigate: "/" };
    runOptions.onStep?.(stepResult, step, 0);
    expect(onStep).toHaveBeenCalledWith(stepResult, step, 0);
  });

  it("emits no console output of its own", async () => {
    mockListHunts.mockReturnValue(["a", "b"]);
    mockRunHunt
      .mockResolvedValueOnce(makeRunResult("a", "pass"))
      .mockResolvedValueOnce(makeRunResult("b", "fail"));

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await runSuite({});

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
