import fs from "node:fs";
import path from "node:path";
import type { AndroidTarget, AssertionResult, BrowserChannel, Config, MacosTarget, RunResult, Step, StepResult, TraceCorrelation } from "../types/index.js";
import { loadConfig, loadHunt, ensureAllowedDomain, resolveViewport } from "../config/loader.js";
import { interpolateHunt } from "../config/interpolate.js";
import {
  assertAndroidAppAllowed,
  assertHuntAssertionsSupportedByTarget,
  assertStepsSupportedByTarget,
  assertTargetAppAllowed
} from "../config/target.js";
import { launchBrowser, closeBrowser, createPlaywrightDriver } from "../browser/controller.js";
import { launchMacSession, closeMacSession } from "../browser/mac-helper.js";
import type { MacHelperClient } from "../browser/mac-driver.js";
import {
  launchAndroidSession,
  closeAndroidSession,
  type AndroidSession,
  type LaunchAndroidOptions
} from "../browser/android-helper.js";
import { captureFinalScreenshot, executeSteps, type StepCallback } from "./steps.js";
import { evaluateAssertions, type ConsoleEntry, type NetworkEntry } from "./assertions.js";
import { captureTraceCorrelation, DEFAULT_TRACE_HEADER } from "./tracing.js";
import { writeReports } from "../reporter/index.js";
import { timestamp } from "../utils/timestamp.js";
import { appendEntry as appendHistoryEntry } from "./history.js";

export type RunOptions = {
  huntName: string;
  urlOverride?: string;
  headed?: boolean;
  slowMo?: number;
  trace?: boolean;
  configPath?: string;
  onStep?: StepCallback;
  browser?: "chromium" | "firefox" | "webkit";
  channel?: BrowserChannel;
  viewport?: string;
  junit?: boolean;
  /** Inject a macOS helper client (tests / a prebuilt binary); defaults to spawning the helper. */
  macClientFactory?: () => MacHelperClient;
  /** Inject an Android session factory (tests); defaults to {@link launchAndroidSession}. */
  androidSessionFactory?: (options: LaunchAndroidOptions) => Promise<AndroidSession>;
};

function parseViewportFlag(value: string): string | { width: number; height: number } {
  const match = /^(\d+)x(\d+)$/i.exec(value);
  if (match) {
    return { width: Number(match[1]), height: Number(match[2]) };
  }
  return value;
}

function resolvePath(configDir: string, inputPath: string): string {
  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }
  const projectRoot = path.dirname(configDir);
  return path.join(projectRoot, inputPath);
}

function buildRunResult(options: {
  status: "pass" | "fail";
  startedAt: string;
  durationMs: number;
  hunt: string;
  targetUrl: string;
  steps: StepResult[];
  assertions: AssertionResult[];
  artifacts: RunResult["artifacts"];
  traceCorrelations?: TraceCorrelation[];
}): RunResult {
  return {
    status: options.status,
    exitCode: options.status === "pass" ? 0 : 1,
    startedAt: options.startedAt,
    durationMs: options.durationMs,
    hunt: options.hunt,
    targetUrl: options.targetUrl,
    steps: options.steps,
    assertions: options.assertions,
    artifacts: options.artifacts,
    // Omit entirely when there are no correlations, so passing/clean runs stay tidy.
    ...(options.traceCorrelations && options.traceCorrelations.length > 0
      ? { traceCorrelations: options.traceCorrelations }
      : {})
  };
}

function writeConsoleLog(runDir: string, entries: ConsoleEntry[]): string {
  const fileName = "console.log";
  const filePath = path.join(runDir, fileName);
  const lines = entries.map((entry) => {
    const location = entry.location ? ` (${entry.location})` : "";
    return `[${entry.type}] ${entry.text}${location}`;
  });
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`);
  return fileName;
}

async function executeHuntAttempt(
  options: RunOptions,
  config: ReturnType<typeof loadConfig>["config"],
  configDir: string,
  interpolatedHunt: ReturnType<typeof interpolateHunt>["hunt"],
  redactedFillSteps: Set<string>,
  randomVars: ReturnType<typeof interpolateHunt>["randomVars"],
  redactionValues: readonly string[],
  targetUrl: string,
  allowedDomains: string[]
): Promise<{ result: RunResult; runDir: string; steps: Step[] }> {
  const headless = options.headed ? false : config.browser.headless;
  const slowMo = options.slowMo ?? config.browser.slowMo;
  const maxSteps = config.guardrails.maxSteps;

  const runDir = path.join(configDir, "runs", timestamp());
  fs.mkdirSync(runDir, { recursive: true });

  const storageStatePath = config.auth.storageStatePath
    ? resolvePath(configDir, config.auth.storageStatePath)
    : undefined;

  const engine = options.browser ?? config.browser.engine;
  const channel = options.channel ?? config.browser.channel;
  const viewport = options.viewport
    ? resolveViewport(parseViewportFlag(options.viewport))
    : config.browser.viewport;

  const session = await launchBrowser({
    headless,
    slowMo,
    timeout: config.browser.timeout,
    storageStatePath,
    trace: Boolean(options.trace),
    recordHar: config.artifacts.networkHar,
    runDir,
    engine,
    channel,
    viewport
  });

  let result: RunResult;
  try {
    const driver = createPlaywrightDriver(session.page);
    const consoleEntries: ConsoleEntry[] = [];
    const networkEntries: NetworkEntry[] = [];
    const traceCorrelations: TraceCorrelation[] = [];
    const traceHeader = config.tracing?.header ?? DEFAULT_TRACE_HEADER;

    session.page.on("console", (message) => {
      consoleEntries.push({
        type: message.type(),
        text: message.text(),
        location: message.location().url
      });
    });

    driver.onResponse((response) => {
      if (response.status() >= 400) {
        networkEntries.push({ url: response.url(), status: response.status() });
        captureTraceCorrelation(response, traceHeader, traceCorrelations, redactionValues);
      }
    });

    const startedAt = new Date().toISOString();
    const startTime = Date.now();

    let stepResults: StepResult[] = [];
    let stepScreenshots: string[] = [];
    let stepFailed = false;

    try {
      const stepExecution = await executeSteps({
        page: session.page,
        driver,
        steps: interpolatedHunt.steps,
        targetUrl,
        runDir,
        screenshotsMode: config.artifacts.screenshots,
        forbiddenSelectors: config.guardrails.forbiddenSelectors,
        allowedDomains,
        maxSteps,
        maxTotalTimeMs: config.assertions.maxTotalTimeMs,
        selfHealing: config.guardrails.selfHealing,
        redactedFillSteps,
        randomVars,
        configDir,
        huntStack: [options.huntName],
        onStep: options.onStep
      });

      stepResults = stepExecution.results;
      stepScreenshots = stepExecution.screenshots;
      stepFailed = stepExecution.failed;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Step execution failed";
      stepResults = [
        {
          type: "steps",
          status: "fail",
          durationMs: 0,
          error: message
        }
      ];
      stepFailed = true;
    }

    let finalScreenshot: string | undefined;
    try {
      finalScreenshot = await captureFinalScreenshot(driver, runDir);
    } catch {
      finalScreenshot = undefined;
    }

    const assertionResults = await evaluateAssertions({
      page: session.page,
      config,
      huntAssertions: interpolatedHunt.assertions,
      consoleEntries,
      networkEntries
    });

    const durationMs = Date.now() - startTime;
    const assertionsFailed = assertionResults.some((assertion) => assertion.status === "fail");

    const status: "pass" | "fail" = stepFailed || assertionsFailed ? "fail" : "pass";

    const artifacts: RunResult["artifacts"] = {
      screenshots: finalScreenshot
        ? [...stepScreenshots, finalScreenshot]
        : stepScreenshots,
      trace: session.tracePath ? "trace.zip" : undefined,
      networkHar: config.artifacts.networkHar ? "network.har" : undefined
    };

    if (config.artifacts.console) {
      artifacts.console = writeConsoleLog(runDir, consoleEntries);
    }

    const runResult = buildRunResult({
      status,
      startedAt,
      durationMs,
      hunt: options.huntName,
      targetUrl,
      steps: stepResults,
      assertions: assertionResults,
      artifacts,
      traceCorrelations
    });

    result = writeReports(runDir, runResult, { junit: options.junit ?? config.artifacts.junit });
  } finally {
    await closeBrowser(session);
  }

  return { result, runDir, steps: interpolatedHunt.steps };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runHunt(
  options: RunOptions
): Promise<{ result: RunResult; runDir: string; steps: Step[] }> {
  const { config, configDir } = loadConfig(options.configPath);

  if (config.target.type === "macos") {
    return runMacHunt(options, config, configDir, config.target);
  }

  if (config.target.type === "android") {
    return runAndroidHunt(options, config, configDir, config.target);
  }

  const hunt = loadHunt(options.huntName, configDir);
  const {
    hunt: interpolatedHunt,
    redactedFillSteps,
    randomVars,
    redactionValues = []
  } = interpolateHunt(
    hunt,
    process.env
  );

  const targetUrl = options.urlOverride ?? config.target.url;
  const allowedDomains = ensureAllowedDomain([...config.guardrails.allowedDomains], targetUrl);
  const maxSteps = config.guardrails.maxSteps;

  if (interpolatedHunt.steps.length > maxSteps) {
    throw new Error(`Hunt has ${interpolatedHunt.steps.length} steps. Max allowed is ${maxSteps}.`);
  }

  const maxRetries = hunt.retry?.maxRetries ?? 0;
  const retryDelay = hunt.retry?.delay ?? 0;

  let lastResult: { result: RunResult; runDir: string; steps: Step[] } | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0 && retryDelay > 0) {
      await delay(retryDelay);
    }

    lastResult = await executeHuntAttempt(
      options,
      config,
      configDir,
      interpolatedHunt,
      redactedFillSteps,
      randomVars,
      redactionValues,
      targetUrl,
      allowedDomains
    );

    if (lastResult.result.status === "pass") {
      if (attempt > 0) {
        lastResult.result.artifacts.summary =
          `Passed on attempt ${attempt + 1} of ${maxRetries + 1}`;
      }
      recordHistory(configDir, lastResult, config.history.maxRuns);
      return lastResult;
    }
  }

  if (maxRetries > 0 && lastResult) {
    lastResult.result.artifacts.summary =
      `Failed after ${maxRetries + 1} attempts`;
  }

  if (lastResult) {
    recordHistory(configDir, lastResult, config.history.maxRuns);
  }

  return lastResult!;
}

// ---------------------------------------------------------------------------
// macOS native target (PROWL-048). A dedicated run path: no browser, no console/
// network assertions or HAR/trace (all web concepts). Steps run through the
// MacDriver over the prowl-macdriver helper; artifacts are step + final
// screenshots and the usual reports.
// ---------------------------------------------------------------------------

async function executeMacHuntAttempt(
  options: RunOptions,
  config: Config,
  configDir: string,
  target: MacosTarget,
  interpolatedHunt: ReturnType<typeof interpolateHunt>["hunt"],
  redactedFillSteps: Set<string>,
  randomVars: ReturnType<typeof interpolateHunt>["randomVars"],
  allowedApps: string[]
): Promise<{ result: RunResult; runDir: string; steps: Step[] }> {
  const maxSteps = config.guardrails.maxSteps;
  const runDir = path.join(configDir, "runs", timestamp());
  fs.mkdirSync(runDir, { recursive: true });

  const session = await launchMacSession({
    app: target.app,
    timeoutMs: config.browser.timeout,
    clientFactory: options.macClientFactory
  });

  let result: RunResult;
  try {
    const targetLabel = `macos:${session.bundleId}`;
    const effectiveAllowedApps = [...new Set([...allowedApps, target.app, session.bundleId])];
    const startedAt = new Date().toISOString();
    const startTime = Date.now();

    let stepResults: StepResult[] = [];
    let stepScreenshots: string[] = [];
    let stepFailed = false;

    try {
      const stepExecution = await executeSteps({
        driver: session.driver,
        steps: interpolatedHunt.steps,
        targetUrl: targetLabel,
        runDir,
        screenshotsMode: config.artifacts.screenshots,
        forbiddenSelectors: config.guardrails.forbiddenSelectors,
        allowedDomains: [],
        allowedApps: effectiveAllowedApps,
        maxSteps,
        maxTotalTimeMs: config.assertions.maxTotalTimeMs,
        selfHealing: config.guardrails.selfHealing,
        redactedFillSteps,
        randomVars,
        configDir,
        huntStack: [options.huntName],
        onStep: options.onStep
      });
      stepResults = stepExecution.results;
      stepScreenshots = stepExecution.screenshots;
      stepFailed = stepExecution.failed;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Step execution failed";
      stepResults = [{ type: "steps", status: "fail", durationMs: 0, error: message }];
      stepFailed = true;
    }

    let finalScreenshot: string | undefined;
    try {
      finalScreenshot = await captureFinalScreenshot(session.driver, runDir);
    } catch {
      finalScreenshot = undefined;
    }

    const durationMs = Date.now() - startTime;
    const status: "pass" | "fail" = stepFailed ? "fail" : "pass";
    const artifacts: RunResult["artifacts"] = {
      screenshots: finalScreenshot ? [...stepScreenshots, finalScreenshot] : stepScreenshots
    };

    const runResult = buildRunResult({
      status,
      startedAt,
      durationMs,
      hunt: options.huntName,
      targetUrl: targetLabel,
      steps: stepResults,
      assertions: [],
      artifacts
    });

    result = writeReports(runDir, runResult, { junit: options.junit ?? config.artifacts.junit });
  } finally {
    await closeMacSession(session);
  }

  return { result, runDir, steps: interpolatedHunt.steps };
}

async function runMacHunt(
  options: RunOptions,
  config: Config,
  configDir: string,
  target: MacosTarget
): Promise<{ result: RunResult; runDir: string; steps: Step[] }> {
  const hunt = loadHunt(options.huntName, configDir);
  const { hunt: interpolatedHunt, redactedFillSteps, randomVars } = interpolateHunt(hunt, process.env);

  // Fail fast on web-only steps/assertions and out-of-scope apps before launching anything.
  assertStepsSupportedByTarget(interpolatedHunt.steps, "macos");
  assertHuntAssertionsSupportedByTarget(interpolatedHunt.assertions, "macos");
  assertTargetAppAllowed(config.guardrails.allowedApps, target.app);

  const maxSteps = config.guardrails.maxSteps;
  if (interpolatedHunt.steps.length > maxSteps) {
    throw new Error(`Hunt has ${interpolatedHunt.steps.length} steps. Max allowed is ${maxSteps}.`);
  }

  const maxRetries = hunt.retry?.maxRetries ?? 0;
  const retryDelay = hunt.retry?.delay ?? 0;
  let lastResult: { result: RunResult; runDir: string; steps: Step[] } | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0 && retryDelay > 0) {
      await delay(retryDelay);
    }
    lastResult = await executeMacHuntAttempt(
      options,
      config,
      configDir,
      target,
      interpolatedHunt,
      redactedFillSteps,
      randomVars,
      config.guardrails.allowedApps
    );
    if (lastResult.result.status === "pass") {
      if (attempt > 0) {
        lastResult.result.artifacts.summary = `Passed on attempt ${attempt + 1} of ${maxRetries + 1}`;
      }
      recordHistory(configDir, lastResult, config.history.maxRuns);
      return lastResult;
    }
  }

  if (maxRetries > 0 && lastResult) {
    lastResult.result.artifacts.summary = `Failed after ${maxRetries + 1} attempts`;
  }
  if (lastResult) {
    recordHistory(configDir, lastResult, config.history.maxRuns);
  }
  return lastResult!;
}

// ---------------------------------------------------------------------------
// Android native target (PROWL-058). Mirrors the macOS run path: no browser, no
// console/network assertions or HAR/trace. Steps run through the AndroidDriver
// over the on-device uiautomator2 agent; artifacts are step + final screenshots
// and the usual reports.
// ---------------------------------------------------------------------------

async function executeAndroidHuntAttempt(
  options: RunOptions,
  config: Config,
  configDir: string,
  target: AndroidTarget,
  interpolatedHunt: ReturnType<typeof interpolateHunt>["hunt"],
  redactedFillSteps: Set<string>,
  randomVars: ReturnType<typeof interpolateHunt>["randomVars"],
  allowedApps: string[]
): Promise<{ result: RunResult; runDir: string; steps: Step[] }> {
  const maxSteps = config.guardrails.maxSteps;
  const runDir = path.join(configDir, "runs", timestamp());
  fs.mkdirSync(runDir, { recursive: true });

  const launch = options.androidSessionFactory ?? launchAndroidSession;
  const session = await launch({
    app: target.app,
    deviceSerial: target.deviceSerial,
    coldStart: target.coldStart,
    timeoutMs: config.browser.timeout
  });

  let result: RunResult;
  try {
    const targetLabel = `android:${session.package}`;
    const effectiveAllowedApps = [...new Set([...allowedApps, target.app, session.package])];
    const startedAt = new Date().toISOString();
    const startTime = Date.now();

    let stepResults: StepResult[] = [];
    let stepScreenshots: string[] = [];
    let stepFailed = false;

    try {
      const stepExecution = await executeSteps({
        driver: session.driver,
        targetType: "android",
        steps: interpolatedHunt.steps,
        targetUrl: targetLabel,
        runDir,
        screenshotsMode: config.artifacts.screenshots,
        forbiddenSelectors: config.guardrails.forbiddenSelectors,
        allowedDomains: [],
        allowedApps: effectiveAllowedApps,
        maxSteps,
        maxTotalTimeMs: config.assertions.maxTotalTimeMs,
        selfHealing: config.guardrails.selfHealing,
        redactedFillSteps,
        randomVars,
        configDir,
        huntStack: [options.huntName],
        onStep: options.onStep
      });
      stepResults = stepExecution.results;
      stepScreenshots = stepExecution.screenshots;
      stepFailed = stepExecution.failed;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Step execution failed";
      stepResults = [{ type: "steps", status: "fail", durationMs: 0, error: message }];
      stepFailed = true;
    }

    let finalScreenshot: string | undefined;
    try {
      finalScreenshot = await captureFinalScreenshot(session.driver, runDir);
    } catch {
      finalScreenshot = undefined;
    }

    const durationMs = Date.now() - startTime;
    const status: "pass" | "fail" = stepFailed ? "fail" : "pass";
    const artifacts: RunResult["artifacts"] = {
      screenshots: finalScreenshot ? [...stepScreenshots, finalScreenshot] : stepScreenshots
    };

    const runResult = buildRunResult({
      status,
      startedAt,
      durationMs,
      hunt: options.huntName,
      targetUrl: targetLabel,
      steps: stepResults,
      assertions: [],
      artifacts
    });

    result = writeReports(runDir, runResult, { junit: options.junit ?? config.artifacts.junit });
  } finally {
    await closeAndroidSession(session);
  }

  return { result, runDir, steps: interpolatedHunt.steps };
}

async function runAndroidHunt(
  options: RunOptions,
  config: Config,
  configDir: string,
  target: AndroidTarget
): Promise<{ result: RunResult; runDir: string; steps: Step[] }> {
  const hunt = loadHunt(options.huntName, configDir);
  const { hunt: interpolatedHunt, redactedFillSteps, randomVars } = interpolateHunt(hunt, process.env);

  // Fail fast on web-only steps/assertions and out-of-scope apps before launching anything.
  assertStepsSupportedByTarget(interpolatedHunt.steps, "android");
  assertHuntAssertionsSupportedByTarget(interpolatedHunt.assertions, "android");
  assertAndroidAppAllowed(config.guardrails.allowedApps, target.app);

  const maxSteps = config.guardrails.maxSteps;
  if (interpolatedHunt.steps.length > maxSteps) {
    throw new Error(`Hunt has ${interpolatedHunt.steps.length} steps. Max allowed is ${maxSteps}.`);
  }

  const maxRetries = hunt.retry?.maxRetries ?? 0;
  const retryDelay = hunt.retry?.delay ?? 0;
  let lastResult: { result: RunResult; runDir: string; steps: Step[] } | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0 && retryDelay > 0) {
      await delay(retryDelay);
    }
    lastResult = await executeAndroidHuntAttempt(
      options,
      config,
      configDir,
      target,
      interpolatedHunt,
      redactedFillSteps,
      randomVars,
      config.guardrails.allowedApps
    );
    if (lastResult.result.status === "pass") {
      if (attempt > 0) {
        lastResult.result.artifacts.summary = `Passed on attempt ${attempt + 1} of ${maxRetries + 1}`;
      }
      recordHistory(configDir, lastResult, config.history.maxRuns);
      return lastResult;
    }
  }

  if (maxRetries > 0 && lastResult) {
    lastResult.result.artifacts.summary = `Failed after ${maxRetries + 1} attempts`;
  }
  if (lastResult) {
    recordHistory(configDir, lastResult, config.history.maxRuns);
  }
  return lastResult!;
}

function recordHistory(
  configDir: string,
  outcome: { result: RunResult; runDir: string },
  maxRuns: number
): void {
  try {
    const relativeRunDir = path.relative(configDir, outcome.runDir);
    appendHistoryEntry(
      configDir,
      {
        hunt: outcome.result.hunt,
        status: outcome.result.status,
        durationMs: outcome.result.durationMs,
        startedAt: outcome.result.startedAt,
        runDir: relativeRunDir || undefined
      },
      maxRuns
    );
  } catch {
    // History is observability only; a write failure must never break a run.
  }
}
