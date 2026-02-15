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

  throw new Error("Cannot find package root. Reinstall prowlqa.");
}

function copyFile(source: string, destination: string): void {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

export function buildInitCommand(): Command {
  const command = new Command("init")
    .option("--force", "Overwrite existing .prowlqa directory")
    .action((options) => {
      const root = process.cwd();
      const prowlqaDir = path.join(root, ".prowlqa");
      if (fs.existsSync(prowlqaDir) && !options.force) {
        console.error(chalk.red(".prowlqa already exists. Use --force to overwrite."));
        process.exitCode = 1;
        return;
      }

      const packageRoot = getPackageRoot();
      const examplesDir = path.join(packageRoot, "examples");
      const exampleConfig = path.join(examplesDir, "config.yml");
      const exampleHuntsDir = path.join(examplesDir, "hunts");

      if (!fs.existsSync(exampleConfig) || !fs.existsSync(exampleHuntsDir)) {
        console.error(chalk.red("Examples not found in package. Reinstall prowlqa."));
        process.exitCode = 1;
        return;
      }

      copyFile(exampleConfig, path.join(prowlqaDir, "config.yml"));

      const huntFiles = fs.readdirSync(exampleHuntsDir).filter((f) => f.endsWith(".yml"));
      for (const huntFile of huntFiles) {
        copyFile(
          path.join(exampleHuntsDir, huntFile),
          path.join(prowlqaDir, "hunts", huntFile)
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
      fs.writeFileSync(path.join(prowlqaDir, ".gitignore"), gitignore);

      console.log(welcomeBanner());
      console.log(chalk.green("  Initialized .prowlqa directory."));
      console.log(chalk.gray("  Run ") + chalk.bold("prowlqa run homepage") + chalk.gray(" to get started.\n"));
    });

  return command;
}
