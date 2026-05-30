import { describe, expect, it, vi, beforeEach } from "vitest";

const mockRunHunt = vi.fn();
const mockRunSuite = vi.fn();
const mockUpdateBacklog = vi.fn();
const mockLoadConfig = vi.fn();
const mockListHunts = vi.fn();

vi.mock("../src/runner/index.js", () => ({ runHunt: (...args: unknown[]) => mockRunHunt(...args) }));
vi.mock("../src/runner/suite.js", () => ({ runSuite: (...args: unknown[]) => mockRunSuite(...args) }));
vi.mock("../src/backlog/index.js", () => ({ updateBacklogFromSuite: (...args: unknown[]) => mockUpdateBacklog(...args) }));
vi.mock("../src/config/loader.js", () => ({
  loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
  listHunts: (...args: unknown[]) => mockListHunts(...args)
}));

import { listHuntsTool, runSuiteTool, runHuntTool } from "../src/mcp/tools.js";

function suiteResult(overrides: Record<string, unknown> = {}) {
  return {
    result: {
      status: "fail",
      startedAt: "2026-05-25T00:00:00.000Z",
      durationMs: 100,
      totalHunts: 2,
      passed: 1,
      failed: 1,
      skipped: 0,
      hunts: [],
      ...overrides
    },
    resultPath: "/tmp/.prowlqa/runs/ci-x/ci-result.json"
  };
}

describe("listHuntsTool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns hunt names from the discovered config dir", () => {
    mockLoadConfig.mockReturnValue({ config: {}, configDir: "/proj/.prowlqa" });
    mockListHunts.mockReturnValue(["auth/login", "homepage"]);

    expect(listHuntsTool()).toEqual({ hunts: ["auth/login", "homepage"] });
    expect(mockListHunts).toHaveBeenCalledWith("/proj/.prowlqa");
  });
});

describe("runSuiteTool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs the suite, logs bugs by default, and merges the summary", async () => {
    const suite = suiteResult();
    mockLoadConfig.mockReturnValue({ config: {}, configPath: "/proj/.prowlqa/config.yml", configDir: "/proj/.prowlqa" });
    mockRunSuite.mockResolvedValue(suite);
    mockUpdateBacklog.mockReturnValue({
      created: ["QA-001"],
      regressions: ["QA-002"],
      skipped: ["QA-000"],
      backlogPath: "docs/backlog.md"
    });

    const result = await runSuiteTool({ includeTags: ["smoke"], parallel: 2 });

    expect(mockRunSuite).toHaveBeenCalledWith(
      expect.objectContaining({ configPath: "/proj/.prowlqa/config.yml", includeTags: ["smoke"], parallel: 2 })
    );
    expect(mockUpdateBacklog).toHaveBeenCalledTimes(1);
    expect(mockUpdateBacklog).toHaveBeenCalledWith(suite, {
      projectRoot: "/proj",
      backlogPath: undefined,
      resolvedPath: undefined
    });
    expect(result).toMatchObject({
      status: "fail",
      totalHunts: 2,
      passed: 1,
      failed: 1,
      skipped: 0,
      resultPath: "/tmp/.prowlqa/runs/ci-x/ci-result.json",
      bugs: {
        created: ["QA-001"],
        regressions: ["QA-002"],
        alreadyOpen: ["QA-000"],
        backlogPath: "docs/backlog.md"
      }
    });
  });

  it("skips bug-logging when logBugs is false", async () => {
    mockLoadConfig.mockReturnValue({ config: {}, configPath: "/proj/.prowlqa/config.yml", configDir: "/proj/.prowlqa" });
    mockRunSuite.mockResolvedValue(suiteResult({ status: "pass", failed: 0, passed: 2 }));

    const result = await runSuiteTool({ logBugs: false });

    expect(mockUpdateBacklog).not.toHaveBeenCalled();
    expect(result.bugs).toEqual({ created: [], regressions: [], alreadyOpen: [], backlogPath: null });
  });

  it("uses an explicit project root for bug logging", async () => {
    const suite = suiteResult();
    mockLoadConfig.mockReturnValue({ config: {}, configPath: "/repo/custom/config.yml", configDir: "/repo/custom" });
    mockRunSuite.mockResolvedValue(suite);
    mockUpdateBacklog.mockReturnValue({
      created: [],
      regressions: [],
      skipped: [],
      backlogPath: "/repo/docs/backlog.md"
    });

    await runSuiteTool({}, { configPath: "/repo/custom/config.yml", projectRoot: "/repo" });

    expect(mockRunSuite).toHaveBeenCalledWith(expect.objectContaining({ configPath: "/repo/custom/config.yml" }));
    expect(mockUpdateBacklog).toHaveBeenCalledWith(suite, { projectRoot: "/repo" });
  });
});

describe("runHuntTool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs a single hunt and returns its result plus runDir", async () => {
    mockRunHunt.mockResolvedValue({
      result: { status: "pass", exitCode: 0, hunt: "homepage", durationMs: 42, startedAt: "x", targetUrl: "u", steps: [], assertions: [], artifacts: {} },
      runDir: "/tmp/runs/homepage"
    });

    const result = await runHuntTool({ hunt: "homepage" });

    expect(mockRunHunt).toHaveBeenCalledWith({ huntName: "homepage" });
    expect(result).toMatchObject({ hunt: "homepage", status: "pass", runDir: "/tmp/runs/homepage" });
  });
});
