import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureAllowedDomain, loadConfig, loadHunt } from "../src/config/loader.js";

function setupTempProject(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-"));
  const prowlDir = path.join(tmpDir, ".prowl");
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
    process.chdir(project);

    const { config } = loadConfig();
    expect(config.target.url).toBe("http://example.com");
    expect(config.browser.timeout).toBe(30000);
    expect(config.guardrails.allowedDomains).toContain("example.com");
    expect(config.assertions.networkIgnorePatterns).toEqual([]);

    process.chdir(cwd);
    fs.rmSync(project, { recursive: true, force: true });
  });
});

describe("loadHunt", () => {
  it("loads a hunt file", () => {
    const project = setupTempProject();
    const cwd = process.cwd();
    process.chdir(project);

    const { configDir } = loadConfig();
    const hunt = loadHunt("sample", configDir);
    expect(hunt.steps.length).toBe(1);

    process.chdir(cwd);
    fs.rmSync(project, { recursive: true, force: true });
  });

  it("rejects invalid hunt names", () => {
    const project = setupTempProject();
    const cwd = process.cwd();
    process.chdir(project);

    const { configDir } = loadConfig();
    expect(() => loadHunt("../secrets", configDir)).toThrow("Invalid hunt name");

    process.chdir(cwd);
    fs.rmSync(project, { recursive: true, force: true });
  });

  it("loads a hunt from a subfolder", () => {
    const project = setupTempProject();
    const cwd = process.cwd();
    process.chdir(project);

    const prowlDir = path.join(project, ".prowl");
    fs.mkdirSync(path.join(prowlDir, "hunts", "admin"), { recursive: true });
    fs.writeFileSync(
      path.join(prowlDir, "hunts", "admin", "users-crud.yml"),
      "steps:\n  - navigate: '/admin/users'\n"
    );

    const { configDir } = loadConfig();
    const hunt = loadHunt("admin/users-crud", configDir);
    expect(hunt.steps.length).toBe(1);

    process.chdir(cwd);
    fs.rmSync(project, { recursive: true, force: true });
  });
});

describe("ensureAllowedDomain", () => {
  it("adds host if missing", () => {
    const allowed = ensureAllowedDomain(["localhost"], "http://example.com");
    expect(allowed).toContain("example.com");
  });
});
