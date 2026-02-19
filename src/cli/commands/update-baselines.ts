import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "../../config/loader.js";

export function buildUpdateBaselinesCommand(): Command {
  const command = new Command("update-baselines")
    .description("Accept current screenshots as new visual regression baselines")
    .option("--run <dir>", "Specific run directory to use")
    .option("--name <name>", "Update only a specific baseline by name")
    .option("--config <path>", "Custom config path")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (options) => {
      try {
        const { configDir } = loadConfig(options.config);
        const baselinesDir = path.join(configDir, "baselines");
        fs.mkdirSync(baselinesDir, { recursive: true });

        let runDir: string;
        if (options.run) {
          runDir = path.isAbsolute(options.run) ? options.run : path.resolve(options.run);
        } else {
          const runsDir = path.join(configDir, "runs");
          if (!fs.existsSync(runsDir)) {
            console.error(chalk.red("  No runs directory found. Run a hunt first."));
            process.exitCode = 1;
            return;
          }
          const entries = fs.readdirSync(runsDir)
            .filter((e) => fs.statSync(path.join(runsDir, e)).isDirectory())
            .sort()
            .reverse();
          if (entries.length === 0) {
            console.error(chalk.red("  No run directories found. Run a hunt first."));
            process.exitCode = 1;
            return;
          }
          runDir = path.join(runsDir, entries[0]);
        }

        const screenshotsDir = path.join(runDir, "screenshots");
        if (!fs.existsSync(screenshotsDir)) {
          console.error(chalk.red(`  No screenshots found in ${runDir}`));
          process.exitCode = 1;
          return;
        }

        const screenshots = fs.readdirSync(screenshotsDir)
          .filter((f) => f.endsWith("-current.png"));

        if (screenshots.length === 0) {
          console.log(chalk.yellow("  No assertScreenshot results found in this run."));
          return;
        }

        const nameFilter = options.name as string | undefined;
        const filtered = nameFilter
          ? screenshots.filter((f) => f === `${nameFilter}-current.png`)
          : screenshots;

        if (filtered.length === 0) {
          console.log(chalk.yellow(`  No screenshot matching "${nameFilter}" found.`));
          return;
        }

        let updated = 0;
        for (const file of filtered) {
          const baselineName = file.replace("-current.png", ".png");
          const sourcePath = path.join(screenshotsDir, file);
          const destPath = path.join(baselinesDir, baselineName);
          const exists = fs.existsSync(destPath);

          fs.copyFileSync(sourcePath, destPath);
          updated++;
          const status = exists ? chalk.yellow("updated") : chalk.green("created");
          console.log(`  ${status} ${baselineName}`);
        }

        console.log(chalk.green(`\n  ${updated} baseline(s) updated in ${baselinesDir}\n`));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Update baselines failed";
        console.error(`\n  Error: ${message}\n`);
        process.exitCode = 1;
      }
    });

  return command;
}
