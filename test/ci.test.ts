import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const mockRunHunt = vi.fn();
const mockLoadConfig = vi.fn();
const mockListHunts = vi.fn();
const mockLoadHuntTags = vi.fn();

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

import { buildCiCommand } from "../src/cli/commands/ci.js";
import { printCiSummary, writeCiResult } from "../src/reporter/ci-summary.js";
import type { CiHuntResult } from "../src/reporter/ci-summary.js";

function makeRunResult(huntName: string, status: "pass" | "fail") {
  return {
    result: {
      status,
      exitCode: status === "pass" ? 0 : 1,
      hunt: huntName,
      durationMs: 100,
      steps: [],
      assertions: [],
      artifacts: {}
    },
    runDir: `/tmp/prowlqa/runs/${huntName}`
  };
}

describe("ci command", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("runs all hunts and exits 0 when all pass", async () => {
    mockLoadConfig.mockReturnValue({ config: {}, configDir: "/tmp/.prowlqa" });
    mockListHunts.mockReturnValue(["homepage", "login-flow"]);
    mockRunHunt
      .mockResolvedValueOnce(makeRunResult("homepage", "pass"))
      .mockResolvedValueOnce(makeRunResult("login-flow", "pass"));

    const cmd = buildCiCommand();
    await cmd.parseAsync(["node", "prowlqa"]);

    expect(mockRunHunt).toHaveBeenCalledTimes(2);
    expect(process.exitCode).toBe(0);
  });

  it("exits 1 when any hunt fails", async () => {
    mockLoadConfig.mockReturnValue({ config: {}, configDir: "/tmp/.prowlqa" });
    mockListHunts.mockReturnValue(["homepage", "checkout"]);
    mockRunHunt
      .mockResolvedValueOnce(makeRunResult("homepage", "pass"))
      .mockResolvedValueOnce(makeRunResult("checkout", "fail"));

    const cmd = buildCiCommand();
    await cmd.parseAsync(["node", "prowlqa"]);

    expect(mockRunHunt).toHaveBeenCalledTimes(2);
    expect(process.exitCode).toBe(1);
  });

  it("prints warning and exits cleanly when no hunts found", async () => {
    mockLoadConfig.mockReturnValue({ config: {}, configDir: "/tmp/.prowlqa" });
    mockListHunts.mockReturnValue([]);

    const cmd = buildCiCommand();
    await cmd.parseAsync(["node", "prowlqa"]);

    expect(mockRunHunt).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("No hunts found"));
    expect(process.exitCode).toBeUndefined();
  });

  it("filters hunts with --include-tags", async () => {
    mockLoadConfig.mockReturnValue({ config: {}, configDir: "/tmp/.prowlqa" });
    mockListHunts.mockReturnValue(["homepage", "login-flow", "checkout"]);
    mockLoadHuntTags
      .mockReturnValueOnce(["smoke"])
      .mockReturnValueOnce(["regression"])
      .mockReturnValueOnce(["smoke", "critical"]);
    mockRunHunt
      .mockResolvedValueOnce(makeRunResult("homepage", "pass"))
      .mockResolvedValueOnce(makeRunResult("checkout", "pass"));

    const cmd = buildCiCommand();
    await cmd.parseAsync(["node", "prowlqa", "--include-tags", "smoke"]);

    expect(mockRunHunt).toHaveBeenCalledTimes(2);
    expect(mockRunHunt).toHaveBeenCalledWith(expect.objectContaining({ huntName: "homepage" }));
    expect(mockRunHunt).toHaveBeenCalledWith(expect.objectContaining({ huntName: "checkout" }));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Skipped"));
  });

  it("filters hunts with --exclude-tags", async () => {
    mockLoadConfig.mockReturnValue({ config: {}, configDir: "/tmp/.prowlqa" });
    mockListHunts.mockReturnValue(["homepage", "slow-test"]);
    mockLoadHuntTags
      .mockReturnValueOnce(["smoke"])
      .mockReturnValueOnce(["slow"]);
    mockRunHunt.mockResolvedValueOnce(makeRunResult("homepage", "pass"));

    const cmd = buildCiCommand();
    await cmd.parseAsync(["node", "prowlqa", "--exclude-tags", "slow"]);

    expect(mockRunHunt).toHaveBeenCalledTimes(1);
    expect(mockRunHunt).toHaveBeenCalledWith(expect.objectContaining({ huntName: "homepage" }));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Skipped"));
  });

  it("continues running remaining hunts when one throws", async () => {
    mockLoadConfig.mockReturnValue({ config: {}, configDir: "/tmp/.prowlqa" });
    mockListHunts.mockReturnValue(["homepage", "broken", "login-flow"]);
    mockRunHunt
      .mockResolvedValueOnce(makeRunResult("homepage", "pass"))
      .mockRejectedValueOnce(new Error("Hunt file not found"))
      .mockResolvedValueOnce(makeRunResult("login-flow", "pass"));

    const cmd = buildCiCommand();
    await cmd.parseAsync(["node", "prowlqa"]);

    expect(mockRunHunt).toHaveBeenCalledTimes(3);
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Hunt file not found"));
  });

  it("passes --config flag through to loadConfig", async () => {
    mockLoadConfig.mockReturnValue({ config: {}, configDir: "/tmp/custom/.prowlqa" });
    mockListHunts.mockReturnValue(["homepage"]);
    mockRunHunt.mockResolvedValueOnce(makeRunResult("homepage", "pass"));

    const cmd = buildCiCommand();
    await cmd.parseAsync(["node", "prowlqa", "--config", "/tmp/custom/.prowlqa/config.yml"]);

    expect(mockLoadConfig).toHaveBeenCalledWith("/tmp/custom/.prowlqa/config.yml");
    expect(mockRunHunt).toHaveBeenCalledWith(
      expect.objectContaining({ configPath: "/tmp/custom/.prowlqa/config.yml" })
    );
  });

  it("passes --url override to each runHunt call", async () => {
    mockLoadConfig.mockReturnValue({ config: {}, configDir: "/tmp/.prowlqa" });
    mockListHunts.mockReturnValue(["homepage", "login-flow"]);
    mockRunHunt
      .mockResolvedValueOnce(makeRunResult("homepage", "pass"))
      .mockResolvedValueOnce(makeRunResult("login-flow", "pass"));

    const cmd = buildCiCommand();
    await cmd.parseAsync(["node", "prowlqa", "--url", "http://staging.example.com"]);

    expect(mockRunHunt).toHaveBeenCalledWith(
      expect.objectContaining({ urlOverride: "http://staging.example.com" })
    );
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
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-ci-test-"));
    const ciRunDir = path.join(tmpDir, "ci-run");

    const results: CiHuntResult[] = [
      { hunt: "homepage", status: "pass", durationMs: 320, runDir: "/tmp/runs/1" },
      { hunt: "checkout", status: "fail", durationMs: 890, error: "assertion failed" },
      { hunt: "admin", status: "skipped", durationMs: 0 }
    ];

    const filePath = writeCiResult(ciRunDir, results, "2026-02-15T10:30:45.000Z", 1210);

    expect(fs.existsSync(filePath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(content.status).toBe("fail");
    expect(content.startedAt).toBe("2026-02-15T10:30:45.000Z");
    expect(content.durationMs).toBe(1210);
    expect(content.totalHunts).toBe(3);
    expect(content.passed).toBe(1);
    expect(content.failed).toBe(1);
    expect(content.skipped).toBe(1);
    expect(content.hunts).toHaveLength(3);

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("writes pass status when all hunts pass", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-ci-test-"));
    const ciRunDir = path.join(tmpDir, "ci-run");

    const results: CiHuntResult[] = [
      { hunt: "homepage", status: "pass", durationMs: 320 }
    ];

    const filePath = writeCiResult(ciRunDir, results, "2026-02-15T10:30:45.000Z", 320);

    const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(content.status).toBe("pass");
    expect(content.passed).toBe(1);
    expect(content.failed).toBe(0);

    fs.rmSync(tmpDir, { recursive: true });
  });
});
