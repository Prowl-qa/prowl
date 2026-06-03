import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { HistoryEntry } from "../src/types/index.js";

const mockLoadConfig = vi.fn();
const mockReadHuntHistory = vi.fn();

vi.mock("../src/config/loader.js", () => ({
  loadConfig: (...args: unknown[]) => mockLoadConfig(...args)
}));

vi.mock("../src/runner/history.js", () => ({
  readHuntHistory: (...args: unknown[]) => mockReadHuntHistory(...args)
}));

import { buildHistoryCommand } from "../src/cli/commands/history.js";

function makeEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    hunt: "login-flow",
    status: "pass",
    durationMs: 1234,
    startedAt: "2026-04-22T00:00:00.000Z",
    ...overrides
  };
}

describe("history command", () => {
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

  it("shows a message when no history exists for a hunt", () => {
    mockLoadConfig.mockReturnValue({ configDir: "/tmp/.prowl" });
    mockReadHuntHistory.mockReturnValue([]);

    const cmd = buildHistoryCommand();
    cmd.parse(["node", "prowl", "missing-hunt"]);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("No history found");
    expect(output).toContain("missing-hunt");
  });

  it("prints a table of runs with status, timestamp, and duration", () => {
    mockLoadConfig.mockReturnValue({ configDir: "/tmp/.prowl" });
    mockReadHuntHistory.mockReturnValue([
      makeEntry({ status: "pass", durationMs: 812, startedAt: "2026-04-20T08:00:00.000Z" }),
      makeEntry({ status: "fail", durationMs: 4523, startedAt: "2026-04-22T08:00:00.000Z" })
    ]);

    const cmd = buildHistoryCommand();
    cmd.parse(["node", "prowl", "login-flow"]);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("login-flow");
    expect(output).toContain("2026-04-20T08:00:00.000Z");
    expect(output).toContain("2026-04-22T08:00:00.000Z");
    expect(output).toContain("812ms");
    expect(output).toContain("4.52s");
  });

  it("outputs valid JSON with --json flag", () => {
    mockLoadConfig.mockReturnValue({ configDir: "/tmp/.prowl" });
    const entries = [
      makeEntry({ status: "pass", startedAt: "2026-04-20T00:00:00.000Z" }),
      makeEntry({ status: "fail", startedAt: "2026-04-22T00:00:00.000Z" })
    ];
    mockReadHuntHistory.mockReturnValue(entries);

    const cmd = buildHistoryCommand();
    cmd.parse(["node", "prowl", "login-flow", "--json"]);

    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].status).toBe("pass");
    expect(parsed[1].status).toBe("fail");
  });

  it("outputs an empty JSON array when no history exists with --json flag", () => {
    mockLoadConfig.mockReturnValue({ configDir: "/tmp/.prowl" });
    mockReadHuntHistory.mockReturnValue([]);

    const cmd = buildHistoryCommand();
    cmd.parse(["node", "prowl", "missing-hunt", "--json"]);

    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed).toEqual([]);
  });

  it("respects --limit by returning the last N entries", () => {
    mockLoadConfig.mockReturnValue({ configDir: "/tmp/.prowl" });
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeEntry({ startedAt: `2026-04-${String(10 + i).padStart(2, "0")}T00:00:00.000Z` })
    );
    mockReadHuntHistory.mockReturnValue(entries);

    const cmd = buildHistoryCommand();
    cmd.parse(["node", "prowl", "login-flow", "--limit", "3", "--json"]);

    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed).toHaveLength(3);
    expect(parsed[0].startedAt).toBe("2026-04-17T00:00:00.000Z");
    expect(parsed[2].startedAt).toBe("2026-04-19T00:00:00.000Z");
  });

  it("rejects a --limit that is not a positive integer", () => {
    const cmd = buildHistoryCommand();
    // Commander throws on invalid option parsing; exitOverride keeps it out of process.exit.
    cmd.exitOverride();
    expect(() =>
      cmd.parse(["node", "prowl", "login-flow", "--limit", "0"])
    ).toThrow("--limit must be a positive integer");
  });

  it("sets process.exitCode when loadConfig throws", () => {
    mockLoadConfig.mockImplementation(() => {
      throw new Error("Config not found");
    });

    const cmd = buildHistoryCommand();
    cmd.parse(["node", "prowl", "login-flow"]);

    expect(process.exitCode).toBe(1);
  });

  it("emits JSON error shape when --json is set and loadConfig throws", () => {
    mockLoadConfig.mockImplementation(() => {
      throw new Error("Config not found");
    });

    const cmd = buildHistoryCommand();
    cmd.parse(["node", "prowl", "login-flow", "--json"]);

    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed).toEqual({ error: "Config not found" });
    expect(process.exitCode).toBe(1);
  });
});
