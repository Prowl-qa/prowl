import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listGoals } from "../src/config/loader.js";

describe("listGoals", () => {
  it("lists goal files in alphabetical order", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-list-"));
    try {
      const goalsDir = path.join(tempDir, "goals");
      fs.mkdirSync(goalsDir, { recursive: true });

      fs.writeFileSync(path.join(goalsDir, "b.yml"), "steps:\n  - navigate: '/'\n");
      fs.writeFileSync(path.join(goalsDir, "a.yml"), "steps:\n  - navigate: '/'\n");
      fs.writeFileSync(path.join(goalsDir, "note.txt"), "ignore");

      const goals = listGoals(tempDir);
      expect(goals).toEqual(["a", "b"]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("returns empty list when no goals directory", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-list-"));
    try {
      const goals = listGoals(tempDir);
      expect(goals).toEqual([]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("throws when goals path is not a directory", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-list-"));
    try {
      const goalsPath = path.join(tempDir, "goals");
      fs.writeFileSync(goalsPath, "not a directory");
      expect(() => listGoals(tempDir)).toThrow(`Goals path is not a directory: ${goalsPath}`);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
