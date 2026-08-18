import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MacHelperClient } from "../src/browser/mac-driver.js";
import type { Config } from "../src/types/index.js";

const mockAnalyzeMacApp = vi.fn();
const mockLaunchMacSession = vi.fn();
const mockFindConfigPath = vi.fn();
const mockLoadConfig = vi.fn();

vi.mock("../src/analyzer/mac.js", () => ({
  analyzeMacApp: (...args: unknown[]) => mockAnalyzeMacApp(...args)
}));

vi.mock("../src/browser/mac-helper.js", () => ({
  launchMacSession: (...args: unknown[]) => mockLaunchMacSession(...args)
}));

vi.mock("../src/config/loader.js", () => ({
  findConfigPath: (...args: unknown[]) => mockFindConfigPath(...args),
  loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
  resolveViewport: (value: unknown) => value
}));

import { buildAnalyzeCommand } from "../src/cli/commands/analyze.js";

class FakeMacClient implements MacHelperClient {
  calls: { cmd: string; params: Record<string, unknown> }[] = [];
  closed = false;

  async request(cmd: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    this.calls.push({ cmd, params });
    return {};
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

type ConfigOverrides = {
  target?: Config["target"];
  browser?: Partial<Config["browser"]>;
  guardrails?: Partial<Config["guardrails"]>;
};

const defaultConfigPath = "/project/.prowl/config.yml";

function makeMacConfig(overrides: ConfigOverrides = {}): Config {
  const base: Config = {
    target: { type: "macos", app: "com.example.ConfigApp" },
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
      allowedDomains: [],
      allowedApps: ["com.example.ConfigApp"],
      forbiddenSelectors: [],
      selfHealing: false
    },
    auth: {},
    history: {
      maxRuns: 100
    }
  };

  return {
    ...base,
    target: overrides.target ?? base.target,
    browser: { ...base.browser, ...overrides.browser },
    guardrails: { ...base.guardrails, ...overrides.guardrails }
  };
}

function makeAnalysisResult(app: string) {
  return {
    app,
    elements: [],
    windows: [],
    menuItems: []
  };
}

function makeSession(client: FakeMacClient, bundleId: string) {
  return {
    client,
    bundleId,
    driver: {}
  };
}

function mockDefaultConfig(config: Config): void {
  mockFindConfigPath.mockReturnValue(defaultConfigPath);
  mockLoadConfig.mockReturnValue({
    config,
    configPath: defaultConfigPath,
    configDir: "/project/.prowl"
  });
}

async function runAnalyzeCommand(args: string[]): Promise<void> {
  const command = buildAnalyzeCommand();
  await command.parseAsync(["node", "prowl", ...args]);
}

describe("analyze command macOS routing", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;

    mockFindConfigPath.mockReturnValue(null);
    mockLoadConfig.mockImplementation(() => {
      throw new Error("Unexpected config load");
    });
    mockLaunchMacSession.mockImplementation(async (options: { app: string }) => {
      const client = new FakeMacClient();
      return makeSession(client, options.app);
    });
    mockAnalyzeMacApp.mockImplementation(async (_client: MacHelperClient, options: { app: string }) =>
      makeAnalysisResult(options.app)
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("routes --app to the macOS analyzer without requiring a default config", async () => {
    const client = new FakeMacClient();
    mockLaunchMacSession.mockResolvedValue(makeSession(client, "com.example.ResolvedApp"));
    mockAnalyzeMacApp.mockResolvedValue(makeAnalysisResult("com.example.ResolvedApp"));

    await runAnalyzeCommand(["--app", "com.example.App", "--json"]);

    expect(mockFindConfigPath).toHaveBeenCalledWith(process.cwd());
    expect(mockLoadConfig).not.toHaveBeenCalled();
    expect(mockLaunchMacSession).toHaveBeenCalledWith({
      app: "com.example.App",
      timeoutMs: undefined
    });
    expect(mockAnalyzeMacApp).toHaveBeenCalledWith(client, { app: "com.example.ResolvedApp" });
    expect(client.closed).toBe(true);
    expect(client.calls.map((call) => call.cmd)).not.toContain("quit");
    expect(JSON.parse(logSpy.mock.calls[0][0])).toEqual(makeAnalysisResult("com.example.ResolvedApp"));
    expect(process.exitCode).toBeUndefined();
  });

  it("rejects a URL and --app in the same invocation", async () => {
    await runAnalyzeCommand(["https://example.com", "--app", "com.example.App", "--json"]);

    expect(mockFindConfigPath).not.toHaveBeenCalled();
    expect(mockLaunchMacSession).not.toHaveBeenCalled();
    expect(mockAnalyzeMacApp).not.toHaveBeenCalled();
    expect(JSON.parse(logSpy.mock.calls[0][0]).error).toContain(
      "Pass either a URL argument (web) or --app (macOS), not both."
    );
    expect(process.exitCode).toBe(1);
  });

  it("uses the configured macOS target when no positional URL or --app is supplied", async () => {
    const config = makeMacConfig({
      browser: { timeout: 1234 }
    });
    const client = new FakeMacClient();
    mockDefaultConfig(config);
    mockLaunchMacSession.mockResolvedValue(makeSession(client, "com.example.ConfigApp"));

    await runAnalyzeCommand(["--json"]);

    expect(mockLoadConfig).toHaveBeenCalledWith(defaultConfigPath);
    expect(mockLaunchMacSession).toHaveBeenCalledWith({
      app: "com.example.ConfigApp",
      timeoutMs: 1234
    });
    expect(mockAnalyzeMacApp).toHaveBeenCalledWith(client, { app: "com.example.ConfigApp" });
    expect(client.closed).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  it("rejects --app when the loaded guardrail allowlist does not include it", async () => {
    mockDefaultConfig(
      makeMacConfig({
        guardrails: { allowedApps: ["com.example.AllowedApp"] }
      })
    );

    await runAnalyzeCommand(["--app", "com.example.BlockedApp", "--json"]);

    expect(mockLaunchMacSession).not.toHaveBeenCalled();
    expect(mockAnalyzeMacApp).not.toHaveBeenCalled();
    expect(JSON.parse(logSpy.mock.calls[0][0]).error).toContain(
      'Target app "com.example.BlockedApp" is not in guardrails.allowedApps'
    );
    expect(process.exitCode).toBe(1);
  });

  it("reports explicit --config load failures instead of continuing with an empty allowlist", async () => {
    mockLoadConfig.mockImplementation(() => {
      throw new Error("Config file not found at /missing/config.yml");
    });

    await runAnalyzeCommand(["--app", "com.example.App", "--config", "/missing/config.yml", "--json"]);

    expect(mockFindConfigPath).not.toHaveBeenCalled();
    expect(mockLoadConfig).toHaveBeenCalledWith("/missing/config.yml");
    expect(mockLaunchMacSession).not.toHaveBeenCalled();
    expect(JSON.parse(logSpy.mock.calls[0][0]).error).toContain(
      "Failed to load config at /missing/config.yml: Config file not found at /missing/config.yml"
    );
    expect(process.exitCode).toBe(1);
  });

  it("closes the helper client without quitting the app when analysis fails", async () => {
    const client = new FakeMacClient();
    mockLaunchMacSession.mockResolvedValue(makeSession(client, "com.example.App"));
    mockAnalyzeMacApp.mockRejectedValue(new Error("tree failed"));

    await runAnalyzeCommand(["--app", "com.example.App", "--json"]);

    expect(client.closed).toBe(true);
    expect(client.calls.map((call) => call.cmd)).not.toContain("quit");
    expect(JSON.parse(logSpy.mock.calls[0][0]).error).toBe("tree failed");
    expect(process.exitCode).toBe(1);
  });
});
