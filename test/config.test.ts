import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureAllowedDomain, loadConfig, loadHunt } from "../src/config/loader.js";

function setupTempProject(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-"));
  const prowlDir = path.join(tmpDir, ".prowlqa");
  fs.mkdirSync(path.join(prowlDir, "hunts"), { recursive: true });

  fs.writeFileSync(
    path.join(prowlDir, "config.yml"),
    "target:\n  url: 'http://example.com'\n"
  );

  fs.writeFileSync(
    path.join(prowlDir, "hunts", "sample.yml"),
    "steps:\n  - navigate: '/'\n"
  );

  return tmpDir;
}

describe("loadConfig", () => {
  it("loads config with defaults and allowed domain", () => {
    const project = setupTempProject();
    const cwd = process.cwd();
    try {
      process.chdir(project);

      const { config } = loadConfig();
      expect(config.target.url).toBe("http://example.com");
      expect(config.browser.timeout).toBe(30000);
      expect(config.guardrails.allowedDomains).toContain("example.com");
      expect(config.assertions.networkIgnorePatterns).toEqual([]);
    } finally {
      process.chdir(cwd);
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
});

describe("loadHunt", () => {
  it("loads a hunt file", () => {
    const project = setupTempProject();
    const cwd = process.cwd();
    try {
      process.chdir(project);

      const { configDir } = loadConfig();
      const hunt = loadHunt("sample", configDir);
      expect(hunt.steps.length).toBe(1);
    } finally {
      process.chdir(cwd);
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("rejects invalid hunt names", () => {
    const project = setupTempProject();
    const cwd = process.cwd();
    try {
      process.chdir(project);

      const { configDir } = loadConfig();
      expect(() => loadHunt("../secrets", configDir)).toThrow("Invalid hunt name");
    } finally {
      process.chdir(cwd);
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("loads a hunt from a subfolder", () => {
    const project = setupTempProject();
    const cwd = process.cwd();
    try {
      process.chdir(project);

      const prowlDir = path.join(project, ".prowlqa");
      fs.mkdirSync(path.join(prowlDir, "hunts", "admin"), { recursive: true });
      fs.writeFileSync(
        path.join(prowlDir, "hunts", "admin", "users-crud.yml"),
        "steps:\n  - navigate: '/admin/users'\n"
      );

      const { configDir } = loadConfig();
      const hunt = loadHunt("admin/users-crud", configDir);
      expect(hunt.steps.length).toBe(1);
    } finally {
      process.chdir(cwd);
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
});

describe("ensureAllowedDomain", () => {
  it("adds host if missing", () => {
    const allowed = ensureAllowedDomain(["localhost"], "http://example.com");
    expect(allowed).toContain("example.com");
  });
});

describe("loadConfig history", () => {
  it("defaults history.maxRuns to 100 when not set", () => {
    const project = setupTempProject();
    const cwd = process.cwd();
    try {
      process.chdir(project);

      const { config } = loadConfig();
      expect(config.history.maxRuns).toBe(100);
    } finally {
      process.chdir(cwd);
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("respects history.maxRuns override from config.yml", () => {
    const project = setupTempProject();
    const cwd = process.cwd();
    try {
      process.chdir(project);

      fs.writeFileSync(
        path.join(project, ".prowlqa", "config.yml"),
        "target:\n  url: 'http://example.com'\nhistory:\n  maxRuns: 25\n"
      );

      const { config } = loadConfig();
      expect(config.history.maxRuns).toBe(25);
    } finally {
      process.chdir(cwd);
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("rejects history.maxRuns that is not a positive integer", () => {
    const project = setupTempProject();
    const cwd = process.cwd();
    try {
      process.chdir(project);

      fs.writeFileSync(
        path.join(project, ".prowlqa", "config.yml"),
        "target:\n  url: 'http://example.com'\nhistory:\n  maxRuns: 0\n"
      );

      expect(() => loadConfig()).toThrow();
    } finally {
      process.chdir(cwd);
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
});
