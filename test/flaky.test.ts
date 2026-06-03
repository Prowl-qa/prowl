import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { computeFlakeScore, rankFlaky, DEFAULT_FLAKY_THRESHOLD } from "../src/runner/flaky.js";
import type { HistoryEntry } from "../src/types/index.js";

// PROWL-032 / P7-002: flake detection and scoring.

function entry(hunt: string, status: "pass" | "fail"): HistoryEntry {
  return { hunt, status, durationMs: 100, startedAt: "2026-05-31T00:00:00.000Z" };
}

describe("computeFlakeScore", () => {
  it("returns 0 for fewer than 2 runs", () => {
    expect(computeFlakeScore([])).toBe(0);
    expect(computeFlakeScore([entry("a", "pass")])).toBe(0);
  });

  it("returns 0 for a perfectly stable history", () => {
    expect(computeFlakeScore([entry("a", "pass"), entry("a", "pass"), entry("a", "pass")])).toBe(0);
  });

  it("returns 1 when status flips every run", () => {
    const e = [entry("a", "pass"), entry("a", "fail"), entry("a", "pass"), entry("a", "fail")];
    expect(computeFlakeScore(e)).toBe(1);
  });

  it("computes the oscillation rate over consecutive pairs", () => {
    // pass, pass, fail, fail -> 1 transition over 3 pairs
    const e = [entry("a", "pass"), entry("a", "pass"), entry("a", "fail"), entry("a", "fail")];
    expect(computeFlakeScore(e)).toBeCloseTo(1 / 3, 5);
  });

  it("honors lastN by scoring only the most recent runs", () => {
    // full: pass,fail,pass,pass,pass -> last 3 are pass,pass,pass -> 0
    const e = [entry("a", "pass"), entry("a", "fail"), entry("a", "pass"), entry("a", "pass"), entry("a", "pass")];
    expect(computeFlakeScore(e, 3)).toBe(0);
    expect(computeFlakeScore(e)).toBeCloseTo(2 / 4, 5);
  });
});

describe("rankFlaky", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-flaky-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeHistory(entries: HistoryEntry[]): void {
    fs.writeFileSync(path.join(dir, "history.json"), JSON.stringify({ entries }));
  }

  it("ranks hunts highest score first and flags those at/above threshold", () => {
    writeHistory([
      // stable: score 0
      entry("stable", "pass"),
      entry("stable", "pass"),
      // very flaky: score 1
      entry("flaky", "pass"),
      entry("flaky", "fail"),
      entry("flaky", "pass")
    ]);

    const ranked = rankFlaky(dir, { threshold: DEFAULT_FLAKY_THRESHOLD });
    expect(ranked.map((r) => r.hunt)).toEqual(["flaky", "stable"]);
    expect(ranked[0]).toMatchObject({ hunt: "flaky", score: 1, runs: 3, flaky: true });
    expect(ranked[1]).toMatchObject({ hunt: "stable", score: 0, flaky: false });
  });

  it("respects a custom threshold", () => {
    writeHistory([
      // pass,pass,fail,fail -> score 1/3 ≈ 0.33
      entry("a", "pass"),
      entry("a", "pass"),
      entry("a", "fail"),
      entry("a", "fail")
    ]);
    expect(rankFlaky(dir, { threshold: 0.3 })[0].flaky).toBe(true);
    expect(rankFlaky(dir, { threshold: 0.5 })[0].flaky).toBe(false);
  });

  it("returns an empty list when there is no history", () => {
    expect(rankFlaky(dir)).toEqual([]);
  });
});
