import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listHunts } from "../src/config/loader.js";

describe("listHunts", () => {
  it("lists hunt files in alphabetical order", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-list-"));
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
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-list-"));
    try {
      const hunts = listHunts(tempDir);
      expect(hunts).toEqual([]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("lists hunts from subfolders with path prefix", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-list-"));
    try {
      const huntsDir = path.join(tempDir, "hunts");
      fs.mkdirSync(path.join(huntsDir, "admin"), { recursive: true });

      fs.writeFileSync(path.join(huntsDir, "homepage.yml"), "steps:\n  - navigate: '/'\n");
      fs.writeFileSync(path.join(huntsDir, "admin", "users-crud.yml"), "steps:\n  - navigate: '/'\n");
      fs.writeFileSync(path.join(huntsDir, "admin", "company-edit.yml"), "steps:\n  - navigate: '/'\n");

      const hunts = listHunts(tempDir);
      expect(hunts).toEqual(["admin/company-edit", "admin/users-crud", "homepage"]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("throws when hunts path is not a directory", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-list-"));
    try {
      const huntsPath = path.join(tempDir, "hunts");
      fs.writeFileSync(huntsPath, "not a directory");
      expect(() => listHunts(tempDir)).toThrow(`Hunts path is not a directory: ${huntsPath}`);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
