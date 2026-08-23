import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MacHelperClient } from "../src/browser/mac-driver.js";
import type { Config } from "../src/types/index.js";

const mockAnalyzeMacApp = vi.fn();
const mockLaunchMacSession = vi.fn();
const mockAnalyzeAndroidApp = vi.fn();
const mockLaunchAndroidSession = vi.fn();
const mockAnalyzeIosApp = vi.fn();
const mockLaunchIosSession = vi.fn();
const mockFindConfigPath = vi.fn();
const mockLoadConfig = vi.fn();

vi.mock("../src/analyzer/mac.js", () => ({
  analyzeMacApp: (...args: unknown[]) => mockAnalyzeMacApp(...args)
}));

vi.mock("../src/browser/mac-helper.js", () => ({
  launchMacSession: (...args: unknown[]) => mockLaunchMacSession(...args)
}));

vi.mock("../src/analyzer/android.js", () => ({
  analyzeAndroidApp: (...args: unknown[]) => mockAnalyzeAndroidApp(...args)
}));

vi.mock("../src/browser/android-helper.js", () => ({
  launchAndroidSession: (...args: unknown[]) => mockLaunchAndroidSession(...args)
}));

vi.mock("../src/analyzer/ios.js", () => ({
  analyzeIosApp: (...args: unknown[]) => mockAnalyzeIosApp(...args)
}));

vi.mock("../src/browser/ios-helper.js", () => ({
  launchIosSession: (...args: unknown[]) => mockLaunchIosSession(...args)
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
      "Pass either a URL argument (web) or --app (native), not both."
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

function makeAndroidSession(pkg: string) {
  return {
    client: { source: async () => "<hierarchy/>" },
    package: pkg,
    serial: "emulator-5554",
    driver: {},
    teardown: vi.fn(async () => {})
  };
}

function makeIosSession(bundleId: string) {
  return {
    client: { source: async () => "<XCUIElementTypeApplication/>" },
    bundleId,
    udid: "SIM-UDID",
    driver: {},
    teardown: vi.fn(async () => {})
  };
}

function makeAndroidResult(app: string) {
  return { app, elements: [] };
}

function makeIosResult(app: string) {
  return { app, elements: [], windows: [] };
}

describe("analyze command native Android/iOS routing", () => {
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
    mockLaunchAndroidSession.mockImplementation(async (options: { app: string }) =>
      makeAndroidSession(options.app)
    );
    mockLaunchIosSession.mockImplementation(async (options: { app: string }) =>
      makeIosSession(options.app)
    );
    mockAnalyzeAndroidApp.mockImplementation(async (_client: unknown, options: { app: string }) =>
      makeAndroidResult(options.app)
    );
    mockAnalyzeIosApp.mockImplementation(async (_client: unknown, options: { app: string }) =>
      makeIosResult(options.app)
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("routes --app --platform android to the Android analyzer", async () => {
    const session = makeAndroidSession("com.example.app");
    mockLaunchAndroidSession.mockResolvedValue(session);
    mockAnalyzeAndroidApp.mockResolvedValue(makeAndroidResult("com.example.app"));

    await runAnalyzeCommand(["--app", "com.example.app", "--platform", "android", "--json"]);

    expect(mockLaunchAndroidSession).toHaveBeenCalledWith({
      app: "com.example.app",
      timeoutMs: undefined,
      allowedApps: []
    });
    expect(mockAnalyzeAndroidApp).toHaveBeenCalledWith(expect.anything(), { app: "com.example.app" });
    expect(mockLaunchMacSession).not.toHaveBeenCalled();
    expect(session.teardown).toHaveBeenCalled();
    expect(JSON.parse(logSpy.mock.calls[0][0])).toEqual(makeAndroidResult("com.example.app"));
    expect(process.exitCode).toBeUndefined();
  });

  it("infers the Android platform from an .apk --app without a config or --platform", async () => {
    await runAnalyzeCommand(["--app", "./build/app-debug.apk", "--json"]);

    expect(mockLaunchAndroidSession).toHaveBeenCalledWith({
      app: "./build/app-debug.apk",
      timeoutMs: undefined,
      allowedApps: []
    });
    expect(mockLaunchMacSession).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it("passes --device through to the Android session", async () => {
    await runAnalyzeCommand(["--app", "com.example.app", "--platform", "android", "--device", "emulator-5556", "--json"]);

    expect(mockLaunchAndroidSession).toHaveBeenCalledWith({
      app: "com.example.app",
      deviceSerial: "emulator-5556",
      timeoutMs: undefined,
      allowedApps: []
    });
  });

  it("routes --app --platform ios to the iOS analyzer", async () => {
    const session = makeIosSession("com.apple.Preferences");
    mockLaunchIosSession.mockResolvedValue(session);
    mockAnalyzeIosApp.mockResolvedValue(makeIosResult("com.apple.Preferences"));

    await runAnalyzeCommand(["--app", "com.apple.Preferences", "--platform", "ios", "--json"]);

    expect(mockLaunchIosSession).toHaveBeenCalledWith({
      app: "com.apple.Preferences",
      timeoutMs: undefined,
      allowedApps: []
    });
    expect(mockAnalyzeIosApp).toHaveBeenCalledWith(expect.anything(), { app: "com.apple.Preferences" });
    expect(session.teardown).toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it("defaults a bare bundle-id --app to macOS (backward compatible)", async () => {
    const client = new FakeMacClient();
    mockLaunchMacSession.mockResolvedValue(makeSession(client, "com.example.App"));
    mockAnalyzeMacApp.mockResolvedValue(makeAnalysisResult("com.example.App"));

    await runAnalyzeCommand(["--app", "com.example.App", "--json"]);

    expect(mockLaunchMacSession).toHaveBeenCalled();
    expect(mockLaunchAndroidSession).not.toHaveBeenCalled();
    expect(mockLaunchIosSession).not.toHaveBeenCalled();
  });

  it("rejects an unknown --platform", async () => {
    await runAnalyzeCommand(["--app", "com.example.app", "--platform", "windows", "--json"]);

    expect(mockLaunchAndroidSession).not.toHaveBeenCalled();
    expect(mockLaunchMacSession).not.toHaveBeenCalled();
    expect(JSON.parse(logSpy.mock.calls[0][0]).error).toContain('Unknown --platform "windows"');
    expect(process.exitCode).toBe(1);
  });

  it("uses a configured Android target when no positional URL or --app is supplied", async () => {
    const config = makeMacConfig({
      target: { type: "android", app: "com.configured.app", deviceSerial: "emulator-9999" },
      guardrails: { allowedApps: [] }
    });
    mockDefaultConfig(config);
    const session = makeAndroidSession("com.configured.app");
    mockLaunchAndroidSession.mockResolvedValue(session);
    mockAnalyzeAndroidApp.mockResolvedValue(makeAndroidResult("com.configured.app"));

    await runAnalyzeCommand(["--json"]);

    expect(mockLaunchAndroidSession).toHaveBeenCalledWith({
      app: "com.configured.app",
      deviceSerial: "emulator-9999",
      timeoutMs: 30000,
      allowedApps: []
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("uses a configured iOS target when no positional URL or --app is supplied", async () => {
    const config = makeMacConfig({
      target: { type: "ios", app: "com.configured.ios", udid: "SIM-1234" },
      guardrails: { allowedApps: [] }
    });
    mockDefaultConfig(config);
    const session = makeIosSession("com.configured.ios");
    mockLaunchIosSession.mockResolvedValue(session);
    mockAnalyzeIosApp.mockResolvedValue(makeIosResult("com.configured.ios"));

    await runAnalyzeCommand(["--json"]);

    expect(mockLaunchIosSession).toHaveBeenCalledWith({
      app: "com.configured.ios",
      udid: "SIM-1234",
      timeoutMs: 30000,
      allowedApps: []
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("enforces guardrails.allowedApps for a bare Android package before launch", async () => {
    mockDefaultConfig(
      makeMacConfig({
        target: { type: "android", app: "com.blocked.app" },
        guardrails: { allowedApps: ["com.allowed.app"] }
      })
    );

    await runAnalyzeCommand(["--json"]);

    expect(mockLaunchAndroidSession).not.toHaveBeenCalled();
    expect(JSON.parse(logSpy.mock.calls[0][0]).error).toContain(
      'Target app "com.blocked.app" is not in guardrails.allowedApps'
    );
    expect(process.exitCode).toBe(1);
  });

  it("tears down the Android session even when analysis fails", async () => {
    const session = makeAndroidSession("com.example.app");
    mockLaunchAndroidSession.mockResolvedValue(session);
    mockAnalyzeAndroidApp.mockRejectedValue(new Error("source failed"));

    await runAnalyzeCommand(["--app", "com.example.app", "--platform", "android", "--json"]);

    expect(session.teardown).toHaveBeenCalled();
    expect(JSON.parse(logSpy.mock.calls[0][0]).error).toBe("source failed");
    expect(process.exitCode).toBe(1);
  });
});
