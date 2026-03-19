import { Command } from "commander";
import pkg from "../../package.json";
import { buildRunCommand } from "./commands/run.js";
import { buildInitCommand } from "./commands/init.js";
import { buildLoginCommand } from "./commands/login.js";
import { buildListCommand } from "./commands/list.js";
import { buildWatchCommand } from "./commands/watch.js";
import { buildCiCommand } from "./commands/ci.js";
import { buildUpdateBaselinesCommand } from "./commands/update-baselines.js";
import { buildAnalyzeCommand } from "./commands/analyze.js";
import { buildGenerateCommand } from "./commands/generate.js";

export const CLI_VERSION = pkg.version;

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("prowlqa")
    .description("CLI-first QA testing tool for deterministic Playwright flows")
    .version(CLI_VERSION);

  program.addCommand(buildRunCommand());
  program.addCommand(buildCiCommand());
  program.addCommand(buildWatchCommand());
  program.addCommand(buildInitCommand());
  program.addCommand(buildLoginCommand());
  program.addCommand(buildListCommand());
  program.addCommand(buildUpdateBaselinesCommand());
  program.addCommand(buildAnalyzeCommand());
  program.addCommand(buildGenerateCommand());

  return program;
}
