import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

export type ComparisonResult = {
  match: boolean;
  diffPercentage: number;
  diffImagePath?: string;
};

export async function compareScreenshots(
  baselinePath: string,
  currentPath: string,
  diffPath: string,
  threshold: number
): Promise<ComparisonResult> {
  const baselineData = PNG.sync.read(fs.readFileSync(baselinePath));
  const currentData = PNG.sync.read(fs.readFileSync(currentPath));

  const { width, height } = baselineData;

  if (currentData.width !== width || currentData.height !== height) {
    const diff = new PNG({ width, height });
    fs.writeFileSync(diffPath, PNG.sync.write(diff));
    return {
      match: false,
      diffPercentage: 1,
      diffImagePath: diffPath
    };
  }

  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(
    baselineData.data,
    currentData.data,
    diff.data,
    width,
    height,
    { threshold: 0.1 }
  );

  const totalPixels = width * height;
  const diffPercentage = diffPixels / totalPixels;

  fs.writeFileSync(diffPath, PNG.sync.write(diff));

  return {
    match: diffPercentage <= threshold,
    diffPercentage,
    diffImagePath: diffPath
  };
}

export function ensureBaselineDir(configDir: string): string {
  const baselineDir = path.join(configDir, "baselines");
  fs.mkdirSync(baselineDir, { recursive: true });
  return baselineDir;
}
