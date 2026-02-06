import { Command } from "commander";
import chalk from "chalk";
import { runHunt } from "../../runner/index.js";

export function buildRunCommand(): Command {
  const command = new Command("run")
    .argument("<hunt-name>", "Hunt name (filename without .yml)")
    .option("--url <target>", "Override target URL")
    .option("--headed", "Show browser window")
    .option("--slow-mo <ms>", "Slow down Playwright actions", (value) => Number(value))
    .option("--trace", "Capture Playwright trace")
    .option("--config <path>", "Custom config path")
    .action(async (huntName, options) => {
      try {
        const { result, runDir } = await runHunt({
          huntName,
          urlOverride: options.url,
          headed: Boolean(options.headed),
          slowMo: Number.isFinite(options.slowMo) ? options.slowMo : undefined,
          trace: Boolean(options.trace),
          configPath: options.config
        });

        const status =
          result.status === "pass" ? chalk.green("PASS") : chalk.red("FAIL");

        console.log(`${status} - ${result.hunt} (${result.durationMs}ms)`);
        console.log(`Artifacts: ${runDir}`);
        process.exitCode = result.exitCode;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Run failed";
        console.error(chalk.red(`Error: ${message}`));
        process.exitCode = 1;
      }
    });

  return command;
}
