import { Command } from "commander";
import chalk from "chalk";
import { loadConfig, listHunts, loadHuntMeta } from "../../config/loader.js";
import { truncate } from "../output.js";

export function buildListCommand(): Command {
  const command = new Command("list")
    .option("--config <path>", "Custom config path")
    .option("--json", "Output as JSON array")
    .action((options) => {
      try {
        const { configDir } = loadConfig(options.config);
        const hunts = listHunts(configDir);

        if (hunts.length === 0) {
          const huntsPath = `${configDir}/hunts`;
          console.log(chalk.yellow(`No hunts found in ${huntsPath}.`));
          return;
        }

        const metas = hunts.map((name) => ({
          name,
          ...loadHuntMeta(name, configDir)
        }));

        if (options.json) {
          console.log(JSON.stringify(metas, null, 2));
          return;
        }

        const maxName = Math.max(...metas.map((m) => m.name.length));

        metas.forEach((m) => {
          const padded = m.name.padEnd(maxName);
          const desc = m.description ? `  ${truncate(m.description, 40)}` : "";
          const tags = m.tags.length > 0 ? chalk.gray(`  [${m.tags.join(", ")}]`) : "";
          console.log(`  ${padded}${desc}${tags}`);
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "List failed";
        console.error(chalk.red(`Error: ${message}`));
        process.exitCode = 1;
      }
    });

  return command;
}
