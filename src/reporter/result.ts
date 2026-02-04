import fs from "node:fs";
import path from "node:path";
import type { RunResult } from "../types/index.js";

export function writeResult(runDir: string, result: RunResult): string {
  const fileName = "result.json";
  const fullPath = path.join(runDir, fileName);
  fs.writeFileSync(fullPath, JSON.stringify(result, null, 2));
  return fileName;
}
