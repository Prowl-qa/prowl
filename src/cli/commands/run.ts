import { Command } from "commander";
import chalk from "chalk";
import { runHunt } from "../../runner/index.js";
import { loadConfig, loadHuntTags } from "../../config/loader.js";
import { printHuntHeader, printStepResult, printHuntSummary } from "../output.js";
import { resultMascot } from "../mascot.js";

export function buildRunCommand(): Command {
  const command = new Command("run")
    .argument("<hunt-name>", "Hunt name or path (e.g. homepage or admin/users-crud)")
    .option("--url <target>", "Override target URL")
    .option("--headed", "Show browser window")
    .option("--slow-mo <ms>", "Slow down Playwright actions", (value) => Number(value))
    .option("--trace", "Capture Playwright trace")
    .option("--browser <engine>", "Browser engine: chromium, firefox, or webkit")
    .option("--viewport <size>", "Viewport size: WxH (e.g. 1920x1080) or preset (mobile, tablet, desktop)")
    .option("--include-tags <tags>", "Only run hunts matching these tags (comma-separated)")
    .option("--exclude-tags <tags>", "Skip hunts matching these tags (comma-separated)")
    .option("--config <path>", "Custom config path")
    .action(async (huntName, options) => {
      try {
        if (options.includeTags || options.excludeTags) {
          const { configDir } = loadConfig(options.config);
          const tags = loadHuntTags(huntName, configDir);
          const includeTags = options.includeTags
            ? (options.includeTags as string).split(",").map((t: string) => t.trim())
            : undefined;
          const excludeTags = options.excludeTags
            ? (options.excludeTags as string).split(",").map((t: string) => t.trim())
            : undefined;

          if (includeTags && !includeTags.some((t: string) => tags.includes(t))) {
            console.log(chalk.yellow(`  Skipped "${huntName}" — no matching include tags`));
            return;
          }
          if (excludeTags && excludeTags.some((t: string) => tags.includes(t))) {
            console.log(chalk.yellow(`  Skipped "${huntName}" — matched exclude tags`));
            return;
          }
        }

        printHuntHeader(huntName);

        const { result, runDir } = await runHunt({
          huntName,
          urlOverride: options.url,
          headed: Boolean(options.headed),
          slowMo: Number.isFinite(options.slowMo) ? options.slowMo : undefined,
          trace: Boolean(options.trace),
          browser: options.browser,
          viewport: options.viewport,
          configPath: options.config,
          onStep(stepResult, step, index) {
            printStepResult(stepResult, step, index);
          }
        });

        console.log(resultMascot(result.status, huntName));
        printHuntSummary(result, runDir);
        process.exitCode = result.exitCode;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Run failed";
        console.log(resultMascot("fail", huntName));
        console.error(`\n  Error: ${message}\n`);
        process.exitCode = 1;
      }
    });

  return command;
}
