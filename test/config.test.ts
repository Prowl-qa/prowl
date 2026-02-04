import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureAllowedDomain, loadConfig, loadGoal } from "../src/config/loader.js";

function setupTempProject(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-"));
  const prowlDir = path.join(tmpDir, ".prowl");
  fs.mkdirSync(path.join(prowlDir, "goals"), { recursive: true });

  fs.writeFileSync(
    path.join(prowlDir, "config.yml"),
    "target:\n  url: 'http://example.com'\n"
  );

  fs.writeFileSync(
    path.join(prowlDir, "goals", "sample.yml"),
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

    process.chdir(cwd);
    fs.rmSync(project, { recursive: true, force: true });
  });
});

describe("loadGoal", () => {
  it("loads a goal file", () => {
    const project = setupTempProject();
    const cwd = process.cwd();
    process.chdir(project);

    const { configDir } = loadConfig();
    const goal = loadGoal("sample", configDir);
    expect(goal.steps.length).toBe(1);

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
