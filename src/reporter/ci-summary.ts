import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";

export type CiHuntResult = {
  hunt: string;
  status: "pass" | "fail" | "skipped";
  durationMs: number;
  runDir?: string;
  error?: string;
};

export type CiResult = {
  status: "pass" | "fail";
  startedAt: string;
  durationMs: number;
  totalHunts: number;
  passed: number;
  failed: number;
  skipped: number;
  hunts: CiHuntResult[];
};

export function printCiSummary(results: CiHuntResult[], totalDurationMs: number): void {
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skipped").length;

  const lineWidth = 45;
  console.log(`\n  ── CI Summary ${"─".repeat(lineWidth - 15)}`);

  for (const r of results) {
    const icon = r.status === "pass" ? chalk.green("✓") : r.status === "fail" ? chalk.red("✗") : chalk.yellow("○");
    const name = r.status === "fail" ? chalk.red(r.hunt) : r.status === "skipped" ? chalk.yellow(r.hunt) : r.hunt;
    const duration = r.status === "skipped" ? "" : chalk.gray(`(${r.durationMs}ms)`);
    const pad = " ".repeat(Math.max(1, 40 - r.hunt.length));
    console.log(`  ${icon} ${name}${pad}${duration}`);
  }

  console.log(`  ${"─".repeat(lineWidth)}`);

  const parts: string[] = [];
  if (passed > 0) parts.push(chalk.green(`${passed} passed`));
  if (failed > 0) parts.push(chalk.red(`${failed} failed`));
  if (skipped > 0) parts.push(chalk.yellow(`${skipped} skipped`));
  parts.push(chalk.gray(`(${totalDurationMs}ms)`));

  console.log(`  ${parts.join("  ")}`);
}

export function writeCiResult(ciRunDir: string, results: CiHuntResult[], startedAt: string, totalDurationMs: number): string {
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skipped").length;

  const ciResult: CiResult = {
    status: failed > 0 ? "fail" : "pass",
    startedAt,
    durationMs: totalDurationMs,
    totalHunts: results.length,
    passed,
    failed,
    skipped,
    hunts: results
  };

  fs.mkdirSync(ciRunDir, { recursive: true });
  const filePath = path.join(ciRunDir, "ci-result.json");
  fs.writeFileSync(filePath, JSON.stringify(ciResult, null, 2) + "\n");
  return filePath;
}
