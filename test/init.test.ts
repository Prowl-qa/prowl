import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { buildInitCommand } from "../src/cli/commands/init.js";

describe("prowlqa init", () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-init-"));
    originalCwd = process.cwd();
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function runInit(args: string[] = []) {
    const cmd = buildInitCommand();
    cmd.parse(["node", "prowlqa", ...args]);
  }

  it("creates .prowlqa directory with config, example hunt, and .gitignore", () => {
    runInit();

    const prowlqaDir = path.join(tempDir, ".prowlqa");
    expect(fs.existsSync(path.join(prowlqaDir, "config.yml"))).toBe(true);
    expect(fs.existsSync(path.join(prowlqaDir, "hunts", "homepage.yml"))).toBe(true);
    expect(fs.existsSync(path.join(prowlqaDir, ".gitignore"))).toBe(true);
  });

  it(".gitignore ignores runs, auth-state.json, and .env", () => {
    runInit();

    const gitignore = fs.readFileSync(
      path.join(tempDir, ".prowlqa", ".gitignore"),
      "utf-8",
    );
    expect(gitignore).toContain("runs/");
    expect(gitignore).toContain("auth-state.json");
    expect(gitignore).toContain(".env");
  });

  it(".gitignore does not ignore hunts or config", () => {
    runInit();

    const gitignore = fs.readFileSync(
      path.join(tempDir, ".prowlqa", ".gitignore"),
      "utf-8",
    );
    expect(gitignore).not.toContain("hunts");
    expect(gitignore).not.toContain("config");
  });

  it("--force recreates .prowlqa including .gitignore", () => {
    runInit();

    // Remove .gitignore to simulate old init without it
    fs.unlinkSync(path.join(tempDir, ".prowlqa", ".gitignore"));
    expect(fs.existsSync(path.join(tempDir, ".prowlqa", ".gitignore"))).toBe(false);

    runInit(["--force"]);
    expect(fs.existsSync(path.join(tempDir, ".prowlqa", ".gitignore"))).toBe(true);
  });

  it("shows non-destructive guidance when .prowlqa exists without --force", () => {
    runInit();
    const originalExitCode = process.exitCode;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      process.exitCode = undefined;
      runInit();

      expect(process.exitCode).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("without deleting existing files")
      );
    } finally {
      process.exitCode = originalExitCode;
      errorSpy.mockRestore();
    }
  });

  it("--force preserves user-created files not in templates", () => {
    runInit();

    // Create a user-owned file inside .prowlqa
    const userFile = path.join(tempDir, ".prowlqa", "my-notes.txt");
    fs.writeFileSync(userFile, "user data");

    // Create a user-owned hunt file
    const userHunt = path.join(tempDir, ".prowlqa", "hunts", "my-custom.yml");
    fs.writeFileSync(userHunt, "steps:\n  - navigate: /custom");

    runInit(["--force"]);

    // User files should still exist
    expect(fs.existsSync(userFile)).toBe(true);
    expect(fs.readFileSync(userFile, "utf-8")).toBe("user data");
    expect(fs.existsSync(userHunt)).toBe(true);
    expect(fs.readFileSync(userHunt, "utf-8")).toBe("steps:\n  - navigate: /custom");

    // Template files should be refreshed
    expect(fs.existsSync(path.join(tempDir, ".prowlqa", "config.yml"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, ".prowlqa", ".gitignore"))).toBe(true);
  });
});
