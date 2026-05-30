import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";
import dotenv from "dotenv";
import type { BrowserChannel, BrowserEngine, Config, Hunt, Viewport } from "../types/index.js";
import { configSchema, huntSchema } from "./schema.js";
import { assertValidHuntName } from "./hunt-name.js";

const DEFAULT_CONFIG: Config = {
  target: {
    url: "http://localhost:3000"
  },
  browser: {
    headless: true,
    slowMo: 0,
    timeout: 30000,
    engine: "chromium",
    viewport: { width: 1280, height: 720 }
  },
  artifacts: {
    screenshots: "on-failure",
    networkHar: false,
    console: true,
    junit: false
  },
  assertions: {
    noConsoleErrors: true,
    noNetworkErrors: true,
    maxTotalTimeMs: 30000,
    networkIgnorePatterns: []
  },
  guardrails: {
    maxSteps: 50,
    allowedDomains: ["localhost", "127.0.0.1", "0.0.0.0"],
    forbiddenSelectors: ["[data-danger]", ".delete-btn"]
  },
  auth: {
    storageStatePath: ".prowlqa/auth-state.json"
  },
  history: {
    maxRuns: 100
  }
};

export function findConfigPath(startDir: string): string | null {
  let current = startDir;
  while (current) {
    const candidate = path.join(current, ".prowlqa", "config.yml");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

const VIEWPORT_PRESETS: Record<string, Viewport> = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 720 }
};

export function resolveViewport(
  value: string | Viewport | undefined
): Viewport {
  if (value === undefined) {
    return DEFAULT_CONFIG.browser.viewport;
  }
  if (typeof value === "string") {
    const preset = VIEWPORT_PRESETS[value];
    if (!preset) {
      throw new Error(`Unknown viewport preset: "${value}". Use mobile, tablet, or desktop.`);
    }
    return preset;
  }
  return value;
}

function mergeConfig(partial: Partial<Config>): Config {
  return {
    target: {
      url: partial.target?.url ?? DEFAULT_CONFIG.target.url
    },
    browser: {
      headless: partial.browser?.headless ?? DEFAULT_CONFIG.browser.headless,
      slowMo: partial.browser?.slowMo ?? DEFAULT_CONFIG.browser.slowMo,
      timeout: partial.browser?.timeout ?? DEFAULT_CONFIG.browser.timeout,
      engine: (partial.browser as { engine?: BrowserEngine } | undefined)?.engine ?? DEFAULT_CONFIG.browser.engine,
      channel: (partial.browser as { channel?: BrowserChannel } | undefined)?.channel,
      viewport: resolveViewport((partial.browser as { viewport?: string | Viewport } | undefined)?.viewport)
    },
    artifacts: {
      screenshots: partial.artifacts?.screenshots ?? DEFAULT_CONFIG.artifacts.screenshots,
      networkHar: partial.artifacts?.networkHar ?? DEFAULT_CONFIG.artifacts.networkHar,
      console: partial.artifacts?.console ?? DEFAULT_CONFIG.artifacts.console,
      junit: partial.artifacts?.junit ?? DEFAULT_CONFIG.artifacts.junit
    },
    assertions: {
      noConsoleErrors:
        partial.assertions?.noConsoleErrors ?? DEFAULT_CONFIG.assertions.noConsoleErrors,
      noNetworkErrors:
        partial.assertions?.noNetworkErrors ?? DEFAULT_CONFIG.assertions.noNetworkErrors,
      maxTotalTimeMs:
        partial.assertions?.maxTotalTimeMs ?? DEFAULT_CONFIG.assertions.maxTotalTimeMs,
      networkIgnorePatterns:
        partial.assertions?.networkIgnorePatterns ??
        DEFAULT_CONFIG.assertions.networkIgnorePatterns
    },
    guardrails: {
      maxSteps: partial.guardrails?.maxSteps ?? DEFAULT_CONFIG.guardrails.maxSteps,
      allowedDomains: partial.guardrails?.allowedDomains ?? DEFAULT_CONFIG.guardrails.allowedDomains,
      forbiddenSelectors:
        partial.guardrails?.forbiddenSelectors ?? DEFAULT_CONFIG.guardrails.forbiddenSelectors
    },
    auth: {
      storageStatePath: partial.auth?.storageStatePath ?? (partial.auth !== undefined ? DEFAULT_CONFIG.auth.storageStatePath : undefined)
    },
    history: {
      maxRuns: partial.history?.maxRuns ?? DEFAULT_CONFIG.history.maxRuns
    },
    bugLog: partial.bugLog
  };
}

export function ensureAllowedDomain(allowed: string[], urlValue: string): string[] {
  try {
    const host = new URL(urlValue).hostname;
    if (!allowed.includes(host)) {
      return [...allowed, host];
    }
  } catch {
    return allowed;
  }
  return allowed;
}

export function loadConfig(configPath?: string): {
  config: Config;
  configPath: string;
  configDir: string;
} {
  const resolvedPath = configPath
    ? path.resolve(configPath)
    : findConfigPath(process.cwd());

  if (!resolvedPath) {
    throw new Error("Could not find .prowlqa/config.yml. Run `prowlqa init` first.");
  }

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Config file not found at ${resolvedPath}`);
  }

  const configDir = path.dirname(resolvedPath);
  dotenv.config({ path: path.join(configDir, ".env"), override: false });

  const raw = fs.readFileSync(resolvedPath, "utf-8");
  const parsed = yaml.parse(raw) ?? {};
  const validated = configSchema.parse(parsed);
  const config = mergeConfig(validated as Partial<Config>);

  config.guardrails.allowedDomains = ensureAllowedDomain(
    config.guardrails.allowedDomains,
    config.target.url
  );

  return { config, configPath: resolvedPath, configDir };
}

export function loadHunt(huntName: string, configDir: string): Hunt {
  assertValidHuntName(huntName);
  const huntPath = path.join(configDir, "hunts", `${huntName}.yml`);
  if (!fs.existsSync(huntPath)) {
    throw new Error(`Hunt file not found: ${huntPath}`);
  }
  const raw = fs.readFileSync(huntPath, "utf-8");
  const parsed = yaml.parse(raw) ?? {};
  const validated = huntSchema.parse(parsed);
  return validated as Hunt;
}

export function loadHuntTags(huntName: string, configDir: string): string[] {
  assertValidHuntName(huntName);
  const huntPath = path.join(configDir, "hunts", `${huntName}.yml`);
  if (!fs.existsSync(huntPath)) {
    return [];
  }
  const raw = fs.readFileSync(huntPath, "utf-8");
  const parsed = yaml.parse(raw) ?? {};
  return Array.isArray(parsed.tags) ? parsed.tags : [];
}

export function loadHuntMeta(huntName: string, configDir: string): { description?: string; tags: string[] } {
  assertValidHuntName(huntName);
  const huntPath = path.join(configDir, "hunts", `${huntName}.yml`);
  if (!fs.existsSync(huntPath)) {
    return { tags: [] };
  }
  const raw = fs.readFileSync(huntPath, "utf-8");
  const parsed = yaml.parse(raw) ?? {};
  return {
    description: typeof parsed.description === "string" ? parsed.description : undefined,
    tags: Array.isArray(parsed.tags) ? parsed.tags : []
  };
}

export function listHunts(configDir: string): string[] {
  const huntsDir = path.join(configDir, "hunts");
  if (!fs.existsSync(huntsDir)) {
    return [];
  }
  const stats = fs.statSync(huntsDir);
  if (!stats.isDirectory()) {
    throw new Error(`Hunts path is not a directory: ${huntsDir}`);
  }

  const results: string[] = [];

  function scanDir(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".yml")) {
        const fullPath = path.join(dir, entry.name);
        const relative = path.relative(huntsDir, fullPath);
        results.push(relative.replace(/\.yml$/, ""));
      } else if (entry.isDirectory()) {
        scanDir(path.join(dir, entry.name));
      }
    }
  }

  scanDir(huntsDir);
  return results.sort((a, b) => a.localeCompare(b));
}
