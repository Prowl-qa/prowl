import fs from "node:fs";
import path from "node:path";
import type { RunResult } from "../types/index.js";

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function writeJunit(runDir: string, result: RunResult): string {
  const totalTests = result.steps.length + result.assertions.length;
  const failures =
    result.steps.filter((s) => s.status === "fail").length +
    result.assertions.filter((a) => a.status === "fail").length;
  const timeSeconds = (result.durationMs / 1000).toFixed(3);
  const huntName = escapeXml(result.hunt);

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push("<testsuites>");
  lines.push(
    `  <testsuite name="${huntName}" tests="${totalTests}" failures="${failures}" errors="0" time="${timeSeconds}" timestamp="${escapeXml(result.startedAt)}">`
  );

  for (let i = 0; i < result.steps.length; i++) {
    const step = result.steps[i];
    const stepTime = (step.durationMs / 1000).toFixed(3);
    const caseName = escapeXml(`step ${i + 1}: ${step.type}`);

    if (step.status === "fail" && step.error) {
      lines.push(`    <testcase name="${caseName}" classname="${huntName}" time="${stepTime}">`);
      lines.push(`      <failure message="${escapeXml(step.error)}" type="step">${escapeXml(step.error)}</failure>`);
      lines.push("    </testcase>");
    } else {
      lines.push(`    <testcase name="${caseName}" classname="${huntName}" time="${stepTime}"/>`);
    }
  }

  for (const assertion of result.assertions) {
    const caseName = escapeXml(`assertion: ${assertion.type}`);

    if (assertion.status === "fail" && assertion.error) {
      lines.push(`    <testcase name="${caseName}" classname="${huntName}" time="0">`);
      lines.push(`      <failure message="${escapeXml(assertion.error)}" type="assertion">${escapeXml(assertion.error)}</failure>`);
      lines.push("    </testcase>");
    } else {
      lines.push(`    <testcase name="${caseName}" classname="${huntName}" time="0"/>`);
    }
  }

  lines.push("  </testsuite>");
  lines.push("</testsuites>");

  const fileName = "junit.xml";
  const fullPath = path.join(runDir, fileName);
  fs.writeFileSync(fullPath, `${lines.join("\n")}\n`);
  return fileName;
}
