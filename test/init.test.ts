import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildInitCommand } from "../src/cli/commands/init.js";

describe("prowl init", () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-init-"));
    originalCwd = process.cwd();
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function runInit(args: string[] = []) {
    const cmd = buildInitCommand();
    cmd.parse(["node", "prowl", ...args]);
  }

  it("creates .prowl directory with config, example hunt, and .gitignore", () => {
    runInit();

    const prowlDir = path.join(tempDir, ".prowl");
    expect(fs.existsSync(path.join(prowlDir, "config.yml"))).toBe(true);
    expect(fs.existsSync(path.join(prowlDir, "hunts", "homepage.yml"))).toBe(true);
    expect(fs.existsSync(path.join(prowlDir, ".gitignore"))).toBe(true);
  });

  it(".gitignore ignores runs, auth-state.json, and .env", () => {
    runInit();

    const gitignore = fs.readFileSync(
      path.join(tempDir, ".prowl", ".gitignore"),
      "utf-8",
    );
    expect(gitignore).toContain("runs/");
    expect(gitignore).toContain("auth-state.json");
    expect(gitignore).toContain(".env");
  });

  it(".gitignore does not ignore hunts or config", () => {
    runInit();

    const gitignore = fs.readFileSync(
      path.join(tempDir, ".prowl", ".gitignore"),
      "utf-8",
    );
    expect(gitignore).not.toContain("hunts");
    expect(gitignore).not.toContain("config");
  });

  it("--force recreates .prowl including .gitignore", () => {
    runInit();

    // Remove .gitignore to simulate old init without it
    fs.unlinkSync(path.join(tempDir, ".prowl", ".gitignore"));
    expect(fs.existsSync(path.join(tempDir, ".prowl", ".gitignore"))).toBe(false);

    runInit(["--force"]);
    expect(fs.existsSync(path.join(tempDir, ".prowl", ".gitignore"))).toBe(true);
  });

  it("--force preserves user-created files not in templates", () => {
    runInit();

    // Create a user-owned file inside .prowl
    const userFile = path.join(tempDir, ".prowl", "my-notes.txt");
    fs.writeFileSync(userFile, "user data");

    // Create a user-owned hunt file
    const userHunt = path.join(tempDir, ".prowl", "hunts", "my-custom.yml");
    fs.writeFileSync(userHunt, "steps:\n  - navigate: /custom");

    runInit(["--force"]);

    // User files should still exist
    expect(fs.existsSync(userFile)).toBe(true);
    expect(fs.readFileSync(userFile, "utf-8")).toBe("user data");
    expect(fs.existsSync(userHunt)).toBe(true);
    expect(fs.readFileSync(userHunt, "utf-8")).toBe("steps:\n  - navigate: /custom");

    // Template files should be refreshed
    expect(fs.existsSync(path.join(tempDir, ".prowl", "config.yml"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, ".prowl", ".gitignore"))).toBe(true);
  });
});
