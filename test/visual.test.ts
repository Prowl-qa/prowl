import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { compareScreenshots, ensureBaselineDir } from "../src/runner/visual.js";

function createPng(width: number, height: number, color: [number, number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) << 2;
      png.data[idx] = color[0];
      png.data[idx + 1] = color[1];
      png.data[idx + 2] = color[2];
      png.data[idx + 3] = color[3];
    }
  }
  return PNG.sync.write(png);
}

describe("compareScreenshots", () => {
  it("identical images match", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-visual-"));
    const baselinePath = path.join(dir, "baseline.png");
    const currentPath = path.join(dir, "current.png");
    const diffPath = path.join(dir, "diff.png");

    const image = createPng(10, 10, [255, 0, 0, 255]);
    fs.writeFileSync(baselinePath, image);
    fs.writeFileSync(currentPath, image);

    const result = await compareScreenshots(baselinePath, currentPath, diffPath, 0.1);
    expect(result.match).toBe(true);
    expect(result.diffPercentage).toBe(0);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("different images produce diff", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-visual-"));
    const baselinePath = path.join(dir, "baseline.png");
    const currentPath = path.join(dir, "current.png");
    const diffPath = path.join(dir, "diff.png");

    fs.writeFileSync(baselinePath, createPng(10, 10, [255, 0, 0, 255]));
    fs.writeFileSync(currentPath, createPng(10, 10, [0, 0, 255, 255]));

    const result = await compareScreenshots(baselinePath, currentPath, diffPath, 0.1);
    expect(result.match).toBe(false);
    expect(result.diffPercentage).toBeGreaterThan(0);
    expect(fs.existsSync(diffPath)).toBe(true);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("threshold controls sensitivity", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-visual-"));
    const baselinePath = path.join(dir, "baseline.png");
    const currentPath = path.join(dir, "current.png");
    const diffPath = path.join(dir, "diff.png");

    // Create images that are mostly the same with a small difference
    const baseline = new PNG({ width: 100, height: 100 });
    const current = new PNG({ width: 100, height: 100 });
    for (let y = 0; y < 100; y++) {
      for (let x = 0; x < 100; x++) {
        const idx = (100 * y + x) << 2;
        baseline.data[idx] = 128;
        baseline.data[idx + 1] = 128;
        baseline.data[idx + 2] = 128;
        baseline.data[idx + 3] = 255;
        current.data[idx] = 128;
        current.data[idx + 1] = 128;
        current.data[idx + 2] = 128;
        current.data[idx + 3] = 255;
      }
    }
    // Change 5 pixels
    for (let i = 0; i < 5; i++) {
      const idx = i << 2;
      current.data[idx] = 255;
    }

    fs.writeFileSync(baselinePath, PNG.sync.write(baseline));
    fs.writeFileSync(currentPath, PNG.sync.write(current));

    // With a high threshold, this should match
    const lenient = await compareScreenshots(baselinePath, currentPath, diffPath, 0.5);
    expect(lenient.match).toBe(true);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("different dimensions fail", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-visual-"));
    const baselinePath = path.join(dir, "baseline.png");
    const currentPath = path.join(dir, "current.png");
    const diffPath = path.join(dir, "diff.png");

    fs.writeFileSync(baselinePath, createPng(10, 10, [255, 0, 0, 255]));
    fs.writeFileSync(currentPath, createPng(20, 20, [255, 0, 0, 255]));

    const result = await compareScreenshots(baselinePath, currentPath, diffPath, 0.1);
    expect(result.match).toBe(false);
    expect(result.diffPercentage).toBe(1);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("ensureBaselineDir", () => {
  it("creates baselines directory", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-visual-"));
    const baselineDir = ensureBaselineDir(dir);
    expect(fs.existsSync(baselineDir)).toBe(true);
    expect(baselineDir).toBe(path.join(dir, "baselines"));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
