import { Command } from "commander";
import chalk from "chalk";
import { listTemplates, readTemplate, type TemplateInfo } from "../../templates/index.js";
import { truncate } from "../output.js";

/** Human-readable catalog, grouped by category. Shared with `prowl init --list-templates`. */
export function formatTemplateCatalog(templates: TemplateInfo[]): string {
  if (templates.length === 0) {
    return chalk.yellow("No starter templates are bundled with this install.");
  }

  const maxId = Math.max(...templates.map((template) => template.id.length));
  const lines: string[] = [];
  let currentCategory = "";

  for (const template of templates) {
    if (template.category !== currentCategory) {
      currentCategory = template.category;
      lines.push(`${lines.length > 0 ? "\n" : ""}  ${chalk.bold(currentCategory)}`);
    }
    const desc = template.description ? `  ${truncate(template.description, 56)}` : "";
    const tags = template.tags.length > 0 ? chalk.gray(`  [${template.tags.join(", ")}]`) : "";
    lines.push(`    ${template.id.padEnd(maxId)}${desc}${tags}`);
  }

  lines.push(
    "",
    chalk.gray("  Add one to your project: ") + chalk.bold("prowl init --template <category/name>")
  );
  return lines.join("\n");
}

export function buildTemplatesCommand(): Command {
  const command = new Command("templates").description(
    "Browse the starter hunt templates bundled with Prowl"
  );

  command
    .command("list", { isDefault: true })
    .description("List bundled starter templates")
    .option("--category <category>", "Only show templates in this category")
    .option("--json", "Output as JSON array")
    .action((options) => {
      let templates = listTemplates();
      if (options.category) {
        templates = templates.filter((template) => template.category === options.category);
        if (templates.length === 0) {
          console.log(chalk.yellow(`No templates in category "${options.category}".`));
          return;
        }
      }

      if (options.json) {
        console.log(
          JSON.stringify(
            templates.map(({ id, category, name, description, tags }) => ({
              id, category, name, description, tags
            })),
            null,
            2
          )
        );
        return;
      }

      console.log(formatTemplateCatalog(templates));
    });

  command
    .command("show <id>")
    .description("Print a template's YAML (e.g. auth/login-flow)")
    .action((id: string) => {
      try {
        process.stdout.write(readTemplate(id));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Show failed";
        console.error(chalk.red(`Error: ${message}`));
        process.exitCode = 1;
      }
    });

  return command;
}
