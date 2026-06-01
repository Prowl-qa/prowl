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

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

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

  it("renders a non-JSON table with ranked scores", async () => {
    mockRankFlaky.mockReturnValue([
      { hunt: "checkout", score: 0.75, runs: 5, flaky: true },
      { hunt: "login", score: 0.25, runs: 4, flaky: false }
    ]);

    await buildFlakyCommand().parseAsync(["node", "prowlqa"]);

    const output = stripAnsi(logSpy.mock.calls.map((call) => String(call[0] ?? "")).join("\n"));
    expect(output).toContain("Flake scores");
    expect(output).toContain("checkout");
    expect(output).toContain("0.75");
    expect(output).toContain("5");
    expect(output).toContain("yes");
    expect(output).toContain("login");
    expect(output).toContain("0.25");
    expect(output).toContain("4");
    expect(output).toContain("no");
  });

  it("rejects an out-of-range --threshold", async () => {
    await expect(
      buildFlakyCommand().parseAsync(["node", "prowlqa", "--threshold", "2"])
    ).rejects.toThrow("--threshold must be a number between 0 and 1");
  });
});
