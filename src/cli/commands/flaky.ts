import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "../../config/loader.js";
import { rankFlaky, DEFAULT_FLAKY_THRESHOLD, type FlakyScore } from "../../runner/flaky.js";

export function buildFlakyCommand(): Command {
  const command = new Command("flaky")
    .description("Rank hunts by flake score (pass/fail oscillation) from run history")
    .option("--config <path>", "Custom config path")
    .option("--limit <n>", "Only score the most recent N runs per hunt", (value) => {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1) {
        throw new Error("--limit must be a positive integer");
      }
      return n;
    })
    .option("--threshold <value>", "Flaky threshold 0-1 (overrides config)", (value) => {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0 || n > 1) {
        throw new Error("--threshold must be a number between 0 and 1");
      }
      return n;
    })
    .option("--json", "Output as JSON")
    .action((options) => {
      try {
        const { config, configDir } = loadConfig(options.config);
        const threshold =
          (options.threshold as number | undefined) ??
          config.reliability?.flakyThreshold ??
          DEFAULT_FLAKY_THRESHOLD;

        const scores = rankFlaky(configDir, {
          lastN: options.limit as number | undefined,
          threshold
        });

        if (options.json) {
          console.log(JSON.stringify(scores, null, 2));
          return;
        }

        if (scores.length === 0) {
          console.log(
            chalk.yellow(
              "\n  No run history found. Run hunts with `prowlqa run` or `prowlqa ci` first.\n"
            )
          );
          return;
        }

        console.log();
        console.log(`  ${chalk.bold("Flake scores")} (threshold ${threshold})`);
        console.log();
        console.log(formatTable(scores));
        console.log();
      } catch (error) {
        const message = error instanceof Error ? error.message : "flaky failed";
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

function formatTable(scores: FlakyScore[]): string {
  const headers = ["Hunt", "Score", "Runs", "Flaky"];
  const rows = scores.map((s) => [
    s.hunt,
    s.score.toFixed(2),
    String(s.runs),
    s.flaky ? chalk.red("yes") : chalk.green("no")
  ]);

  const widths = headers.map((header, index) =>
    Math.max(stripAnsi(header).length, ...rows.map((row) => stripAnsi(row[index]).length))
  );

  const headerLine = `  ${headers.map((h, i) => pad(h, widths[i])).join("  ")}`;
  const rule = `  ${widths.map((w) => "-".repeat(w)).join("  ")}`;
  const body = rows
    .map((row) => `  ${row.map((cell, i) => pad(cell, widths[i])).join("  ")}`)
    .join("\n");

  return `${headerLine}\n${rule}\n${body}`;
}

function pad(value: string, width: number): string {
  const bareLength = stripAnsi(value).length;
  return bareLength >= width ? value : `${value}${" ".repeat(width - bareLength)}`;
}

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}
