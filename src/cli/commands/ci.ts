import path from "node:path";
import { Command } from "commander";
import chalk from "chalk";
import { runHunt } from "../../runner/index.js";
import { loadConfig, listHunts, loadHuntTags } from "../../config/loader.js";
import { printHuntHeader, printStepResult, printHuntSummary } from "../output.js";
import { resultMascot } from "../mascot.js";
import { printCiSummary, writeCiResult, resolveCiStatus, countCiResults } from "../../reporter/ci-summary.js";
import { timestamp } from "../../utils/timestamp.js";
import { runWithConcurrency } from "../../utils/concurrency.js";
import type { CiHuntResult, CiResult } from "../../types/index.js";

export function buildCiCommand(): Command {
  const command = new Command("ci")
    .description("Run all hunts and produce a combined pass/fail result for CI pipelines")
    .option("--config <path>", "Custom config path")
    .option("--url <target>", "Override target URL")
    .option("--headed", "Show browser window")
    .option("--slow-mo <ms>", "Slow down Playwright actions", (value) => Number(value))
    .option("--trace", "Capture Playwright traces")
    .option("--browser <engine>", "Browser engine: chromium, firefox, or webkit")
    .option("--channel <name>", "Browser channel: chrome, msedge, chrome-beta, etc.")
    .option("--viewport <size>", "Viewport size: WxH (e.g. 1920x1080) or preset (mobile, tablet, desktop)")
    .option("--junit", "Generate JUnit XML reports")
    .option("--include-tags <tags>", "Only run hunts matching these tags (comma-separated)")
    .option("--exclude-tags <tags>", "Skip hunts matching these tags (comma-separated)")
    .option("--json", "Output results as JSON")
    .option("--parallel <count>", "Run hunts in parallel with N workers", (value) => {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1) {
        throw new Error("--parallel must be a positive integer");
      }
      return n;
    })
    .action(async (options) => {
      const startedAt = new Date().toISOString();
      const startTime = Date.now();

      const { configDir } = loadConfig(options.config);
      const hunts = listHunts(configDir);

      if (hunts.length === 0) {
        if (options.json) {
          const emptyResult: CiResult = {
            status: "no-hunts",
            startedAt,
            durationMs: 0,
            totalHunts: 0,
            passed: 0,
            failed: 0,
            skipped: 0,
            hunts: []
          };
          console.log(JSON.stringify(emptyResult, null, 2));
        } else {
          console.log(chalk.yellow("\n  No hunts found. Create hunts in .prowlqa/hunts/\n"));
        }
        process.exitCode = 2;
        return;
      }

      const includeTags = options.includeTags
        ? (options.includeTags as string).split(",").map((t: string) => t.trim())
        : undefined;
      const excludeTags = options.excludeTags
        ? (options.excludeTags as string).split(",").map((t: string) => t.trim())
        : undefined;

      const results: CiHuntResult[] = [];
      const parallel = options.parallel as number | undefined;
      const isParallel = parallel !== undefined && parallel > 1;

      // Phase 1: Tag filtering (always sequential)
      const huntsToRun: string[] = [];
      for (const huntName of hunts) {
        if (includeTags || excludeTags) {
          const tags = loadHuntTags(huntName, configDir);

          if (includeTags && !includeTags.some((t: string) => tags.includes(t))) {
            if (!options.json) {
              console.log(chalk.yellow(`  ○ Skipped "${huntName}" — no matching include tags`));
            }
            results.push({ hunt: huntName, status: "skipped", durationMs: 0 });
            continue;
          }
          if (excludeTags && excludeTags.some((t: string) => tags.includes(t))) {
            if (!options.json) {
              console.log(chalk.yellow(`  ○ Skipped "${huntName}" — matched exclude tags`));
            }
            results.push({ hunt: huntName, status: "skipped", durationMs: 0 });
            continue;
          }
        }
        huntsToRun.push(huntName);
      }

      // Phase 2: Build task functions for non-skipped hunts
      const buildTask = (huntName: string) => async (): Promise<CiHuntResult> => {
        const huntStart = Date.now();
        try {
          if (!options.json && !isParallel) {
            printHuntHeader(huntName);
          }

          const { result, runDir } = await runHunt({
            huntName,
            urlOverride: options.url,
            headed: Boolean(options.headed),
            slowMo: Number.isFinite(options.slowMo) ? options.slowMo : undefined,
            trace: Boolean(options.trace),
            browser: options.browser,
            channel: options.channel,
            viewport: options.viewport,
            junit: Boolean(options.junit),
            configPath: options.config,
            onStep: options.json || isParallel
              ? undefined
              : (stepResult, step, index) => {
                  printStepResult(stepResult, step, index);
                }
          });

          if (!options.json && !isParallel) {
            console.log(resultMascot(result.status, huntName));
            printHuntSummary(result, runDir);
          }

          return {
            hunt: huntName,
            status: result.status,
            durationMs: result.durationMs,
            runDir
          };
        } catch (error) {
          const durationMs = Date.now() - huntStart;
          const message = error instanceof Error ? error.message : "Run failed";
          if (!options.json && !isParallel) {
            console.log(resultMascot("fail", huntName));
            console.error(`\n  Error: ${message}\n`);
          }
          return {
            hunt: huntName,
            status: "fail",
            durationMs,
            error: message
          };
        }
      };

      // Phase 3: Execute hunts
      if (isParallel) {
        const tasks = huntsToRun.map((name) => buildTask(name));
        const parallelResults = await runWithConcurrency(tasks, parallel);
        for (const pr of parallelResults) {
          if (pr.status === "fulfilled") {
            results.push(pr.value);
          } else {
            const message = pr.reason instanceof Error ? pr.reason.message : "Run failed";
            results.push({ hunt: "unknown", status: "fail", durationMs: 0, error: message });
          }
        }
      } else {
        for (const huntName of huntsToRun) {
          const huntResult = await buildTask(huntName)();
          results.push(huntResult);
        }
      }

      const totalDurationMs = Date.now() - startTime;

      // Write ci-result.json to disk
      const ciRunDir = path.join(configDir, "runs", timestamp("ci"));
      const resultPath = writeCiResult(ciRunDir, results, startedAt, totalDurationMs);

      const status = resolveCiStatus(results);

      if (options.json) {
        const { passed, failed, skipped } = countCiResults(results);
        const ciResult: CiResult = {
          status,
          startedAt,
          durationMs: totalDurationMs,
          totalHunts: results.length,
          passed,
          failed,
          skipped,
          hunts: results
        };
        console.log(JSON.stringify(ciResult, null, 2));
      } else {
        printCiSummary(results, totalDurationMs);
        console.log(`\n  CI Result: ${chalk.gray(resultPath)}\n`);

        if (status === "all-skipped") {
          console.log(chalk.yellow("  All hunts were skipped by tag filters.\n"));
        }
      }

      if (status === "fail") {
        process.exitCode = 1;
      } else if (status === "all-skipped") {
        process.exitCode = 2;
      } else {
        process.exitCode = 0;
      }
    });

  return command;
}
