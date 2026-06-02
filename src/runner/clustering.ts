import type { BugFailure } from "../backlog/fingerprint.js";
import { normalizeError } from "../backlog/fingerprint.js";
import type { CiFailureCluster } from "../types/index.js";

/**
 * Failure clustering (PROWL-034). Groups failures that share a common cause —
 * the same normalized error on the same step type and selector — so a single
 * root cause (e.g. one renamed selector breaking 5 hunts) surfaces as one
 * cluster instead of N independent failures.
 */
export type FailureCluster = CiFailureCluster;

function clusterKey(failure: BugFailure, normalizedError: string): string {
  return [failure.stepType ?? "", failure.selector ?? "", normalizedError].join("|");
}

function describeCause(failure: BugFailure, error: string): string {
  const where = failure.stepType
    ? `${failure.stepType}${failure.selector ? ` (${failure.selector})` : ""}`
    : "run";
  return `${where}: ${error}`;
}

/**
 * Group failures by shared cause. Returns clusters sorted by size (largest first),
 * then by cause for stable output. Every failure lands in a cluster — single-hunt
 * clusters are included so the full picture is preserved; callers can filter to
 * `count > 1` to show only shared root causes.
 */
export function clusterFailures(failures: BugFailure[]): FailureCluster[] {
  const groups = new Map<string, { sample: BugFailure; error: string; hunts: Set<string> }>();

  for (const failure of failures) {
    const error = normalizeError(failure.error);
    const key = clusterKey(failure, error);
    const existing = groups.get(key);
    if (existing) {
      existing.hunts.add(failure.hunt);
    } else {
      groups.set(key, { sample: failure, error, hunts: new Set([failure.hunt]) });
    }
  }

  const clusters: FailureCluster[] = [];
  for (const { sample, error, hunts } of groups.values()) {
    clusters.push({
      cause: describeCause(sample, error),
      stepType: sample.stepType,
      selector: sample.selector,
      error,
      count: hunts.size,
      hunts: [...hunts].sort()
    });
  }

  clusters.sort((a, b) => b.count - a.count || a.cause.localeCompare(b.cause));
  return clusters;
}
