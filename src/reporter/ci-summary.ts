import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import type { CiHuntResult, CiResult, CiStatus } from "../types/index.js";

export type CiCounts = {
  passed: number;
  failed: number;
  skipped: number;
};

export function countCiResults(results: CiHuntResult[]): CiCounts {
  return {
    passed: results.filter((r) => r.status === "pass").length,
    failed: results.filter((r) => r.status === "fail").length,
    skipped: results.filter((r) => r.status === "skipped").length
  };
}

export function resolveCiStatus(results: CiHuntResult[]): CiStatus {
  if (results.length === 0) return "no-hunts";
  const { failed, passed } = countCiResults(results);
  if (failed > 0) return "fail";
  if (passed > 0) return "pass";
  return "all-skipped";
}

export function printCiSummary(results: CiHuntResult[], totalDurationMs: number): void {
  const { passed, failed, skipped } = countCiResults(results);

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
  const { passed, failed, skipped } = countCiResults(results);

  const ciResult: CiResult = {
    status: resolveCiStatus(results),
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
