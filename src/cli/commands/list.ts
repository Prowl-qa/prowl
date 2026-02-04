import { Command } from "commander";
import chalk from "chalk";
import { loadConfig, listGoals } from "../../config/loader.js";

export function buildListCommand(): Command {
  const command = new Command("list")
    .option("--config <path>", "Custom config path")
    .action((options) => {
      try {
        const { configDir } = loadConfig(options.config);
        const goals = listGoals(configDir);

        if (goals.length === 0) {
          const goalsPath = `${configDir}/goals`;
          console.log(chalk.yellow(`No goals found in ${goalsPath}.`));
          return;
        }

        goals.forEach((goal) => {
          console.log(goal);
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "List failed";
        console.error(chalk.red(`Error: ${message}`));
        process.exitCode = 1;
      }
    });

  return command;
}
