import { Command } from "commander";
import { runHunt } from "../../runner/index.js";
import { printHuntHeader, printStepResult, printHuntSummary } from "../output.js";
import { resultMascot } from "../mascot.js";

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
        printHuntHeader(huntName);

        const { result, runDir } = await runHunt({
          huntName,
          urlOverride: options.url,
          headed: Boolean(options.headed),
          slowMo: Number.isFinite(options.slowMo) ? options.slowMo : undefined,
          trace: Boolean(options.trace),
          configPath: options.config,
          onStep(stepResult, step, index) {
            printStepResult(stepResult, step, index);
          }
        });

        console.log(resultMascot(result.status));
        printHuntSummary(result, runDir);
        process.exitCode = result.exitCode;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Run failed";
        console.log(resultMascot("fail"));
        console.error(`\n  Error: ${message}\n`);
        process.exitCode = 1;
      }
    });

  return command;
}
