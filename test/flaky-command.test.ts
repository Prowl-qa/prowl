import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const mockLoadConfig = vi.fn();
const mockRankFlaky = vi.fn();

vi.mock("../src/config/loader.js", () => ({
  loadConfig: (...args: unknown[]) => mockLoadConfig(...args)
}));
vi.mock("../src/runner/flaky.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/runner/flaky.js")>();
  return { ...actual, rankFlaky: (...args: unknown[]) => mockRankFlaky(...args) };
});

import { buildFlakyCommand } from "../src/cli/commands/flaky.js";

describe("flaky command", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockLoadConfig.mockReturnValue({ config: {}, configDir: "/proj/.prowlqa" });
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("uses the config flakyThreshold when no flag is given", async () => {
    mockLoadConfig.mockReturnValue({
      config: { reliability: { flakyThreshold: 0.5 } },
      configDir: "/proj/.prowlqa"
    });
    mockRankFlaky.mockReturnValue([]);

    await buildFlakyCommand().parseAsync(["node", "prowlqa", "--json"]);

    expect(mockRankFlaky).toHaveBeenCalledWith("/proj/.prowlqa", { lastN: undefined, threshold: 0.5 });
  });

  it("defaults the threshold to 0.3 when neither flag nor config is set", async () => {
    mockRankFlaky.mockReturnValue([]);
    await buildFlakyCommand().parseAsync(["node", "prowlqa", "--json"]);
    expect(mockRankFlaky).toHaveBeenCalledWith("/proj/.prowlqa", { lastN: undefined, threshold: 0.3 });
  });

  it("lets --threshold override config", async () => {
    mockLoadConfig.mockReturnValue({
      config: { reliability: { flakyThreshold: 0.5 } },
      configDir: "/proj/.prowlqa"
    });
    mockRankFlaky.mockReturnValue([]);
    await buildFlakyCommand().parseAsync(["node", "prowlqa", "--threshold", "0.8", "--json"]);
    expect(mockRankFlaky).toHaveBeenCalledWith("/proj/.prowlqa", { lastN: undefined, threshold: 0.8 });
  });

  it("outputs JSON of the ranked scores", async () => {
    const scores = [{ hunt: "a", score: 1, runs: 3, flaky: true }];
    mockRankFlaky.mockReturnValue(scores);
    await buildFlakyCommand().parseAsync(["node", "prowlqa", "--json"]);
    const jsonCall = logSpy.mock.calls.find((c) => {
      try { JSON.parse(c[0]); return true; } catch { return false; }
    });
    expect(JSON.parse(jsonCall![0])).toEqual(scores);
  });

  it("rejects an out-of-range --threshold", async () => {
    await expect(
      buildFlakyCommand().parseAsync(["node", "prowlqa", "--threshold", "2"])
    ).rejects.toThrow("--threshold must be a number between 0 and 1");
  });
});
