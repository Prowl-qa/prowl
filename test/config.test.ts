import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ensureAllowedDomain, findConfigPath, loadConfig, loadHunt } from "../src/config/loader.js";
import { normalizeHuntName } from "../src/config/hunt-name.js";

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

      const prowlDir = path.join(project, ".prowl");
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

  it("loads an extensionless nested identity starting with hunts without dropping its prefix", () => {
    const project = setupTempProject();
    const cwd = process.cwd();
    try {
      process.chdir(project);

      const prowlDir = path.join(project, ".prowl");
      fs.mkdirSync(path.join(prowlDir, "hunts", "admin"), { recursive: true });
      fs.mkdirSync(path.join(prowlDir, "hunts", "hunts", "admin"), { recursive: true });
      fs.writeFileSync(
        path.join(prowlDir, "hunts", "admin", "users.yml"),
        "steps:\n  - navigate: '/wrong-hunt'\n"
      );
      fs.writeFileSync(
        path.join(prowlDir, "hunts", "hunts", "admin", "users.yml"),
        "steps:\n  - navigate: '/nested-identity'\n"
      );

      const { configDir } = loadConfig();
      const hunt = loadHunt(normalizeHuntName("hunts/admin/users"), configDir);
      expect(hunt.steps[0]).toEqual({ navigate: "/nested-identity" });
    } finally {
      process.chdir(cwd);
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
});

describe("legacy .prowlqa/ back-compat", () => {
  it("findConfigPath prefers .prowl/ over legacy .prowlqa/", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-both-"));
    try {
      fs.mkdirSync(path.join(tmpDir, ".prowlqa"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, ".prowlqa", "config.yml"),
        "target:\n  url: 'http://legacy.example'\n"
      );
      fs.mkdirSync(path.join(tmpDir, ".prowl"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, ".prowl", "config.yml"),
        "target:\n  url: 'http://new.example'\n"
      );

      expect(findConfigPath(tmpDir)).toBe(path.join(tmpDir, ".prowl", "config.yml"));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("falls back to legacy .prowlqa/ and warns when .prowl/ is absent", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-legacy-"));
    const legacyDir = path.join(tmpDir, ".prowlqa");
    fs.mkdirSync(path.join(legacyDir, "hunts"), { recursive: true });
    fs.writeFileSync(
      path.join(legacyDir, "config.yml"),
      "target:\n  url: 'http://example.com'\n"
    );

    const cwd = process.cwd();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      process.chdir(tmpDir);

      const { config, configDir } = loadConfig();
      expect(config.target.url).toBe("http://example.com");
      expect(path.basename(configDir)).toBe(".prowlqa");
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(".prowlqa/"));
    } finally {
      process.chdir(cwd);
      warn.mockRestore();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("ensureAllowedDomain", () => {
  it("adds host if missing", () => {
    const allowed = ensureAllowedDomain(["localhost"], "http://example.com");
    expect(allowed).toContain("example.com");
  });
});

describe("loadConfig macOS target (PROWL-048)", () => {
  function setupTargetProject(configYml: string): string {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-mac-"));
    fs.mkdirSync(path.join(tmpDir, ".prowl", "hunts"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".prowl", "config.yml"), configYml);
    return tmpDir;
  }

  it("normalizes a legacy web target to include type: web", () => {
    const project = setupTempProject();
    const cwd = process.cwd();
    try {
      process.chdir(project);
      const { config } = loadConfig();
      expect(config.target).toEqual({ type: "web", url: "http://example.com" });
    } finally {
      process.chdir(cwd);
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("loads a macos target and does not inject an allowed domain", () => {
    const project = setupTargetProject(
      "target:\n  type: macos\n  app: 'com.example.App'\nguardrails:\n  allowedApps: ['com.example.App']\n"
    );
    const cwd = process.cwd();
    try {
      process.chdir(project);
      const { config } = loadConfig();
      expect(config.target).toEqual({ type: "macos", app: "com.example.App" });
      expect(config.guardrails.allowedApps).toEqual(["com.example.App"]);
      // No url means allowedDomains stays at defaults (no host appended).
      expect(config.guardrails.allowedDomains).toEqual(["localhost", "127.0.0.1", "0.0.0.0"]);
    } finally {
      process.chdir(cwd);
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("loads an android target with deviceSerial and coldStart and injects no domain", () => {
    const project = setupTargetProject(
      "target:\n  type: android\n  app: 'com.example.app'\n  deviceSerial: 'emulator-5554'\n  coldStart: true\nguardrails:\n  allowedApps: ['com.example.app']\n"
    );
    const cwd = process.cwd();
    try {
      process.chdir(project);
      const { config } = loadConfig();
      expect(config.target).toEqual({
        type: "android",
        app: "com.example.app",
        deviceSerial: "emulator-5554",
        coldStart: true
      });
      expect(config.guardrails.allowedApps).toEqual(["com.example.app"]);
      expect(config.guardrails.allowedDomains).toEqual(["localhost", "127.0.0.1", "0.0.0.0"]);
    } finally {
      process.chdir(cwd);
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("interpolates native target fields from .env in the config directory", () => {
    const original = process.env.IOS_SIM_UDID;
    const project = setupTargetProject(
      "target:\n  type: ios\n  app: 'com.example.App'\n  udid: '{{IOS_SIM_UDID}}'\nguardrails:\n  allowedApps: ['com.example.App']\n"
    );
    const cwd = process.cwd();
    try {
      delete process.env.IOS_SIM_UDID;
      fs.writeFileSync(path.join(project, ".prowl", ".env"), "IOS_SIM_UDID=SIM-FROM-DOTENV\n");
      process.chdir(project);

      const { config } = loadConfig();
      expect(config.target).toEqual({
        type: "ios",
        app: "com.example.App",
        udid: "SIM-FROM-DOTENV"
      });
    } finally {
      process.chdir(cwd);
      if (original === undefined) {
        delete process.env.IOS_SIM_UDID;
      } else {
        process.env.IOS_SIM_UDID = original;
      }
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("prefers process.env over .env when interpolating config values", () => {
    const original = process.env.IOS_SIM_UDID;
    const project = setupTargetProject(
      "target:\n  type: ios\n  app: 'com.example.App'\n  udid: '{{IOS_SIM_UDID}}'\nguardrails:\n  allowedApps: ['com.example.App']\n"
    );
    const cwd = process.cwd();
    try {
      process.env.IOS_SIM_UDID = "SIM-FROM-PROCESS";
      fs.writeFileSync(path.join(project, ".prowl", ".env"), "IOS_SIM_UDID=SIM-FROM-DOTENV\n");
      process.chdir(project);

      const { config } = loadConfig();
      expect(config.target).toEqual({
        type: "ios",
        app: "com.example.App",
        udid: "SIM-FROM-PROCESS"
      });
    } finally {
      process.chdir(cwd);
      if (original === undefined) {
        delete process.env.IOS_SIM_UDID;
      } else {
        process.env.IOS_SIM_UDID = original;
      }
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("fails clearly when a config variable is missing", () => {
    const original = process.env.IOS_SIM_UDID;
    const project = setupTargetProject(
      "target:\n  type: ios\n  app: 'com.example.App'\n  udid: '{{IOS_SIM_UDID}}'\nguardrails:\n  allowedApps: ['com.example.App']\n"
    );
    const cwd = process.cwd();
    try {
      delete process.env.IOS_SIM_UDID;
      process.chdir(project);

      expect(() => loadConfig()).toThrow("Missing variable: IOS_SIM_UDID");
    } finally {
      process.chdir(cwd);
      if (original === undefined) {
        delete process.env.IOS_SIM_UDID;
      } else {
        process.env.IOS_SIM_UDID = original;
      }
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("omits optional android fields when they are not set", () => {
    const project = setupTargetProject("target:\n  type: android\n  app: 'com.example.app'\n");
    const cwd = process.cwd();
    try {
      process.chdir(project);
      const { config } = loadConfig();
      expect(config.target).toEqual({ type: "android", app: "com.example.app" });
    } finally {
      process.chdir(cwd);
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("defaults allowedApps to an empty list for web targets", () => {
    const project = setupTempProject();
    const cwd = process.cwd();
    try {
      process.chdir(project);
      const { config } = loadConfig();
      expect(config.guardrails.allowedApps).toEqual([]);
    } finally {
      process.chdir(cwd);
      fs.rmSync(project, { recursive: true, force: true });
    }
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
        path.join(project, ".prowl", "config.yml"),
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
        path.join(project, ".prowl", "config.yml"),
        "target:\n  url: 'http://example.com'\nhistory:\n  maxRuns: 0\n"
      );

      expect(() => loadConfig()).toThrow();
    } finally {
      process.chdir(cwd);
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
});
