import fs from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { RunResult, StepResult, AssertionResult } from "../src/types/index.js";

const mockLaunchBrowser = vi.fn();
const mockCloseBrowser = vi.fn();
const mockExecuteSteps = vi.fn();
const mockCaptureFinalScreenshot = vi.fn();
const mockEvaluateAssertions = vi.fn();
const mockWriteReports = vi.fn();
const mockLoadConfig = vi.fn();
const mockLoadHunt = vi.fn();
const mockEnsureAllowedDomain = vi.fn();
const mockResolveViewport = vi.fn();
const mockInterpolateHunt = vi.fn();

vi.mock("../src/browser/controller.js", () => ({
  launchBrowser: (...args: unknown[]) => mockLaunchBrowser(...args),
  closeBrowser: (...args: unknown[]) => mockCloseBrowser(...args)
}));

vi.mock("../src/runner/steps.js", () => ({
  executeSteps: (...args: unknown[]) => mockExecuteSteps(...args),
  captureFinalScreenshot: (...args: unknown[]) => mockCaptureFinalScreenshot(...args)
}));

vi.mock("../src/runner/assertions.js", () => ({
  evaluateAssertions: (...args: unknown[]) => mockEvaluateAssertions(...args)
}));

vi.mock("../src/reporter/index.js", () => ({
  writeReports: (...args: unknown[]) => mockWriteReports(...args)
}));

vi.mock("../src/config/loader.js", () => ({
  loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
  loadHunt: (...args: unknown[]) => mockLoadHunt(...args),
  ensureAllowedDomain: (...args: unknown[]) => mockEnsureAllowedDomain(...args),
  resolveViewport: (...args: unknown[]) => mockResolveViewport(...args)
}));

vi.mock("../src/config/interpolate.js", () => ({
  interpolateHunt: (...args: unknown[]) => mockInterpolateHunt(...args)
}));

// Need to mock fs.mkdirSync and fs.writeFileSync for run directory creation
const originalMkdirSync = fs.mkdirSync;

import { runHunt } from "../src/runner/index.js";

function defaultConfig() {
  return {
    target: { url: "http://localhost:3000" },
    browser: { headless: true, slowMo: 0, timeout: 30000, engine: "chromium", viewport: { width: 1280, height: 720 } },
    artifacts: { screenshots: "on-failure", networkHar: false, console: true, junit: false },
    assertions: { noConsoleErrors: true, noNetworkErrors: true, maxTotalTimeMs: 30000, networkIgnorePatterns: [] },
    guardrails: { maxSteps: 50, allowedDomains: ["localhost"], forbiddenSelectors: [] },
    auth: { storageStatePath: ".prowlqa/auth-state.json" }
  };
}

function mockSession() {
  return {
    browser: { close: vi.fn() },
    context: { tracing: { stop: vi.fn() }, close: vi.fn() },
    page: {
      on: vi.fn(),
      url: () => "http://localhost:3000",
      setDefaultTimeout: vi.fn(),
      setDefaultNavigationTimeout: vi.fn()
    },
    tracePath: undefined
  };
}

function setupMocks(overrides?: {
  stepResults?: StepResult[];
  stepFailed?: boolean;
  assertionResults?: AssertionResult[];
  huntRetry?: { maxRetries: number; delay?: number };
}) {
  const config = defaultConfig();
  const configDir = "/tmp/prowlqa-test-runner/.prowlqa";

  mockLoadConfig.mockReturnValue({ config, configDir, configPath: `${configDir}/config.yml` });
  mockLoadHunt.mockReturnValue({
    name: "test-hunt",
    steps: [{ navigate: "/" }],
    retry: overrides?.huntRetry
  });
  mockEnsureAllowedDomain.mockReturnValue(["localhost"]);
  mockResolveViewport.mockReturnValue({ width: 1280, height: 720 });
  mockInterpolateHunt.mockReturnValue({
    hunt: {
      name: "test-hunt",
      steps: [{ navigate: "/" }],
      assertions: []
    },
    redactedFillSteps: new Set()
  });

  const session = mockSession();
  mockLaunchBrowser.mockResolvedValue(session);
  mockCloseBrowser.mockResolvedValue(undefined);

  const stepResults = overrides?.stepResults ?? [
    { type: "navigate", status: "pass" as const, durationMs: 100 }
  ];
  mockExecuteSteps.mockResolvedValue({
    results: stepResults,
    screenshots: [],
    failed: overrides?.stepFailed ?? false
  });
  mockCaptureFinalScreenshot.mockResolvedValue("screenshots/final.png");

  mockEvaluateAssertions.mockResolvedValue(
    overrides?.assertionResults ?? []
  );

  mockWriteReports.mockImplementation((_dir: string, result: RunResult) => ({
    ...result,
    artifacts: { ...result.artifacts, summary: "summary.md" }
  }));

  // Mock fs.mkdirSync to avoid creating real directories
  vi.spyOn(fs, "mkdirSync").mockImplementation(originalMkdirSync);
  vi.spyOn(fs, "writeFileSync").mockImplementation(() => undefined);

  return { config, configDir, session };
}

describe("runHunt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("returns pass result for successful run", async () => {
    setupMocks();

    const { result } = await runHunt({ huntName: "test-hunt" });

    expect(result.status).toBe("pass");
    expect(result.exitCode).toBe(0);
    expect(result.hunt).toBe("test-hunt");
    expect(mockLaunchBrowser).toHaveBeenCalled();
    expect(mockCloseBrowser).toHaveBeenCalled();
  });

  it("returns fail result when step fails", async () => {
    setupMocks({
      stepResults: [{ type: "click", status: "fail", durationMs: 50, error: "not found" }],
      stepFailed: true
    });

    const { result } = await runHunt({ huntName: "test-hunt" });

    expect(result.status).toBe("fail");
    expect(result.exitCode).toBe(1);
  });

  it("returns fail result when assertion fails", async () => {
    setupMocks({
      assertionResults: [{ type: "urlIncludes", value: "/dash", status: "fail", error: "mismatch" }]
    });

    const { result } = await runHunt({ huntName: "test-hunt" });

    expect(result.status).toBe("fail");
    expect(result.exitCode).toBe(1);
  });

  it("uses URL override when provided", async () => {
    setupMocks();
    mockEnsureAllowedDomain.mockReturnValue(["example.com"]);

    await runHunt({ huntName: "test-hunt", urlOverride: "http://example.com" });

    expect(mockEnsureAllowedDomain).toHaveBeenCalledWith(
      expect.any(Array),
      "http://example.com"
    );
  });

  it("passes browser option to launchBrowser", async () => {
    setupMocks();

    await runHunt({ huntName: "test-hunt", browser: "firefox" });

    expect(mockLaunchBrowser).toHaveBeenCalledWith(
      expect.objectContaining({ engine: "firefox" })
    );
  });

  it("passes viewport option to resolveViewport", async () => {
    setupMocks();
    mockResolveViewport.mockReturnValue({ width: 375, height: 812 });

    await runHunt({ huntName: "test-hunt", viewport: "mobile" });

    expect(mockResolveViewport).toHaveBeenCalledWith("mobile");
  });

  it("passes custom WxH viewport", async () => {
    setupMocks();
    mockResolveViewport.mockReturnValue({ width: 1920, height: 1080 });

    await runHunt({ huntName: "test-hunt", viewport: "1920x1080" });

    expect(mockResolveViewport).toHaveBeenCalledWith({ width: 1920, height: 1080 });
  });

  it("throws when hunt exceeds maxSteps", async () => {
    const { config } = setupMocks();
    config.guardrails.maxSteps = 1;
    mockInterpolateHunt.mockReturnValue({
      hunt: {
        steps: [{ navigate: "/a" }, { navigate: "/b" }],
        assertions: []
      },
      redactedFillSteps: new Set()
    });

    await expect(runHunt({ huntName: "test-hunt" })).rejects.toThrow("Max allowed is 1");
  });

  it("retries on failure and returns pass on second attempt", async () => {
    setupMocks({ huntRetry: { maxRetries: 1, delay: 0 } });

    let callCount = 0;
    mockExecuteSteps.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          results: [{ type: "navigate", status: "fail", durationMs: 10, error: "timeout" }],
          screenshots: [],
          failed: true
        });
      }
      return Promise.resolve({
        results: [{ type: "navigate", status: "pass", durationMs: 10 }],
        screenshots: [],
        failed: false
      });
    });

    const { result } = await runHunt({ huntName: "test-hunt" });

    expect(result.status).toBe("pass");
    expect(mockExecuteSteps).toHaveBeenCalledTimes(2);
    expect(result.artifacts.summary).toContain("attempt 2 of 2");
  });

  it("returns fail after exhausting all retries", async () => {
    setupMocks({ huntRetry: { maxRetries: 2, delay: 0 } });

    mockExecuteSteps.mockResolvedValue({
      results: [{ type: "navigate", status: "fail", durationMs: 10, error: "timeout" }],
      screenshots: [],
      failed: true
    });

    const { result } = await runHunt({ huntName: "test-hunt" });

    expect(result.status).toBe("fail");
    expect(mockExecuteSteps).toHaveBeenCalledTimes(3);
    expect(result.artifacts.summary).toContain("Failed after 3 attempts");
  });

  it("does not retry when hunt has no retry config", async () => {
    setupMocks({
      stepResults: [{ type: "navigate", status: "fail", durationMs: 10, error: "timeout" }],
      stepFailed: true
    });

    const { result } = await runHunt({ huntName: "test-hunt" });

    expect(result.status).toBe("fail");
    expect(mockExecuteSteps).toHaveBeenCalledTimes(1);
  });

  it("calls onStep callback during execution", async () => {
    setupMocks();
    const onStep = vi.fn();

    await runHunt({ huntName: "test-hunt", onStep });

    expect(mockExecuteSteps).toHaveBeenCalledWith(
      expect.objectContaining({ onStep })
    );
  });

  it("uses config junit setting when options.junit is undefined", async () => {
    const { config } = setupMocks();
    config.artifacts.junit = true;

    await runHunt({ huntName: "test-hunt" });

    expect(mockWriteReports).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ junit: true })
    );
  });

  it("uses explicit options.junit false instead of config junit true", async () => {
    const { config } = setupMocks();
    config.artifacts.junit = true;

    await runHunt({ huntName: "test-hunt", junit: false });

    expect(mockWriteReports).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ junit: false })
    );
  });
});
