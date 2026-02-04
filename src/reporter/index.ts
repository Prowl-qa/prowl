import type { RunResult } from "../types/index.js";
import { writeResult } from "./result.js";
import { writeSummary } from "./summary.js";

export function writeReports(runDir: string, result: RunResult): RunResult {
  const summary = writeSummary(runDir, result);
  const updated: RunResult = {
    ...result,
    artifacts: {
      ...result.artifacts,
      summary
    }
  };

  writeResult(runDir, updated);

  return updated;
}
