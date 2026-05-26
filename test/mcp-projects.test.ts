import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  loadProjectRegistry,
  resolveProject,
  resolveRegistryPath,
  listRegisteredProjects
} from "../src/mcp/projects.js";

let tmpDir: string;
let registryPath: string;
const savedEnv = process.env.PROWLQA_PROJECTS;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-projects-test-"));
  registryPath = path.join(tmpDir, "projects.yml");
  delete process.env.PROWLQA_PROJECTS;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (savedEnv === undefined) delete process.env.PROWLQA_PROJECTS;
  else process.env.PROWLQA_PROJECTS = savedEnv;
});

function writeRegistry(body: string): void {
  fs.writeFileSync(registryPath, body);
}

describe("loadProjectRegistry", () => {
  it("loads and validates a registry file", () => {
    writeRegistry("projects:\n  coupe:\n    root: /repos/coupe\n  store:\n    root: /repos/store\n    configPath: /custom/config.yml\n");
    const registry = loadProjectRegistry(registryPath);
    expect(registry?.projects.coupe.root).toBe("/repos/coupe");
    expect(registry?.projects.store.configPath).toBe("/custom/config.yml");
    expect(registry?.registryPath).toBe(registryPath);
  });

  it("throws when an explicitly named registry file is missing", () => {
    expect(() => loadProjectRegistry(path.join(tmpDir, "nope.yml"))).toThrow("Project registry not found");
  });

  it("rejects an unknown field", () => {
    writeRegistry("projects:\n  coupe:\n    root: /repos/coupe\n    bogus: true\n");
    expect(() => loadProjectRegistry(registryPath)).toThrow();
  });
});

describe("resolveRegistryPath", () => {
  it("prefers an explicit path over the env var", () => {
    process.env.PROWLQA_PROJECTS = "/from/env.yml";
    expect(resolveRegistryPath("/explicit/reg.yml")).toBe(path.resolve("/explicit/reg.yml"));
  });

  it("falls back to the env var when no explicit path is given", () => {
    process.env.PROWLQA_PROJECTS = "/from/env.yml";
    expect(resolveRegistryPath()).toBe(path.resolve("/from/env.yml"));
  });
});

describe("resolveProject", () => {
  const registry = {
    registryPath: "/cfg/projects.yml",
    projects: { coupe: { root: "/repos/coupe" }, store: { root: "/repos/store", configPath: "/custom/config.yml" } }
  };

  it("defaults configPath to <root>/.prowlqa/config.yml", () => {
    expect(resolveProject(registry, "coupe")).toEqual({
      name: "coupe",
      root: "/repos/coupe",
      configPath: "/repos/coupe/.prowlqa/config.yml"
    });
  });

  it("honors an explicit per-project configPath", () => {
    expect(resolveProject(registry, "store").configPath).toBe("/custom/config.yml");
  });

  it("throws a helpful error for an unknown project", () => {
    expect(() => resolveProject(registry, "ghost")).toThrow('Unknown project "ghost". Registered projects: coupe, store');
  });
});

describe("listRegisteredProjects", () => {
  it("returns name/root pairs, or empty for a null registry", () => {
    expect(listRegisteredProjects(null)).toEqual([]);
    expect(
      listRegisteredProjects({ registryPath: "/x", projects: { a: { root: "/r/a" } } })
    ).toEqual([{ name: "a", root: "/r/a" }]);
  });
});
