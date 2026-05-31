import type { HistoryEntry } from "../types/index.js";
import { readHistory } from "./history.js";

export const DEFAULT_FLAKY_THRESHOLD = 0.3;

export type FlakyScore = {
  hunt: string;
  /** Oscillation rate in [0,1]: share of consecutive run pairs whose status changed. */
  score: number;
  runs: number;
  flaky: boolean;
};

/**
 * Flake score for a single hunt's run history (oldest→newest): the fraction of
 * consecutive run pairs where the status flipped (pass↔fail). 0 = perfectly
 * stable, 1 = flips every run. Needs at least 2 runs; fewer returns 0.
 */
export function computeFlakeScore(entries: HistoryEntry[], lastN?: number): number {
  const slice = lastN !== undefined && lastN > 0 ? entries.slice(-lastN) : entries;
  if (slice.length < 2) return 0;

  let transitions = 0;
  for (let i = 1; i < slice.length; i++) {
    if (slice[i].status !== slice[i - 1].status) {
      transitions += 1;
    }
  }
  return transitions / (slice.length - 1);
}

export type RankFlakyOptions = {
  /** Only score the most recent N runs per hunt. */
  lastN?: number;
  /** Score at/above this is flagged flaky. Defaults to DEFAULT_FLAKY_THRESHOLD. */
  threshold?: number;
};

/**
 * Rank every hunt in the project's history by flake score, highest first.
 * Hunts are tie-broken by run count (more runs first) then name for stable output.
 */
export function rankFlaky(configDir: string, options: RankFlakyOptions = {}): FlakyScore[] {
  const threshold = options.threshold ?? DEFAULT_FLAKY_THRESHOLD;
  const { entries } = readHistory(configDir);

  const byHunt = new Map<string, HistoryEntry[]>();
  for (const entry of entries) {
    const list = byHunt.get(entry.hunt) ?? [];
    list.push(entry);
    byHunt.set(entry.hunt, list);
  }

  const scores: FlakyScore[] = [];
  for (const [hunt, huntEntries] of byHunt) {
    const considered = options.lastN !== undefined && options.lastN > 0
      ? huntEntries.slice(-options.lastN)
      : huntEntries;
    const score = computeFlakeScore(considered);
    scores.push({
      hunt,
      score,
      runs: considered.length,
      flaky: score >= threshold
    });
  }

  scores.sort((a, b) => b.score - a.score || b.runs - a.runs || a.hunt.localeCompare(b.hunt));
  return scores;
}
