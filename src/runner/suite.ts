import path from "node:path";
import { runHunt, type RunOptions } from "./index.js";
import { loadConfig, listHunts, loadHuntTags } from "../config/loader.js";
import { writeCiResult, resolveCiStatus, countCiResults } from "../reporter/ci-summary.js";
import { timestamp } from "../utils/timestamp.js";
import { runWithConcurrency } from "../utils/concurrency.js";
import type { CiHuntResult, CiResult, RunResult } from "../types/index.js";

export type SkipReason = "include" | "exclude";

export interface RunSuiteHooks {
  onHuntStart?: (huntName: string) => void;
  onStep?: RunOptions["onStep"];
  onHuntSuccess?: (huntName: string, result: RunResult, runDir: string) => void;
  onHuntFailure?: (huntName: string, message: string) => void;
  onHuntSkipped?: (huntName: string, reason: SkipReason) => void;
}

export interface RunSuiteOptions {
  configPath?: string;
  urlOverride?: string;
  headed?: boolean;
  slowMo?: number;
  trace?: boolean;
  browser?: RunOptions["browser"];
  channel?: RunOptions["channel"];
  viewport?: string;
  junit?: boolean;
  includeTags?: string[];
  excludeTags?: string[];
  parallel?: number;
  hooks?: RunSuiteHooks;
}

export interface RunSuiteResult {
  result: CiResult;
  /** Path to the written ci-result.json, or null when there were no hunts to run. */
  resultPath: string | null;
}

/**
 * Runs every hunt in the project and aggregates a CiResult. Side-effect-free with
 * respect to the console and process exit — callers provide hooks for presentation
 * and inspect the returned status for exit codes.
 */
export async function runSuite(options: RunSuiteOptions = {}): Promise<RunSuiteResult> {
  const startedAt = new Date().toISOString();
  const startTime = Date.now();
  const hooks = options.hooks ?? {};

  const { configDir } = loadConfig(options.configPath);
  const hunts = listHunts(configDir);

  if (hunts.length === 0) {
    return {
      result: {
        status: "no-hunts",
        startedAt,
        durationMs: 0,
        totalHunts: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        hunts: []
      },
      resultPath: null
    };
  }

  const { includeTags, excludeTags } = options;
  const results: CiHuntResult[] = [];

  // Phase 1: Tag filtering (always sequential, preserves hunt order)
  const huntsToRun: string[] = [];
  for (const huntName of hunts) {
    if (includeTags || excludeTags) {
      const tags = loadHuntTags(huntName, configDir);

      if (includeTags && !includeTags.some((t) => tags.includes(t))) {
        hooks.onHuntSkipped?.(huntName, "include");
        results.push({ hunt: huntName, status: "skipped", durationMs: 0 });
        continue;
      }
      if (excludeTags && excludeTags.some((t) => tags.includes(t))) {
        hooks.onHuntSkipped?.(huntName, "exclude");
        results.push({ hunt: huntName, status: "skipped", durationMs: 0 });
        continue;
      }
    }
    huntsToRun.push(huntName);
  }

  // Phase 2: Build a task per hunt to run
  const buildTask = (huntName: string) => async (): Promise<CiHuntResult> => {
    const huntStart = Date.now();
    try {
      hooks.onHuntStart?.(huntName);

      const { result, runDir } = await runHunt({
        huntName,
        urlOverride: options.urlOverride,
        headed: options.headed,
        slowMo: options.slowMo,
        trace: options.trace,
        browser: options.browser,
        channel: options.channel,
        viewport: options.viewport,
        junit: options.junit,
        configPath: options.configPath,
        onStep: hooks.onStep
      });

      hooks.onHuntSuccess?.(huntName, result, runDir);

      return {
        hunt: huntName,
        status: result.status,
        durationMs: result.durationMs,
        runDir
      };
    } catch (error) {
      const durationMs = Date.now() - huntStart;
      const message = error instanceof Error ? error.message : "Run failed";
      hooks.onHuntFailure?.(huntName, message);
      return {
        hunt: huntName,
        status: "fail",
        durationMs,
        error: message
      };
    }
  };

  // Phase 3: Execute (parallel when requested, otherwise sequential in hunt order)
  const parallel = options.parallel;
  if (parallel !== undefined && parallel > 1) {
    const tasks = huntsToRun.map((name) => ({ name, task: buildTask(name) }));
    const parallelResults = await runWithConcurrency(
      tasks.map((entry) => entry.task),
      parallel
    );
    for (let i = 0; i < parallelResults.length; i++) {
      const pr = parallelResults[i];
      if (pr.status === "fulfilled") {
        results.push(pr.value);
      } else {
        const message = pr.reason instanceof Error ? pr.reason.message : "Run failed";
        results.push({
          hunt: tasks[i]?.name ?? "unknown",
          status: "fail",
          durationMs: 0,
          error: message
        });
      }
    }
  } else {
    for (const huntName of huntsToRun) {
      results.push(await buildTask(huntName)());
    }
  }

  const totalDurationMs = Date.now() - startTime;

  const ciRunDir = path.join(configDir, "runs", timestamp("ci"));
  const resultPath = writeCiResult(ciRunDir, results, startedAt, totalDurationMs);

  const { passed, failed, skipped } = countCiResults(results);

  return {
    result: {
      status: resolveCiStatus(results),
      startedAt,
      durationMs: totalDurationMs,
      totalHunts: results.length,
      passed,
      failed,
      skipped,
      hunts: results
    },
    resultPath
  };
}
