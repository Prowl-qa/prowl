import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
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
    expect(fs.existsSync(path.join(prowlDir, "hunts", "hello.yml"))).toBe(true);
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

  it("shows non-destructive guidance when .prowl exists without --force", () => {
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
  describe("--template", () => {
    it("scaffolds a fresh project and adds the requested template", () => {
      runInit(["--template", "auth/login-flow"]);

      const hunts = path.join(tempDir, ".prowl", "hunts");
      expect(fs.existsSync(path.join(tempDir, ".prowl", "config.yml"))).toBe(true);
      expect(fs.existsSync(path.join(hunts, "hello.yml"))).toBe(true);
      expect(fs.readFileSync(path.join(hunts, "login-flow.yml"), "utf-8")).toContain(
        "name: login-flow"
      );
    });

    it("accepts several ids at once", () => {
      runInit(["--template", "auth/login-flow", "smoke/homepage"]);

      const hunts = path.join(tempDir, ".prowl", "hunts");
      expect(fs.existsSync(path.join(hunts, "login-flow.yml"))).toBe(true);
      expect(fs.existsSync(path.join(hunts, "homepage.yml"))).toBe(true);
    });

    it("adds a template to an already-initialized project without --force", () => {
      runInit();
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        runInit(["--template", "e-commerce/checkout-flow"]);
        expect(errorSpy).not.toHaveBeenCalled();
        expect(process.exitCode ?? 0).toBe(0);
      } finally {
        errorSpy.mockRestore();
      }
      expect(
        fs.existsSync(path.join(tempDir, ".prowl", "hunts", "checkout-flow.yml"))
      ).toBe(true);
    });

    it("refuses to overwrite an existing hunt of the same name without --force", () => {
      runInit();
      const target = path.join(tempDir, ".prowl", "hunts", "login-flow.yml");
      fs.writeFileSync(target, "steps:\n  - navigate: /mine");
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const originalExitCode = process.exitCode;
      try {
        process.exitCode = undefined;
        runInit(["--template", "auth/login-flow"]);
        expect(process.exitCode).toBe(1);
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("--force"));
        expect(fs.readFileSync(target, "utf-8")).toBe("steps:\n  - navigate: /mine");

        process.exitCode = undefined;
        runInit(["--template", "auth/login-flow", "--force"]);
        expect(fs.readFileSync(target, "utf-8")).toContain("name: login-flow");
      } finally {
        process.exitCode = originalExitCode;
        errorSpy.mockRestore();
      }
    });

    it("writes nothing when any requested id is unknown", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const originalExitCode = process.exitCode;
      try {
        process.exitCode = undefined;
        runInit(["--template", "auth/login-flow", "auth/not-a-template"]);
        expect(process.exitCode).toBe(1);
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("prowl templates list"));
        expect(fs.existsSync(path.join(tempDir, ".prowl"))).toBe(false);
      } finally {
        process.exitCode = originalExitCode;
        errorSpy.mockRestore();
      }
    });

    it("--list-templates prints the catalog and does not initialize", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        runInit(["--list-templates"]);
        expect(logSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("auth/login-flow");
      } finally {
        logSpy.mockRestore();
      }
      expect(fs.existsSync(path.join(tempDir, ".prowl"))).toBe(false);
    });
  });
});
