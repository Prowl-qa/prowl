import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import chalk from "chalk";
import { welcomeBanner } from "../mascot.js";
import { CONFIG_DIR } from "../../config/loader.js";
import { getPackageRoot } from "../../utils/package-root.js";
import { listTemplates, resolveTemplate, type TemplateInfo } from "../../templates/index.js";
import { formatTemplateCatalog } from "./templates.js";

function copyFile(source: string, destination: string): void {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function scaffoldProject(prowlDir: string): boolean {
  const packageRoot = getPackageRoot();
  const examplesDir = path.join(packageRoot, "examples");
  const exampleConfig = path.join(examplesDir, "config.yml");
  const exampleHuntsDir = path.join(examplesDir, "hunts");

  if (!fs.existsSync(exampleConfig) || !fs.existsSync(exampleHuntsDir)) {
    console.error(chalk.red("Examples not found in package. Reinstall prowl-tools."));
    process.exitCode = 1;
    return false;
  }

  copyFile(exampleConfig, path.join(prowlDir, "config.yml"));

  const huntFiles = fs.readdirSync(exampleHuntsDir).filter((f) => f.endsWith(".yml"));
  for (const huntFile of huntFiles) {
    copyFile(path.join(exampleHuntsDir, huntFile), path.join(prowlDir, "hunts", huntFile));
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
  return true;
}

/**
 * Resolve every requested template id before writing anything, so a typo in
 * one id does not leave a half-scaffolded project behind.
 */
function resolveRequestedTemplates(
  ids: string[],
  huntsDir: string,
  force: boolean
): TemplateInfo[] | null {
  const resolved: TemplateInfo[] = [];
  const errors: string[] = [];

  for (const id of ids) {
    const template = resolveTemplate(id);
    if (!template) {
      errors.push(`Unknown template "${id}". Run "prowl templates list" to see the available ids.`);
      continue;
    }
    const destination = path.join(huntsDir, `${template.name}.yml`);
    if (fs.existsSync(destination) && !force) {
      errors.push(
        `${path.relative(process.cwd(), destination)} already exists. Run with --force to overwrite it.`
      );
      continue;
    }
    resolved.push(template);
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(chalk.red(error));
    }
    process.exitCode = 1;
    return null;
  }
  return resolved;
}

export function buildInitCommand(): Command {
  const command = new Command("init")
    .description(`Create the ${CONFIG_DIR} directory, optionally seeded from starter templates`)
    .option("--force", `Overwrite existing ${CONFIG_DIR} directory`)
    .option(
      "--template <id...>",
      "Add starter template(s) by id, e.g. auth/login-flow (see: prowl templates list)"
    )
    .option("--list-templates", "List the bundled starter templates and exit")
    .action((options) => {
      if (options.listTemplates) {
        console.log(formatTemplateCatalog(listTemplates()));
        return;
      }

      const root = process.cwd();
      const prowlDir = path.join(root, CONFIG_DIR);
      const huntsDir = path.join(prowlDir, "hunts");
      const templateIds: string[] = options.template ?? [];
      const alreadyInitialized = fs.existsSync(prowlDir);

      // `--template` on an initialized project only adds hunts; it never re-scaffolds.
      if (alreadyInitialized && !options.force && templateIds.length === 0) {
        console.error(
          chalk.red(
            `${CONFIG_DIR} already exists. Run with --force to reinitialize prowl configuration without deleting existing files.`
          )
        );
        process.exitCode = 1;
        return;
      }

      const templates = resolveRequestedTemplates(templateIds, huntsDir, Boolean(options.force));
      if (!templates) {
        return;
      }

      const scaffold = !alreadyInitialized || Boolean(options.force);
      if (scaffold && !scaffoldProject(prowlDir)) {
        return;
      }

      for (const template of templates) {
        copyFile(template.path, path.join(huntsDir, `${template.name}.yml`));
      }

      if (scaffold) {
        console.log(welcomeBanner());
        console.log(chalk.green(`  Initialized ${CONFIG_DIR} directory.`));
      }
      for (const template of templates) {
        console.log(
          chalk.green(`  Added template ${template.id}`) +
            chalk.gray(` → ${CONFIG_DIR}/hunts/${template.name}.yml`)
        );
      }

      const firstHunt = templates[0]?.name ?? "hello";
      console.log(chalk.gray("  Run ") + chalk.bold(`prowl run ${firstHunt}`) + chalk.gray(" to get started."));
      console.log(
        chalk.gray("  Browse starter templates with ") +
          chalk.bold("prowl templates list") +
          chalk.gray(", add one with ") +
          chalk.bold("prowl init --template <category/name>") +
          "\n"
      );
    });

  return command;
}
