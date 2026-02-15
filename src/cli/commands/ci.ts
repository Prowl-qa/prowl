import path from "node:path";
import { Command } from "commander";
import chalk from "chalk";
import { runHunt } from "../../runner/index.js";
import { loadConfig, listHunts, loadHuntTags } from "../../config/loader.js";
import { printHuntHeader, printStepResult, printHuntSummary } from "../output.js";
import { resultMascot } from "../mascot.js";
import { printCiSummary, writeCiResult } from "../../reporter/ci-summary.js";
import type { CiHuntResult } from "../../reporter/ci-summary.js";

function ciTimestamp(): string {
  const now = new Date();
  const pad = (value: number): string => value.toString().padStart(2, "0");
  return `ci-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(
    now.getHours()
  )}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

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
    .option("--include-tags <tags>", "Only run hunts matching these tags (comma-separated)")
    .option("--exclude-tags <tags>", "Skip hunts matching these tags (comma-separated)")
    .action(async (options) => {
      const startedAt = new Date().toISOString();
      const startTime = Date.now();

      const { configDir } = loadConfig(options.config);
      const hunts = listHunts(configDir);

      if (hunts.length === 0) {
        console.log(chalk.yellow("\n  No hunts found. Create hunts in .prowlqa/hunts/\n"));
        return;
      }

      const includeTags = options.includeTags
        ? (options.includeTags as string).split(",").map((t: string) => t.trim())
        : undefined;
      const excludeTags = options.excludeTags
        ? (options.excludeTags as string).split(",").map((t: string) => t.trim())
        : undefined;

      const results: CiHuntResult[] = [];

      for (const huntName of hunts) {
        // Tag filtering
        if (includeTags || excludeTags) {
          const tags = loadHuntTags(huntName, configDir);

          if (includeTags && !includeTags.some((t: string) => tags.includes(t))) {
            console.log(chalk.yellow(`  ○ Skipped "${huntName}" — no matching include tags`));
            results.push({ hunt: huntName, status: "skipped", durationMs: 0 });
            continue;
          }
          if (excludeTags && excludeTags.some((t: string) => tags.includes(t))) {
            console.log(chalk.yellow(`  ○ Skipped "${huntName}" — matched exclude tags`));
            results.push({ hunt: huntName, status: "skipped", durationMs: 0 });
            continue;
          }
        }

        const huntStart = Date.now();

        try {
          printHuntHeader(huntName);

          const { result, runDir } = await runHunt({
            huntName,
            urlOverride: options.url,
            headed: Boolean(options.headed),
            slowMo: Number.isFinite(options.slowMo) ? options.slowMo : undefined,
            trace: Boolean(options.trace),
            browser: options.browser,
            channel: options.channel,
            viewport: options.viewport,
            configPath: options.config,
            onStep(stepResult, step, index) {
              printStepResult(stepResult, step, index);
            }
          });

          console.log(resultMascot(result.status, huntName));
          printHuntSummary(result, runDir);

          results.push({
            hunt: huntName,
            status: result.status,
            durationMs: result.durationMs,
            runDir
          });
        } catch (error) {
          const durationMs = Date.now() - huntStart;
          const message = error instanceof Error ? error.message : "Run failed";
          console.log(resultMascot("fail", huntName));
          console.error(`\n  Error: ${message}\n`);
          results.push({
            hunt: huntName,
            status: "fail",
            durationMs,
            error: message
          });
        }
      }

      const totalDurationMs = Date.now() - startTime;

      printCiSummary(results, totalDurationMs);

      // Write ci-result.json
      const ciRunDir = path.join(configDir, "runs", ciTimestamp());
      const resultPath = writeCiResult(ciRunDir, results, startedAt, totalDurationMs);
      console.log(`\n  CI Result: ${chalk.gray(resultPath)}\n`);

      const anyFailed = results.some((r) => r.status === "fail");
      process.exitCode = anyFailed ? 1 : 0;
    });

  return command;
}
