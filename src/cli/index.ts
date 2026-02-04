#!/usr/bin/env node
import { Command } from "commander";
import { buildRunCommand } from "./commands/run.js";
import { buildInitCommand } from "./commands/init.js";
import { buildLoginCommand } from "./commands/login.js";

const program = new Command();

program
  .name("prowlai")
  .description("CLI-first QA testing tool for deterministic Playwright flows")
  .version("0.1.0");

program.addCommand(buildRunCommand());
program.addCommand(buildInitCommand());
program.addCommand(buildLoginCommand());

program.parseAsync(process.argv).catch((error) => {
  const message = error instanceof Error ? error.message : "Command failed";
  console.error(message);
  process.exit(1);
});
