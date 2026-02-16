import type { RunResult } from "../types/index.js";
import { writeResult } from "./result.js";
import { writeSummary } from "./summary.js";
import { writeJunit } from "./junit.js";

export type ReportOptions = {
  junit?: boolean;
};

export function writeReports(runDir: string, result: RunResult, options?: ReportOptions): RunResult {
  const summary = writeSummary(runDir, result);
  const updated: RunResult = {
    ...result,
    artifacts: {
      ...result.artifacts,
      summary
    }
  };

  if (options?.junit) {
    updated.artifacts.junit = writeJunit(runDir, updated);
  }

  writeResult(runDir, updated);

  return updated;
}
