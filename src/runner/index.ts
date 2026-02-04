import fs from "node:fs";
import path from "node:path";
import type { AssertionResult, RunResult, StepResult } from "../types/index.js";
import { loadConfig, loadGoal, ensureAllowedDomain } from "../config/loader.js";
import { interpolateGoal } from "../config/interpolate.js";
import { launchBrowser, closeBrowser } from "../browser/controller.js";
import { captureFinalScreenshot, executeSteps } from "./steps.js";
import { evaluateAssertions, type ConsoleEntry, type NetworkEntry } from "./assertions.js";
import { writeReports } from "../reporter/index.js";

export type RunOptions = {
  goalName: string;
  urlOverride?: string;
  headed?: boolean;
  slowMo?: number;
  trace?: boolean;
  configPath?: string;
};

function timestamp(): string {
  const now = new Date();
  const pad = (value: number): string => value.toString().padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(
    now.getHours()
  )}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
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
  goal: string;
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
    goal: options.goal,
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

export async function runGoal(
  options: RunOptions
): Promise<{ result: RunResult; runDir: string }> {
  const { config, configDir } = loadConfig(options.configPath);
  const goal = loadGoal(options.goalName, configDir);
  const { goal: interpolatedGoal, redactedFillSteps } = interpolateGoal(goal, process.env);

  const targetUrl = options.urlOverride ?? config.target.url;
  const allowedDomains = ensureAllowedDomain([...config.guardrails.allowedDomains], targetUrl);

  const headless = options.headed ? false : config.browser.headless;
  const slowMo = options.slowMo ?? config.browser.slowMo;
  const maxSteps = config.guardrails.maxSteps;

  if (interpolatedGoal.steps.length > maxSteps) {
    throw new Error(`Goal has ${interpolatedGoal.steps.length} steps. Max allowed is ${maxSteps}.`);
  }

  const runDir = path.join(configDir, "runs", timestamp());
  fs.mkdirSync(runDir, { recursive: true });

  const storageStatePath = resolvePath(configDir, config.auth.storageStatePath);

  const session = await launchBrowser({
    headless,
    slowMo,
    timeout: config.browser.timeout,
    storageStatePath,
    trace: Boolean(options.trace),
    recordHar: config.artifacts.networkHar,
    runDir
  });

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
      steps: interpolatedGoal.steps,
      targetUrl,
      runDir,
      screenshotsMode: config.artifacts.screenshots,
      forbiddenSelectors: config.guardrails.forbiddenSelectors,
      allowedDomains,
      maxTotalTimeMs: config.assertions.maxTotalTimeMs,
      redactedFillSteps
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
    goalAssertions: interpolatedGoal.assertions,
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
    goal: options.goalName,
    targetUrl,
    steps: stepResults,
    assertions: assertionResults,
    artifacts
  });

  await closeBrowser(session);

  return { result: writeReports(runDir, runResult), runDir };
}
