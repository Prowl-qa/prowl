import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import chalk from "chalk";

function getPackageRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  let dir = path.dirname(currentFile);
  const root = path.parse(dir).root;

  while (dir !== root) {
    if (fs.existsSync(path.join(dir, "package.json"))) {
      return dir;
    }
    dir = path.dirname(dir);
  }

  if (fs.existsSync(path.join(root, "package.json"))) {
    return root;
  }

  throw new Error("Cannot find package root. Reinstall prowl.");
}

function copyFile(source: string, destination: string): void {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

export function buildInitCommand(): Command {
  const command = new Command("init")
    .option("--force", "Overwrite existing .prowl directory")
    .action((options) => {
      const root = process.cwd();
      const prowlDir = path.join(root, ".prowl");
      if (fs.existsSync(prowlDir) && !options.force) {
        console.error(chalk.red(".prowl already exists. Use --force to overwrite."));
        process.exitCode = 1;
        return;
      }

      const packageRoot = getPackageRoot();
      const examplesDir = path.join(packageRoot, "examples");
      const exampleConfig = path.join(examplesDir, "config.yml");
      const exampleHunt = path.join(examplesDir, "hunts", "homepage.yml");

      if (!fs.existsSync(exampleConfig) || !fs.existsSync(exampleHunt)) {
        console.error(chalk.red("Examples not found in package. Reinstall prowl."));
        process.exitCode = 1;
        return;
      }

      if (fs.existsSync(prowlDir) && options.force) {
        fs.rmSync(prowlDir, { recursive: true, force: true });
      }

      copyFile(exampleConfig, path.join(prowlDir, "config.yml"));
      copyFile(exampleHunt, path.join(prowlDir, "hunts", "homepage.yml"));

      console.log(chalk.green("Initialized .prowl directory."));
    });

  return command;
}
