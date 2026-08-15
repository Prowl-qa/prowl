import path from "node:path";
import readline from "node:readline";
import chalk from "chalk";
import { Command } from "commander";
import {
  launchBrowser,
  closeBrowser,
  saveStorageState,
  createPlaywrightDriver,
  type BrowserSession
} from "../../browser/controller.js";
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
      let session: BrowserSession | null = null;
      try {
        const { config, configDir } = loadConfig(options.config);
        if (config.target.type === "macos") {
          throw new Error("`prowl login` captures browser auth state and only applies to web targets.");
        }
        const targetUrl = options.url ?? config.target.url;
        const storageStatePath = config.auth.storageStatePath
          ? resolvePath(configDir, config.auth.storageStatePath)
          : resolvePath(configDir, ".prowl/auth-state.json");

        session = await launchBrowser({
          headless: false,
          slowMo: 0,
          timeout: config.browser.timeout,
          trace: false,
          recordHar: false,
          runDir: configDir
        });
        const driver = createPlaywrightDriver(session.page);
        await driver.goto(targetUrl);

        console.log(chalk.green("Browser opened. Log in manually."));
        await waitForEnter("Press Enter to save auth state and close the browser... ");

        await saveStorageState(session, storageStatePath);
        console.log(chalk.green(`Saved auth state to ${storageStatePath}`));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Login failed";
        console.error(chalk.red(`Error: ${message}`));
        process.exitCode = 1;
      } finally {
        if (session) {
          await closeBrowser(session);
        }
      }
    });

  return command;
}
