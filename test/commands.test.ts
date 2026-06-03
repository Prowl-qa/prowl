import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const mockRunHunt = vi.fn();
const mockLoadConfig = vi.fn();
const mockListHunts = vi.fn();
const mockLoadHuntTags = vi.fn();
const mockLoadHuntMeta = vi.fn();

vi.mock("../src/runner/index.js", () => ({
  runHunt: (...args: unknown[]) => mockRunHunt(...args)
}));

vi.mock("../src/config/loader.js", () => ({
  loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
  listHunts: (...args: unknown[]) => mockListHunts(...args),
  loadHuntTags: (...args: unknown[]) => mockLoadHuntTags(...args),
  loadHuntMeta: (...args: unknown[]) => mockLoadHuntMeta(...args)
}));

vi.mock("../src/cli/output.js", () => ({
  printHuntHeader: vi.fn(),
  printStepResult: vi.fn(),
  printHuntSummary: vi.fn(),
  truncate: vi.fn((text: string, max: number) => {
    if (text.length <= max) return text;
    return text.slice(0, max - 1) + "\u2026";
  })
}));

vi.mock("../src/cli/mascot.js", () => ({
  resultMascot: vi.fn(() => ""),
  welcomeBanner: vi.fn(() => "")
}));

import { buildRunCommand } from "../src/cli/commands/run.js";
import { buildListCommand } from "../src/cli/commands/list.js";

describe("run command", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("calls runHunt with correct options", async () => {
    mockRunHunt.mockResolvedValue({
      result: {
        status: "pass",
        exitCode: 0,
        hunt: "homepage",
        steps: [],
        assertions: [],
        artifacts: {}
      },
      runDir: "/tmp/prowl/runs/test"
    });

    const cmd = buildRunCommand();
    await cmd.parseAsync(["node", "prowl", "homepage", "--url", "http://example.com"]);

    expect(mockRunHunt).toHaveBeenCalledWith(
      expect.objectContaining({
        huntName: "homepage",
        urlOverride: "http://example.com"
      })
    );
  });

  it("skips hunt when include-tags do not match", async () => {
    mockLoadConfig.mockReturnValue({ configDir: "/tmp/.prowl" });
    mockLoadHuntTags.mockReturnValue(["smoke"]);

    const cmd = buildRunCommand();
    await cmd.parseAsync(["node", "prowl", "homepage", "--include-tags", "regression"]);

    expect(mockRunHunt).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Skipped"));
  });

  it("skips hunt when exclude-tags match", async () => {
    mockLoadConfig.mockReturnValue({ configDir: "/tmp/.prowl" });
    mockLoadHuntTags.mockReturnValue(["slow", "regression"]);

    const cmd = buildRunCommand();
    await cmd.parseAsync(["node", "prowl", "homepage", "--exclude-tags", "slow"]);

    expect(mockRunHunt).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Skipped"));
  });

  it("runs hunt when include-tags match", async () => {
    mockLoadConfig.mockReturnValue({ configDir: "/tmp/.prowl" });
    mockLoadHuntTags.mockReturnValue(["smoke", "fast"]);
    mockRunHunt.mockResolvedValue({
      result: {
        status: "pass",
        exitCode: 0,
        hunt: "homepage",
        steps: [],
        assertions: [],
        artifacts: {}
      },
      runDir: "/tmp/prowl/runs/test"
    });

    const cmd = buildRunCommand();
    await cmd.parseAsync(["node", "prowl", "homepage", "--include-tags", "smoke"]);

    expect(mockRunHunt).toHaveBeenCalled();
  });

  it("passes --channel flag to runHunt", async () => {
    mockRunHunt.mockResolvedValue({
      result: {
        status: "pass",
        exitCode: 0,
        hunt: "homepage",
        steps: [],
        assertions: [],
        artifacts: {}
      },
      runDir: "/tmp/prowl/runs/test"
    });

    const cmd = buildRunCommand();
    await cmd.parseAsync(["node", "prowl", "homepage", "--channel", "chrome"]);

    expect(mockRunHunt).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "chrome"
      })
    );
  });

  it("passes --junit flag to runHunt", async () => {
    mockRunHunt.mockResolvedValue({
      result: {
        status: "pass",
        exitCode: 0,
        hunt: "homepage",
        steps: [],
        assertions: [],
        artifacts: {}
      },
      runDir: "/tmp/prowl/runs/test"
    });

    const cmd = buildRunCommand();
    await cmd.parseAsync(["node", "prowl", "homepage", "--junit"]);

    expect(mockRunHunt).toHaveBeenCalledWith(
      expect.objectContaining({
        junit: true
      })
    );
  });

  it("sets process.exitCode on failure", async () => {
    mockRunHunt.mockResolvedValue({
      result: {
        status: "fail",
        exitCode: 1,
        hunt: "homepage",
        steps: [],
        assertions: [],
        artifacts: {}
      },
      runDir: "/tmp/prowl/runs/test"
    });

    const cmd = buildRunCommand();
    await cmd.parseAsync(["node", "prowl", "homepage"]);

    expect(process.exitCode).toBe(1);
  });

  it("outputs valid JSON with --json flag", async () => {
    const runResult = {
      status: "pass" as const,
      exitCode: 0 as const,
      hunt: "homepage",
      startedAt: "2026-02-15T10:00:00.000Z",
      durationMs: 500,
      targetUrl: "http://localhost:3000",
      steps: [{ type: "navigate", status: "pass" as const, durationMs: 200 }],
      assertions: [],
      artifacts: {}
    };
    mockRunHunt.mockResolvedValue({
      result: runResult,
      runDir: "/tmp/prowl/runs/test"
    });

    const cmd = buildRunCommand();
    await cmd.parseAsync(["node", "prowl", "homepage", "--json"]);

    expect(logSpy).toHaveBeenCalledTimes(1);
    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.status).toBe("pass");
    expect(parsed.hunt).toBe("homepage");
    expect(parsed.steps).toHaveLength(1);
  });

  it("outputs JSON error on failure with --json flag", async () => {
    mockRunHunt.mockRejectedValue(new Error("Config not found"));

    const cmd = buildRunCommand();
    await cmd.parseAsync(["node", "prowl", "homepage", "--json"]);

    expect(logSpy).toHaveBeenCalledTimes(1);
    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.status).toBe("fail");
    expect(parsed.exitCode).toBe(1);
    expect(parsed.hunt).toBe("homepage");
    expect(parsed.error).toBe("Config not found");
    expect(process.exitCode).toBe(1);
  });

  it("outputs JSON when hunt is skipped by include-tags with --json flag", async () => {
    mockLoadConfig.mockReturnValue({ configDir: "/tmp/.prowl" });
    mockLoadHuntTags.mockReturnValue(["smoke"]);

    const cmd = buildRunCommand();
    await cmd.parseAsync(["node", "prowl", "homepage", "--include-tags", "regression", "--json"]);

    expect(mockRunHunt).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed.status).toBe("skipped");
    expect(parsed.hunt).toBe("homepage");
    expect(parsed.reason).toBe("no matching include tags");
  });

  it("outputs JSON when hunt is skipped by exclude-tags with --json flag", async () => {
    mockLoadConfig.mockReturnValue({ configDir: "/tmp/.prowl" });
    mockLoadHuntTags.mockReturnValue(["slow"]);

    const cmd = buildRunCommand();
    await cmd.parseAsync(["node", "prowl", "homepage", "--exclude-tags", "slow", "--json"]);

    expect(mockRunHunt).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed.status).toBe("skipped");
    expect(parsed.hunt).toBe("homepage");
    expect(parsed.reason).toBe("matched exclude tags");
  });

  it("suppresses formatted output with --json flag", async () => {
    const { printHuntHeader, printStepResult, printHuntSummary } = await import("../src/cli/output.js");
    const { resultMascot } = await import("../src/cli/mascot.js");

    mockRunHunt.mockResolvedValue({
      result: {
        status: "pass",
        exitCode: 0,
        hunt: "homepage",
        startedAt: "2026-02-15T10:00:00.000Z",
        durationMs: 500,
        targetUrl: "http://localhost:3000",
        steps: [],
        assertions: [],
        artifacts: {}
      },
      runDir: "/tmp/prowl/runs/test"
    });

    const cmd = buildRunCommand();
    await cmd.parseAsync(["node", "prowl", "homepage", "--json"]);

    expect(printHuntHeader).not.toHaveBeenCalled();
    expect(printStepResult).not.toHaveBeenCalled();
    expect(printHuntSummary).not.toHaveBeenCalled();
    expect(resultMascot).not.toHaveBeenCalled();
  });
});

describe("list command", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("lists hunts with description and tags", () => {
    mockLoadConfig.mockReturnValue({ configDir: "/tmp/.prowl" });
    mockListHunts.mockReturnValue(["homepage", "login-flow"]);
    mockLoadHuntMeta.mockImplementation((name: string) => {
      if (name === "homepage") return { description: "Basic page load test", tags: ["smoke"] };
      return { description: "Verify auth flow", tags: [] };
    });

    const cmd = buildListCommand();
    cmd.parse(["node", "prowl"]);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("homepage"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Basic page load test"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("smoke"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("login-flow"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Verify auth flow"));
  });

  it("outputs valid JSON with --json flag", () => {
    mockLoadConfig.mockReturnValue({ configDir: "/tmp/.prowl" });
    mockListHunts.mockReturnValue(["homepage", "login-flow"]);
    mockLoadHuntMeta.mockImplementation((name: string) => {
      if (name === "homepage") return { description: "Basic page load test", tags: ["smoke"] };
      return { tags: [] };
    });

    const cmd = buildListCommand();
    cmd.parse(["node", "prowl", "--json"]);

    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed).toEqual([
      { name: "homepage", description: "Basic page load test", tags: ["smoke"] },
      { name: "login-flow", tags: [] }
    ]);
  });

  it("shows message when no hunts found", () => {
    mockLoadConfig.mockReturnValue({ configDir: "/tmp/.prowl" });
    mockListHunts.mockReturnValue([]);

    const cmd = buildListCommand();
    cmd.parse(["node", "prowl"]);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("No hunts found"));
  });
});
