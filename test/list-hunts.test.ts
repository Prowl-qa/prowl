import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listHunts } from "../src/config/loader.js";

describe("listHunts", () => {
  it("lists hunt files in alphabetical order", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-list-"));
    try {
      const huntsDir = path.join(tempDir, "hunts");
      fs.mkdirSync(huntsDir, { recursive: true });

      fs.writeFileSync(path.join(huntsDir, "b.yml"), "steps:\n  - navigate: '/'\n");
      fs.writeFileSync(path.join(huntsDir, "a.yml"), "steps:\n  - navigate: '/'\n");
      fs.writeFileSync(path.join(huntsDir, "note.txt"), "ignore");

      const hunts = listHunts(tempDir);
      expect(hunts).toEqual(["a", "b"]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("returns empty list when no hunts directory", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-list-"));
    try {
      const hunts = listHunts(tempDir);
      expect(hunts).toEqual([]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("throws when hunts path is not a directory", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-list-"));
    try {
      const huntsPath = path.join(tempDir, "hunts");
      fs.writeFileSync(huntsPath, "not a directory");
      expect(() => listHunts(tempDir)).toThrow(`Hunts path is not a directory: ${huntsPath}`);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
