import fs from "node:fs";
import chalk from "chalk";
import { Command } from "commander";
import { loadConfig } from "../../config/loader.js";
import { runHunt } from "../../runner/index.js";
import { createDebouncer, getWatchTargets } from "../watch-utils.js";
import { printHuntHeader, printStepResult, printHuntSummary } from "../output.js";

export function buildWatchCommand(): Command {
  const command = new Command("watch")
    .argument("<hunt-name>", "Hunt name (filename without .yml)")
    .option("--url <target>", "Override target URL")
    .option("--headed", "Show browser window")
    .option("--slow-mo <ms>", "Slow down Playwright actions", (value) => Number(value))
    .option("--trace", "Capture Playwright trace")
    .option("--config <path>", "Custom config path")
    .action(async (huntName, options) => {
      const { configDir } = loadConfig(options.config);
      const watchTargets = getWatchTargets(configDir, huntName);

      let running = false;
      let pending = false;
      let stopped = false;

      const runOnce = async () => {
        if (stopped) {
          return;
        }

        if (running) {
          pending = true;
          return;
        }

        running = true;
        do {
          pending = false;
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

            printHuntSummary(result, runDir);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Run failed";
            console.error(chalk.red(`Error: ${message}`));
          }
        } while (pending && !stopped);
        running = false;
      };

      const debounced = createDebouncer(300, () => {
        void runOnce();
      });

      const unwatch: Array<() => void> = [];
      for (const target of watchTargets) {
        fs.watchFile(target, { interval: 150 }, (curr, prev) => {
          if (curr.mtimeMs === prev.mtimeMs && curr.size === prev.size) {
            return;
          }
          console.log(chalk.gray(`Change detected: ${target}`));
          debounced.trigger();
        });
        unwatch.push(() => fs.unwatchFile(target));
      }

      const stop = () => {
        if (stopped) {
          return;
        }
        stopped = true;
        debounced.cancel();
        unwatch.forEach((dispose) => dispose());
        process.off("SIGINT", stop);
        console.log(chalk.yellow("\nWatch stopped."));
        process.exit(0);
      };

      process.on("SIGINT", stop);

      console.log(chalk.gray(`Watching hunt: ${huntName}`));
      console.log(chalk.gray(`Files: ${watchTargets.join(", ")}`));
      await runOnce();
    });

  return command;
}
