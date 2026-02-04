import fs from "node:fs";
import path from "node:path";
import type { AssertionResult, RunResult, StepResult } from "../types/index.js";

function formatStep(step: StepResult): string {
  const base = `- [${step.status.toUpperCase()}] ${step.type} (${step.durationMs}ms)`;
  const selector = step.selector ? ` selector=${step.selector}` : "";
  const value = step.value ? ` value=${step.value}` : "";
  const error = step.error ? ` error=${step.error}` : "";
  return `${base}${selector}${value}${error}`;
}

function formatAssertion(assertion: AssertionResult): string {
  const value = assertion.value !== undefined ? ` value=${assertion.value}` : "";
  const error = assertion.error ? ` error=${assertion.error}` : "";
  return `- [${assertion.status.toUpperCase()}] ${assertion.type}${value}${error}`;
}

export function writeSummary(runDir: string, result: RunResult): string {
  const lines: string[] = [];
  lines.push("# ProwlAI Run Summary");
  lines.push("");
  lines.push(`Status: ${result.status.toUpperCase()}`);
  lines.push(`Goal: ${result.goal}`);
  lines.push(`Target: ${result.targetUrl}`);
  lines.push(`Started: ${result.startedAt}`);
  lines.push(`Duration: ${result.durationMs}ms`);
  lines.push("");
  lines.push("## Steps");
  for (const step of result.steps) {
    lines.push(formatStep(step));
  }
  lines.push("");
  lines.push("## Assertions");
  for (const assertion of result.assertions) {
    lines.push(formatAssertion(assertion));
  }
  lines.push("");
  lines.push("## Artifacts");
  const artifacts = result.artifacts;
  if (artifacts.summary) {
    lines.push(`- summary: ${artifacts.summary}`);
  }
  if (artifacts.console) {
    lines.push(`- console: ${artifacts.console}`);
  }
  if (artifacts.trace) {
    lines.push(`- trace: ${artifacts.trace}`);
  }
  if (artifacts.networkHar) {
    lines.push(`- network: ${artifacts.networkHar}`);
  }
  if (artifacts.screenshots && artifacts.screenshots.length > 0) {
    for (const screenshot of artifacts.screenshots) {
      lines.push(`- screenshot: ${screenshot}`);
    }
  }

  const fileName = "summary.md";
  const fullPath = path.join(runDir, fileName);
  fs.writeFileSync(fullPath, `${lines.join("\n")}\n`);
  return fileName;
}
