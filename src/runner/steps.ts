import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import {
  clickElement,
  fillElement,
  pressKey,
  selectOption,
  setupDialogHandler,
  setInputFiles
} from "../browser/actions.js";
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
  configDir: string;
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
  if ("type" in step) return "type";
  if ("selectOption" in step) return "selectOption";
  if ("select" in step) return "select";
  if ("onDialog" in step) return "onDialog";
  if ("setInputFiles" in step) return "setInputFiles";
  if ("assert" in step) return "assert";
  if ("press" in step) return "press";
  if ("wait" in step) return "wait";
  if ("waitForSelector" in step) return "waitForSelector";
  if ("waitForUrl" in step) return "waitForUrl";
  if ("waitForNetworkIdle" in step) return "waitForNetworkIdle";
  if ("screenshot" in step) return "screenshot";
  return "step";
}

function isExplicitFillStep(
  value: { selector: string; value: string } | Record<string, string>
): value is { selector: string; value: string } {
  return (
    typeof (value as { selector?: unknown }).selector === "string" &&
    typeof (value as { value?: unknown }).value === "string"
  );
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

function escapeForText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeForAttribute(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function textSelector(text: string): string {
  return `text="${escapeForText(text)}"`;
}

function getSinglePair(value: Record<string, string>, stepType: string): [string, string] {
  const entries = Object.entries(value);
  if (entries.length !== 1) {
    throw new Error(`${stepType} shorthand expects exactly one key-value pair`);
  }
  return entries[0];
}

async function clickByTextWithFallback(page: Page, text: string): Promise<string> {
  const button = page.getByRole("button", { name: text });
  if (await button.count()) {
    await button.first().click();
    return `role=button[name="${text}"]`;
  }

  const selector = textSelector(text);
  await page.locator(selector).first().click();
  return selector;
}

async function fillByLabelOrPlaceholder(
  page: Page,
  label: string,
  value: string
): Promise<string> {
  const byLabel = page.getByLabel(label, { exact: true });
  if (await byLabel.count()) {
    await byLabel.first().fill(value);
    return `label="${label}"`;
  }

  const placeholder = `input[placeholder="${escapeForAttribute(label)}"], textarea[placeholder="${escapeForAttribute(label)}"]`;
  const byPlaceholder = page.locator(placeholder);
  if (await byPlaceholder.count()) {
    await byPlaceholder.first().fill(value);
    return placeholder;
  }

  throw new Error(`Could not resolve fill shorthand for "${label}"`);
}

async function selectByLabelOrFallback(
  page: Page,
  label: string,
  value: string
): Promise<string> {
  const byLabel = page.getByLabel(label, { exact: true });
  if (await byLabel.count()) {
    await byLabel.first().selectOption(value);
    return `label="${label}"`;
  }

  const ariaSelector = `select[aria-label="${escapeForAttribute(label)}"]`;
  const byAria = page.locator(ariaSelector);
  if (await byAria.count()) {
    await byAria.first().selectOption(value);
    return ariaSelector;
  }

  const placeholderSelector = `select[placeholder="${escapeForAttribute(label)}"]`;
  const byPlaceholder = page.locator(placeholderSelector);
  if (await byPlaceholder.count()) {
    await byPlaceholder.first().selectOption(value);
    return placeholderSelector;
  }

  throw new Error(`Could not resolve select shorthand for "${label}"`);
}

async function runInlineAssert(
  page: Page,
  assertion: {
    visible?: string;
    notVisible?: string;
    urlIncludes?: string;
    urlEquals?: string;
  }
): Promise<string> {
  if (assertion.visible !== undefined) {
    const selector = textSelector(assertion.visible);
    const count = await page.locator(selector).count();
    if (count === 0) {
      throw new Error(`Expected visible text: ${assertion.visible}`);
    }
    return `visible:${assertion.visible}`;
  }

  if (assertion.notVisible !== undefined) {
    const selector = textSelector(assertion.notVisible);
    const count = await page.locator(selector).count();
    if (count > 0) {
      throw new Error(`Expected text to be hidden: ${assertion.notVisible}`);
    }
    return `notVisible:${assertion.notVisible}`;
  }

  if (assertion.urlIncludes !== undefined) {
    const current = page.url();
    if (!current.includes(assertion.urlIncludes)) {
      throw new Error(`URL did not include ${assertion.urlIncludes}`);
    }
    return `urlIncludes:${assertion.urlIncludes}`;
  }

  if (assertion.urlEquals !== undefined) {
    const current = page.url();
    if (current !== assertion.urlEquals) {
      throw new Error(`URL did not equal ${assertion.urlEquals}`);
    }
    return `urlEquals:${assertion.urlEquals}`;
  }

  throw new Error("assert step is missing an assertion type");
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
        let selector: string;
        if (typeof step.click === "string") {
          selector = await clickByTextWithFallback(context.page, step.click);
        } else {
          if (isForbiddenSelector(step.click.selector, context.forbiddenSelectors)) {
            throw new Error(`Forbidden selector: ${step.click.selector}`);
          }
          await clickElement(context.page, step.click.selector);
          selector = step.click.selector;
        }
        ensureAllowedUrl(context.page.url(), context.allowedDomains);
        stepResult = {
          type: "click",
          status: "pass",
          durationMs: Date.now() - stepStart,
          selector
        };
      } else if ("fill" in step) {
        let selector: string;
        let value: string;
        if (isExplicitFillStep(step.fill)) {
          if (isForbiddenSelector(step.fill.selector, context.forbiddenSelectors)) {
            throw new Error(`Forbidden selector: ${step.fill.selector}`);
          }
          await fillElement(context.page, step.fill.selector, step.fill.value);
          selector = step.fill.selector;
          value = step.fill.value;
        } else {
          const [label, shorthandValue] = getSinglePair(step.fill, "fill");
          selector = await fillByLabelOrPlaceholder(context.page, label, shorthandValue);
          value = shorthandValue;
        }
        ensureAllowedUrl(context.page.url(), context.allowedDomains);
        stepResult = {
          type: "fill",
          status: "pass",
          durationMs: Date.now() - stepStart,
          selector,
          value: context.redactedFillSteps.has(index) ? "[REDACTED]" : value
        };
      } else if ("type" in step) {
        await fillElement(context.page, ":focus", step.type);
        ensureAllowedUrl(context.page.url(), context.allowedDomains);
        stepResult = {
          type: "type",
          status: "pass",
          durationMs: Date.now() - stepStart,
          selector: ":focus",
          value: step.type
        };
      } else if ("selectOption" in step) {
        if (isForbiddenSelector(step.selectOption.selector, context.forbiddenSelectors)) {
          throw new Error(`Forbidden selector: ${step.selectOption.selector}`);
        }
        await selectOption(context.page, step.selectOption.selector, step.selectOption.value);
        ensureAllowedUrl(context.page.url(), context.allowedDomains);
        stepResult = {
          type: "selectOption",
          status: "pass",
          durationMs: Date.now() - stepStart,
          selector: step.selectOption.selector,
          value: step.selectOption.value
        };
      } else if ("select" in step) {
        const [label, value] = getSinglePair(step.select, "select");
        const selector = await selectByLabelOrFallback(context.page, label, value);
        ensureAllowedUrl(context.page.url(), context.allowedDomains);
        stepResult = {
          type: "select",
          status: "pass",
          durationMs: Date.now() - stepStart,
          selector,
          value
        };
      } else if ("onDialog" in step) {
        setupDialogHandler(context.page, step.onDialog.action);
        stepResult = {
          type: "onDialog",
          status: "pass",
          durationMs: Date.now() - stepStart,
          value: step.onDialog.action
        };
      } else if ("setInputFiles" in step) {
        if (isForbiddenSelector(step.setInputFiles.selector, context.forbiddenSelectors)) {
          throw new Error(`Forbidden selector: ${step.setInputFiles.selector}`);
        }
        const rawFiles = step.setInputFiles.files;
        const resolveFile = (f: string) =>
          path.isAbsolute(f) ? f : path.join(context.configDir, f);
        const resolvedFiles = Array.isArray(rawFiles)
          ? rawFiles.map(resolveFile)
          : resolveFile(rawFiles);
        await setInputFiles(context.page, step.setInputFiles.selector, resolvedFiles);
        ensureAllowedUrl(context.page.url(), context.allowedDomains);
        const filesLabel = Array.isArray(rawFiles) ? rawFiles.join(", ") : rawFiles;
        stepResult = {
          type: "setInputFiles",
          status: "pass",
          durationMs: Date.now() - stepStart,
          selector: step.setInputFiles.selector,
          value: filesLabel
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
      } else if ("assert" in step) {
        const value = await runInlineAssert(context.page, step.assert);
        stepResult = {
          type: "assert",
          status: "pass",
          durationMs: Date.now() - stepStart,
          value
        };
      } else if ("wait" in step) {
        const selector = typeof step.wait === "string" ? textSelector(step.wait) : textSelector(step.wait.for);
        const timeout = typeof step.wait === "string" ? undefined : step.wait.timeout;
        await context.page.waitForSelector(selector, { timeout });
        stepResult = {
          type: "wait",
          status: "pass",
          durationMs: Date.now() - stepStart,
          selector
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
