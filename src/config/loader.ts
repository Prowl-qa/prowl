import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";
import dotenv from "dotenv";
import type { Config, Goal } from "../types/index.js";
import { configSchema, goalSchema } from "./schema.js";

const DEFAULT_CONFIG: Config = {
  target: {
    url: "http://localhost:3000"
  },
  browser: {
    headless: true,
    slowMo: 0,
    timeout: 30000
  },
  artifacts: {
    screenshots: "on-failure",
    networkHar: false,
    console: true
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
    storageStatePath: ".prowl/auth-state.json"
  }
};

export function findConfigPath(startDir: string): string | null {
  let current = startDir;
  while (current) {
    const candidate = path.join(current, ".prowl", "config.yml");
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

function mergeConfig(partial: Partial<Config>): Config {
  return {
    target: {
      url: partial.target?.url ?? DEFAULT_CONFIG.target.url
    },
    browser: {
      headless: partial.browser?.headless ?? DEFAULT_CONFIG.browser.headless,
      slowMo: partial.browser?.slowMo ?? DEFAULT_CONFIG.browser.slowMo,
      timeout: partial.browser?.timeout ?? DEFAULT_CONFIG.browser.timeout
    },
    artifacts: {
      screenshots: partial.artifacts?.screenshots ?? DEFAULT_CONFIG.artifacts.screenshots,
      networkHar: partial.artifacts?.networkHar ?? DEFAULT_CONFIG.artifacts.networkHar,
      console: partial.artifacts?.console ?? DEFAULT_CONFIG.artifacts.console
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
      storageStatePath: partial.auth?.storageStatePath ?? DEFAULT_CONFIG.auth.storageStatePath
    }
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
    throw new Error("Could not find .prowl/config.yml. Run `prowlai init` first.");
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

export function loadGoal(goalName: string, configDir: string): Goal {
  const goalPath = path.join(configDir, "goals", `${goalName}.yml`);
  if (!fs.existsSync(goalPath)) {
    throw new Error(`Goal file not found: ${goalPath}`);
  }
  const raw = fs.readFileSync(goalPath, "utf-8");
  const parsed = yaml.parse(raw) ?? {};
  const validated = goalSchema.parse(parsed);
  return validated as Goal;
}

export function listGoals(configDir: string): string[] {
  const goalsDir = path.join(configDir, "goals");
  if (!fs.existsSync(goalsDir)) {
    return [];
  }
  const stats = fs.statSync(goalsDir);
  if (!stats.isDirectory()) {
    throw new Error(`Goals path is not a directory: ${goalsDir}`);
  }
  const entries = fs.readdirSync(goalsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".yml"))
    .map((entry) => path.basename(entry.name, ".yml"))
    .sort((a, b) => a.localeCompare(b));
}
