import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "../../config/loader.js";
import { readHuntHistory } from "../../runner/history.js";
import type { HistoryEntry } from "../../types/index.js";

export function buildHistoryCommand(): Command {
  const command = new Command("history")
    .argument("<hunt-name>", "Hunt name or path (e.g. homepage or admin/users-crud)")
    .description("Show run history for a hunt")
    .option("--config <path>", "Custom config path")
    .option("--limit <n>", "Show the last N runs (default: 20)", (value) => {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1) {
        throw new Error("--limit must be a positive integer");
      }
      return n;
    })
    .option("--json", "Output as JSON")
    .action((huntName: string, options) => {
      try {
        const { configDir } = loadConfig(options.config);
        const entries = readHuntHistory(configDir, huntName);
        const limit = (options.limit as number | undefined) ?? 20;
        const recent = entries.slice(-limit);

        if (options.json) {
          console.log(JSON.stringify(recent, null, 2));
          return;
        }

        if (recent.length === 0) {
          console.log(
            chalk.yellow(
              `\n  No history found for "${huntName}". Run it at least once with \`prowlqa run ${huntName}\`.\n`
            )
          );
          return;
        }

        console.log();
        console.log(`  ${chalk.bold(huntName)} — last ${recent.length} of ${entries.length} runs`);
        console.log();
        console.log(formatTable(recent));
        console.log();
      } catch (error) {
        const message = error instanceof Error ? error.message : "history failed";
        if (options.json) {
          console.log(JSON.stringify({ error: message }));
        } else {
          console.error(chalk.red(`Error: ${message}`));
        }
        process.exitCode = 1;
      }
    });

  return command;
}

function formatTable(entries: HistoryEntry[]): string {
  const headers = ["Status", "Started", "Duration"];
  const rows = entries.map((entry) => [
    formatStatus(entry.status),
    entry.startedAt,
    formatDuration(entry.durationMs)
  ]);

  const widths = headers.map((header, index) =>
    Math.max(
      stripAnsi(header).length,
      ...rows.map((row) => stripAnsi(row[index]).length)
    )
  );

  const headerLine = `  ${headers.map((h, i) => pad(h, widths[i])).join("  ")}`;
  const rule = `  ${widths.map((w) => "-".repeat(w)).join("  ")}`;
  const body = rows
    .map((row) => `  ${row.map((cell, i) => pad(cell, widths[i])).join("  ")}`)
    .join("\n");

  return `${headerLine}\n${rule}\n${body}`;
}

function formatStatus(status: "pass" | "fail"): string {
  return status === "pass" ? chalk.green("pass") : chalk.red("fail");
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

function pad(value: string, width: number): string {
  const bareLength = stripAnsi(value).length;
  if (bareLength >= width) {
    return value;
  }
  return `${value}${" ".repeat(width - bareLength)}`;
}

function stripAnsi(value: string): string {
  // Remove ANSI color codes so width calculations work with chalk output.
  // Control char escape is intentional; this is the standard ANSI SGR pattern.
  // eslint-disable-next-line no-control-regex
  return value.replace(/\[[0-9;]*m/g, "");
}
