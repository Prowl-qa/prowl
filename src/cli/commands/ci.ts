import { Command } from "commander";
import chalk from "chalk";
import { runSuite } from "../../runner/suite.js";
import { printHuntHeader, printStepResult, printHuntSummary } from "../output.js";
import { resultMascot } from "../mascot.js";
import { printCiSummary } from "../../reporter/ci-summary.js";

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
      const includeTags = options.includeTags
        ? (options.includeTags as string).split(",").map((t: string) => t.trim())
        : undefined;
      const excludeTags = options.excludeTags
        ? (options.excludeTags as string).split(",").map((t: string) => t.trim())
        : undefined;

      const parallel = options.parallel as number | undefined;
      const isParallel = parallel !== undefined && parallel > 1;
      // Suppress per-hunt progress output for JSON and parallel runs (parallel output would interleave).
      const showProgress = !options.json && !isParallel;

      const { result, resultPath } = await runSuite({
        configPath: options.config,
        urlOverride: options.url,
        headed: Boolean(options.headed),
        slowMo: Number.isFinite(options.slowMo) ? options.slowMo : undefined,
        trace: Boolean(options.trace),
        browser: options.browser,
        channel: options.channel,
        viewport: options.viewport,
        junit: Boolean(options.junit),
        includeTags,
        excludeTags,
        parallel,
        hooks: {
          onHuntStart: showProgress ? (huntName) => printHuntHeader(huntName) : undefined,
          onStep: showProgress
            ? (stepResult, step, index) => printStepResult(stepResult, step, index)
            : undefined,
          onHuntSuccess: showProgress
            ? (huntName, runResult, runDir) => {
                console.log(resultMascot(runResult.status, huntName));
                printHuntSummary(runResult, runDir);
              }
            : undefined,
          onHuntFailure: showProgress
            ? (huntName, message) => {
                console.log(resultMascot("fail", huntName));
                console.error(`\n  Error: ${message}\n`);
              }
            : undefined,
          onHuntSkipped: options.json
            ? undefined
            : (huntName, reason) => {
                const why = reason === "include" ? "no matching include tags" : "matched exclude tags";
                console.log(chalk.yellow(`  ○ Skipped "${huntName}" — ${why}`));
              }
        }
      });

      if (result.status === "no-hunts") {
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(chalk.yellow("\n  No hunts found. Create hunts in .prowlqa/hunts/\n"));
        }
        process.exitCode = 2;
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        printCiSummary(result.hunts, result.durationMs);
        if (resultPath) {
          console.log(`\n  CI Result: ${chalk.gray(resultPath)}\n`);
        }
        if (result.status === "all-skipped") {
          console.log(chalk.yellow("  All hunts were skipped by tag filters.\n"));
        }
      }

      if (result.status === "fail") {
        process.exitCode = 1;
      } else if (result.status === "all-skipped") {
        process.exitCode = 2;
      } else {
        process.exitCode = 0;
      }
    });

  return command;
}
