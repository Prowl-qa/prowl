import { Command } from "commander";
import chalk from "chalk";
import { loadConfig, listHunts } from "../../config/loader.js";

export function buildListCommand(): Command {
  const command = new Command("list")
    .option("--config <path>", "Custom config path")
    .action((options) => {
      try {
        const { configDir } = loadConfig(options.config);
        const hunts = listHunts(configDir);

        if (hunts.length === 0) {
          const huntsPath = `${configDir}/hunts`;
          console.log(chalk.yellow(`No hunts found in ${huntsPath}.`));
          return;
        }

        hunts.forEach((hunt) => {
          console.log(hunt);
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "List failed";
        console.error(chalk.red(`Error: ${message}`));
        process.exitCode = 1;
      }
    });

  return command;
}
