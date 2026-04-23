import fs from "node:fs";
import path from "node:path";
import type { AssertionResult, BrowserChannel, RunResult, Step, StepResult } from "../types/index.js";
import { loadConfig, loadHunt, ensureAllowedDomain, resolveViewport } from "../config/loader.js";
import { interpolateHunt } from "../config/interpolate.js";
import { launchBrowser, closeBrowser } from "../browser/controller.js";
import { captureFinalScreenshot, executeSteps, type StepCallback } from "./steps.js";
import { evaluateAssertions, type ConsoleEntry, type NetworkEntry } from "./assertions.js";
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
    artifacts: options.artifacts
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
    const consoleEntries: ConsoleEntry[] = [];
    const networkEntries: NetworkEntry[] = [];

    session.page.on("console", (message) => {
      consoleEntries.push({
        type: message.type(),
        text: message.text(),
        location: message.location().url
      });
    });

    session.page.on("response", (response) => {
      if (response.status() >= 400) {
        networkEntries.push({ url: response.url(), status: response.status() });
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
        steps: interpolatedHunt.steps,
        targetUrl,
        runDir,
        screenshotsMode: config.artifacts.screenshots,
        forbiddenSelectors: config.guardrails.forbiddenSelectors,
        allowedDomains,
        maxSteps,
        maxTotalTimeMs: config.assertions.maxTotalTimeMs,
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
      finalScreenshot = await captureFinalScreenshot(session.page, runDir);
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
      artifacts
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
  const hunt = loadHunt(options.huntName, configDir);
  const { hunt: interpolatedHunt, redactedFillSteps, randomVars } = interpolateHunt(
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
