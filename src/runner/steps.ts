import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { clickElement, fillElement, pressKey } from "../browser/actions.js";
import type { Step, StepResult } from "../types/index.js";

export type StepExecutionContext = {
  page: Page;
  steps: Step[];
  targetUrl: string;
  runDir: string;
  screenshotsMode: "on-failure" | "all";
  forbiddenSelectors: string[];
  allowedDomains: string[];
  maxTotalTimeMs: number;
  redactedFillSteps: Set<number>;
};

export type StepExecutionResult = {
  results: StepResult[];
  screenshots: string[];
  failed: boolean;
  error?: string;
};

const ALWAYS_ALLOWED_PROTOCOLS = ["about:", "data:"];

function isForbiddenSelector(selector: string, forbiddenSelectors: string[]): boolean {
  return forbiddenSelectors.some((forbidden) => selector.includes(forbidden));
}

function getStepType(step: Step): string {
  if ("navigate" in step) return "navigate";
  if ("click" in step) return "click";
  if ("fill" in step) return "fill";
  if ("press" in step) return "press";
  if ("waitForSelector" in step) return "waitForSelector";
  if ("waitForUrl" in step) return "waitForUrl";
  if ("waitForNetworkIdle" in step) return "waitForNetworkIdle";
  if ("screenshot" in step) return "screenshot";
  return "step";
}

function ensureAllowedUrl(urlValue: string, allowedDomains: string[]): void {
  for (const protocol of ALWAYS_ALLOWED_PROTOCOLS) {
    if (urlValue.startsWith(protocol)) {
      return;
    }
  }
  const url = new URL(urlValue);
  if (!allowedDomains.includes(url.hostname)) {
    throw new Error(`Navigation to disallowed domain: ${url.hostname}`);
  }
}

function resolveNavigationTarget(targetUrl: string, value: string): string {
  try {
    return new URL(value, targetUrl).toString();
  } catch {
    return value;
  }
}

function screenshotPath(screenshotsDir: string, fileName: string): string {
  return path.join(screenshotsDir, fileName);
}

async function captureScreenshot(page: Page, filePath: string): Promise<void> {
  try {
    await page.screenshot({ path: filePath, fullPage: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Screenshot failed";
    throw new Error(`Failed to capture screenshot at ${filePath}: ${message}`);
  }
}

export async function executeSteps(context: StepExecutionContext): Promise<StepExecutionResult> {
  const screenshotsDir = path.join(context.runDir, "screenshots");
  fs.mkdirSync(screenshotsDir, { recursive: true });

  const results: StepResult[] = [];
  const screenshots: string[] = [];
  const startTime = Date.now();

  const addScreenshot = async (fileName: string): Promise<string> => {
    const fullPath = screenshotPath(screenshotsDir, fileName);
    await captureScreenshot(context.page, fullPath);
    const relative = path.join("screenshots", fileName);
    screenshots.push(relative);
    return relative;
  };

  for (let index = 0; index < context.steps.length; index += 1) {
    if (Date.now() - startTime > context.maxTotalTimeMs) {
      results.push({
        type: "timeout",
        status: "fail",
        durationMs: 0,
        error: `Max total time exceeded (${context.maxTotalTimeMs}ms)`
      });
      return { results, screenshots, failed: true, error: "Max total time exceeded" };
    }

    const step = context.steps[index];
    const stepStart = Date.now();
    const stepType = getStepType(step);
    let stepResult: StepResult | null = null;

    try {
      if ("navigate" in step) {
        const destination = resolveNavigationTarget(context.targetUrl, step.navigate);
        ensureAllowedUrl(destination, context.allowedDomains);
        await context.page.goto(destination);
        ensureAllowedUrl(context.page.url(), context.allowedDomains);
        stepResult = { type: "navigate", status: "pass", durationMs: Date.now() - stepStart };
      } else if ("click" in step) {
        if (isForbiddenSelector(step.click.selector, context.forbiddenSelectors)) {
          throw new Error(`Forbidden selector: ${step.click.selector}`);
        }
        await clickElement(context.page, step.click.selector);
        ensureAllowedUrl(context.page.url(), context.allowedDomains);
        stepResult = {
          type: "click",
          status: "pass",
          durationMs: Date.now() - stepStart,
          selector: step.click.selector
        };
      } else if ("fill" in step) {
        if (isForbiddenSelector(step.fill.selector, context.forbiddenSelectors)) {
          throw new Error(`Forbidden selector: ${step.fill.selector}`);
        }
        await fillElement(context.page, step.fill.selector, step.fill.value);
        ensureAllowedUrl(context.page.url(), context.allowedDomains);
        stepResult = {
          type: "fill",
          status: "pass",
          durationMs: Date.now() - stepStart,
          selector: step.fill.selector,
          value: context.redactedFillSteps.has(index) ? "[REDACTED]" : step.fill.value
        };
      } else if ("press" in step) {
        if (isForbiddenSelector(step.press.selector, context.forbiddenSelectors)) {
          throw new Error(`Forbidden selector: ${step.press.selector}`);
        }
        await pressKey(context.page, step.press.selector, step.press.key);
        ensureAllowedUrl(context.page.url(), context.allowedDomains);
        stepResult = {
          type: "press",
          status: "pass",
          durationMs: Date.now() - stepStart,
          selector: step.press.selector
        };
      } else if ("waitForSelector" in step) {
        await context.page.waitForSelector(step.waitForSelector.selector, {
          timeout: step.waitForSelector.timeout
        });
        stepResult = {
          type: "waitForSelector",
          status: "pass",
          durationMs: Date.now() - stepStart,
          selector: step.waitForSelector.selector
        };
      } else if ("waitForUrl" in step) {
        await context.page.waitForURL(
          (url) => url.toString().includes(step.waitForUrl.value),
          { timeout: step.waitForUrl.timeout }
        );
        ensureAllowedUrl(context.page.url(), context.allowedDomains);
        stepResult = {
          type: "waitForUrl",
          status: "pass",
          durationMs: Date.now() - stepStart,
          value: step.waitForUrl.value
        };
      } else if ("waitForNetworkIdle" in step) {
        await context.page.waitForLoadState("networkidle", {
          timeout: step.waitForNetworkIdle.timeout
        });
        stepResult = {
          type: "waitForNetworkIdle",
          status: "pass",
          durationMs: Date.now() - stepStart
        };
      } else if ("screenshot" in step) {
        const name = step.screenshot.name ?? `manual_step_${index + 1}.png`;
        const fileName = name.endsWith(".png") ? name : `${name}.png`;
        const relative = await addScreenshot(fileName);
        stepResult = {
          type: "screenshot",
          status: "pass",
          durationMs: Date.now() - stepStart,
          screenshot: relative
        };
      }

      if (!stepResult) {
        throw new Error("Unknown step type");
      }

      if (context.screenshotsMode === "all" && stepResult.type !== "screenshot") {
        const fileName = `step_${index + 1}.png`;
        await addScreenshot(fileName);
      }

      results.push(stepResult);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Step failed";
      stepResult = {
        type: stepResult?.type ?? stepType,
        status: "fail",
        durationMs: Date.now() - stepStart,
        error: message
      };

      if (context.screenshotsMode === "on-failure") {
        const fileName = `failure_step_${index + 1}.png`;
        await addScreenshot(fileName);
      }

      results.push(stepResult);
      return { results, screenshots, failed: true, error: message };
    }
  }

  return { results, screenshots, failed: false };
}

export async function captureFinalScreenshot(page: Page, runDir: string): Promise<string> {
  const screenshotsDir = path.join(runDir, "screenshots");
  fs.mkdirSync(screenshotsDir, { recursive: true });
  const fileName = "final.png";
  const filePath = screenshotPath(screenshotsDir, fileName);
  await captureScreenshot(page, filePath);
  return path.join("screenshots", fileName);
}
