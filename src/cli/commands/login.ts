import path from "node:path";
import readline from "node:readline";
import chalk from "chalk";
import { Command } from "commander";
import { chromium } from "playwright";
import { loadConfig } from "../../config/loader.js";

function resolvePath(configDir: string, inputPath: string): string {
  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }
  const projectRoot = path.dirname(configDir);
  return path.join(projectRoot, inputPath);
}

function waitForEnter(prompt: string): Promise<void> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

export function buildLoginCommand(): Command {
  const command = new Command("login")
    .option("--url <target>", "Override target URL")
    .option("--config <path>", "Custom config path")
    .action(async (options) => {
      try {
        const { config, configDir } = loadConfig(options.config);
        const targetUrl = options.url ?? config.target.url;
        const storageStatePath = resolvePath(configDir, config.auth.storageStatePath);

        const browser = await chromium.launch({ headless: false });
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(targetUrl);

        console.log(chalk.green("Browser opened. Log in manually."));
        await waitForEnter("Press Enter to save auth state and close the browser... ");

        await context.storageState({ path: storageStatePath });
        await context.close();
        await browser.close();

        console.log(chalk.green(`Saved auth state to ${storageStatePath}`));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Login failed";
        console.error(chalk.red(`Error: ${message}`));
        process.exitCode = 1;
      }
    });

  return command;
}
