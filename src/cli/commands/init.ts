import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import chalk from "chalk";
import { welcomeBanner } from "../mascot.js";

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
      const exampleHuntsDir = path.join(examplesDir, "hunts");

      if (!fs.existsSync(exampleConfig) || !fs.existsSync(exampleHuntsDir)) {
        console.error(chalk.red("Examples not found in package. Reinstall prowl."));
        process.exitCode = 1;
        return;
      }

      copyFile(exampleConfig, path.join(prowlDir, "config.yml"));

      const huntFiles = fs.readdirSync(exampleHuntsDir).filter((f) => f.endsWith(".yml"));
      for (const huntFile of huntFiles) {
        copyFile(
          path.join(exampleHuntsDir, huntFile),
          path.join(prowlDir, "hunts", huntFile)
        );
      }

      // Create .gitignore to keep artifacts and secrets out of version control
      const gitignore = [
        "# Run artifacts (screenshots, logs, reports)",
        "runs/",
        "",
        "# Auth state (tokens, cookies)",
        "auth-state.json",
        "",
        "# Environment variables (credentials)",
        ".env",
        "",
      ].join("\n");
      fs.writeFileSync(path.join(prowlDir, ".gitignore"), gitignore);

      console.log(welcomeBanner());
      console.log(chalk.green("  Initialized .prowl directory."));
      console.log(chalk.gray("  Run ") + chalk.bold("prowl run homepage") + chalk.gray(" to get started.\n"));
    });

  return command;
}
