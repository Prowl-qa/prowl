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
import { loadHunt } from "../config/loader.js";
import { interpolateHunt } from "../config/interpolate.js";

export type StepCallback = (result: StepResult, step: Step, index: number) => void;

export type StepExecutionContext = {
  page: Page;
  steps: Step[];
  targetUrl: string;
  runDir: string;
  screenshotsMode: "on-failure" | "all";
  forbiddenSelectors: string[];
  allowedDomains: string[];
  maxSteps: number;
  maxTotalTimeMs: number;
  redactedFillSteps: Set<string>;
  configDir: string;
  onStep?: StepCallback;
  huntStack?: string[];
  activeMocks?: Map<string, () => Promise<void>>;
  runStartedAtMs?: number;
  stepPathPrefix?: string;
};

export type StepExecutionResult = {
  results: StepResult[];
  screenshots: string[];
  failed: boolean;
  error?: string;
};

const ALWAYS_ALLOWED_PROTOCOLS = ["about:", "data:"];

function unwrapTextSelector(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.startsWith('text="') && trimmed.endsWith('"')) {
    return trimmed.slice(6, -1);
  }
  if (trimmed.startsWith("text='") && trimmed.endsWith("'")) {
    return trimmed.slice(6, -1);
  }
  if (trimmed.startsWith("text=")) {
    return trimmed.slice(5);
  }
  return null;
}

// Substring match: if both the selector and forbidden pattern are text= selectors,
// the selector's text is checked for whether it *contains* the forbidden text.
// For example, forbidden 'text="Delete"' would match selector 'text="Delete All"'.
function matchesForbiddenPattern(selector: string, forbidden: string): boolean {
  const selectorText = unwrapTextSelector(selector);
  if (selectorText === null) {
    return false;
  }

  const forbiddenText = unwrapTextSelector(forbidden);
  if (forbiddenText !== null) {
    return selectorText.includes(forbiddenText);
  }

  return selectorText.includes(forbidden);
}

// Uses substring matching: a selector is forbidden if it contains any forbidden
// pattern as a substring (e.g., forbidden "[data-danger]" matches "[data-danger].active"),
// or if the text-based pattern match above succeeds.
function isForbiddenSelector(selector: string, forbiddenSelectors: string[]): boolean {
  return forbiddenSelectors.some(
    (forbidden) => selector.includes(forbidden) || matchesForbiddenPattern(selector, forbidden)
  );
}

function assertAllowedSelector(selector: string, forbiddenSelectors: string[]): void {
  if (isForbiddenSelector(selector, forbiddenSelectors)) {
    throw new Error(`Forbidden selector: ${selector}`);
  }
}

function assertWithinMaxSteps(stepCount: number, maxSteps: number, huntName?: string): void {
  if (stepCount > maxSteps) {
    if (huntName) {
      throw new Error(`Hunt "${huntName}" has ${stepCount} steps. Max allowed is ${maxSteps}.`);
    }
    throw new Error(`Hunt has ${stepCount} steps. Max allowed is ${maxSteps}.`);
  }
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
  if ("runHunt" in step) return "runHunt";
  if ("assert" in step) return "assert";
  if ("press" in step) return "press";
  if ("wait" in step) return "wait";
  if ("waitForSelector" in step) return "waitForSelector";
  if ("waitForUrl" in step) return "waitForUrl";
  if ("waitForNetworkIdle" in step) return "waitForNetworkIdle";
  if ("hover" in step) return "hover";
  if ("scroll" in step) return "scroll";
  if ("scrollTo" in step) return "scrollTo";
  if ("screenshot" in step) return "screenshot";
  if ("if" in step) return "if";
  if ("repeat" in step) return "repeat";
  if ("mockRoute" in step) return "mockRoute";
  if ("unmockRoute" in step) return "unmockRoute";
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

async function clickByTextWithFallback(
  page: Page,
  text: string,
  forbiddenSelectors: string[]
): Promise<string> {
  const roleSelector = `role=button[name="${escapeForAttribute(text)}"]`;
  assertAllowedSelector(roleSelector, forbiddenSelectors);
  const button = page.getByRole("button", { name: text });
  if (await button.count()) {
    await button.first().click();
    return roleSelector;
  }

  const selector = textSelector(text);
  assertAllowedSelector(selector, forbiddenSelectors);
  await page.locator(selector).first().click();
  return selector;
}

async function fillByLabelOrPlaceholder(
  page: Page,
  label: string,
  value: string,
  forbiddenSelectors: string[]
): Promise<string> {
  const labelSelector = `label="${escapeForAttribute(label)}"`;
  assertAllowedSelector(labelSelector, forbiddenSelectors);
  const byLabel = page.getByLabel(label, { exact: true });
  if (await byLabel.count()) {
    await byLabel.first().fill(value);
    return labelSelector;
  }

  const placeholder = `input[placeholder="${escapeForAttribute(label)}"], textarea[placeholder="${escapeForAttribute(label)}"]`;
  assertAllowedSelector(placeholder, forbiddenSelectors);
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
  value: string,
  forbiddenSelectors: string[]
): Promise<string> {
  const labelSelector = `label="${escapeForAttribute(label)}"`;
  assertAllowedSelector(labelSelector, forbiddenSelectors);
  const byLabel = page.getByLabel(label, { exact: true });
  if (await byLabel.count()) {
    await byLabel.first().selectOption(value);
    return labelSelector;
  }

  const ariaSelector = `select[aria-label="${escapeForAttribute(label)}"]`;
  assertAllowedSelector(ariaSelector, forbiddenSelectors);
  const byAria = page.locator(ariaSelector);
  if (await byAria.count()) {
    await byAria.first().selectOption(value);
    return ariaSelector;
  }

  const placeholderSelector = `select[placeholder="${escapeForAttribute(label)}"]`;
  assertAllowedSelector(placeholderSelector, forbiddenSelectors);
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
  },
  forbiddenSelectors: string[]
): Promise<string> {
  if (assertion.visible !== undefined) {
    const selector = textSelector(assertion.visible);
    assertAllowedSelector(selector, forbiddenSelectors);
    const count = await page.locator(selector).count();
    if (count === 0) {
      throw new Error(`Expected visible text: ${assertion.visible}`);
    }
    return `visible:${assertion.visible}`;
  }

  if (assertion.notVisible !== undefined) {
    const selector = textSelector(assertion.notVisible);
    assertAllowedSelector(selector, forbiddenSelectors);
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

function stepPath(prefix: string | undefined, index: number): string {
  return prefix ? `${prefix}.${index}` : `${index}`;
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
  const currentHuntName = context.huntStack?.[context.huntStack.length - 1];
  assertWithinMaxSteps(context.steps.length, context.maxSteps, currentHuntName);

  const results: StepResult[] = [];
  const screenshots: string[] = [];
  const runStartedAtMs = context.runStartedAtMs ?? Date.now();
  context.runStartedAtMs = runStartedAtMs;

  const addScreenshot = async (fileName: string): Promise<string> => {
    const fullPath = screenshotPath(screenshotsDir, fileName);
    await captureScreenshot(context.page, fullPath);
    const relative = path.join("screenshots", fileName);
    screenshots.push(relative);
    return relative;
  };

  for (let index = 0; index < context.steps.length; index += 1) {
    const currentStepPath = stepPath(context.stepPathPrefix, index);
    if (Date.now() - runStartedAtMs > context.maxTotalTimeMs) {
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
          selector = await clickByTextWithFallback(
            context.page,
            step.click,
            context.forbiddenSelectors
          );
        } else {
          assertAllowedSelector(step.click.selector, context.forbiddenSelectors);
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
          assertAllowedSelector(step.fill.selector, context.forbiddenSelectors);
          await fillElement(context.page, step.fill.selector, step.fill.value);
          selector = step.fill.selector;
          value = step.fill.value;
        } else {
          const [label, shorthandValue] = getSinglePair(step.fill, "fill");
          selector = await fillByLabelOrPlaceholder(
            context.page,
            label,
            shorthandValue,
            context.forbiddenSelectors
          );
          value = shorthandValue;
        }
        ensureAllowedUrl(context.page.url(), context.allowedDomains);
        stepResult = {
          type: "fill",
          status: "pass",
          durationMs: Date.now() - stepStart,
          selector,
          value: context.redactedFillSteps.has(currentStepPath) ? "[REDACTED]" : value
        };
      } else if ("type" in step) {
        assertAllowedSelector(":focus", context.forbiddenSelectors);
        await fillElement(context.page, ":focus", step.type);
        ensureAllowedUrl(context.page.url(), context.allowedDomains);
        stepResult = {
          type: "type",
          status: "pass",
          durationMs: Date.now() - stepStart,
          selector: ":focus",
          value: context.redactedFillSteps.has(currentStepPath) ? "[REDACTED]" : step.type
        };
      } else if ("selectOption" in step) {
        assertAllowedSelector(step.selectOption.selector, context.forbiddenSelectors);
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
        const selector = await selectByLabelOrFallback(
          context.page,
          label,
          value,
          context.forbiddenSelectors
        );
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
        assertAllowedSelector(step.setInputFiles.selector, context.forbiddenSelectors);
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
      } else if ("runHunt" in step) {
        const huntName = typeof step.runHunt === "string" ? step.runHunt : step.runHunt.name;
        const overrideVars = typeof step.runHunt === "string" ? undefined : step.runHunt.vars;
        const stack = context.huntStack ?? [];
        if (stack.includes(huntName)) {
          throw new Error(`Circular hunt dependency: ${[...stack, huntName].join(" → ")}`);
        }
        const subHunt = loadHunt(huntName, context.configDir);
        if (overrideVars) {
          subHunt.vars = { ...subHunt.vars, ...overrideVars };
        }
        const { hunt: interpolatedSubHunt, redactedFillSteps: subRedacted } = interpolateHunt(
          subHunt,
          process.env
        );
        assertWithinMaxSteps(interpolatedSubHunt.steps.length, context.maxSteps, huntName);
        const subResult = await executeSteps({
          ...context,
          steps: interpolatedSubHunt.steps,
          redactedFillSteps: subRedacted,
          stepPathPrefix: undefined,
          huntStack: [...stack, huntName],
          onStep: context.onStep
        });
        for (const sr of subResult.results) {
          results.push({ ...sr, type: `${huntName} > ${sr.type}` });
        }
        screenshots.push(...subResult.screenshots);
        if (subResult.failed) {
          return {
            results,
            screenshots,
            failed: true,
            error: `Sub-hunt "${huntName}" failed: ${subResult.error}`
          };
        }
        stepResult = {
          type: "runHunt",
          status: "pass",
          durationMs: Date.now() - stepStart,
          value: huntName
        };
      } else if ("press" in step) {
        assertAllowedSelector(step.press.selector, context.forbiddenSelectors);
        await pressKey(context.page, step.press.selector, step.press.key);
        ensureAllowedUrl(context.page.url(), context.allowedDomains);
        stepResult = {
          type: "press",
          status: "pass",
          durationMs: Date.now() - stepStart,
          selector: step.press.selector
        };
      } else if ("assert" in step) {
        const value = await runInlineAssert(context.page, step.assert, context.forbiddenSelectors);
        stepResult = {
          type: "assert",
          status: "pass",
          durationMs: Date.now() - stepStart,
          value
        };
      } else if ("wait" in step) {
        const selector = typeof step.wait === "string" ? textSelector(step.wait) : textSelector(step.wait.for);
        const timeout = typeof step.wait === "string" ? undefined : step.wait.timeout;
        assertAllowedSelector(selector, context.forbiddenSelectors);
        await context.page.waitForSelector(selector, { timeout });
        stepResult = {
          type: "wait",
          status: "pass",
          durationMs: Date.now() - stepStart,
          selector
        };
      } else if ("waitForSelector" in step) {
        assertAllowedSelector(step.waitForSelector.selector, context.forbiddenSelectors);
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
      } else if ("hover" in step) {
        assertAllowedSelector(step.hover.selector, context.forbiddenSelectors);
        await context.page.locator(step.hover.selector).hover();
        ensureAllowedUrl(context.page.url(), context.allowedDomains);
        stepResult = {
          type: "hover",
          status: "pass",
          durationMs: Date.now() - stepStart,
          selector: step.hover.selector
        };
      } else if ("scroll" in step) {
        const amount = step.scroll.amount ?? 500;
        const scrollMap: Record<string, [number, number]> = {
          up: [0, -amount],
          down: [0, amount],
          left: [-amount, 0],
          right: [amount, 0]
        };
        const [x, y] = scrollMap[step.scroll.direction];
        await context.page.evaluate(([sx, sy]) => window.scrollBy(sx, sy), [x, y] as [number, number]);
        stepResult = {
          type: "scroll",
          status: "pass",
          durationMs: Date.now() - stepStart,
          value: `${step.scroll.direction} ${amount}px`
        };
      } else if ("scrollTo" in step) {
        assertAllowedSelector(step.scrollTo.selector, context.forbiddenSelectors);
        await context.page.locator(step.scrollTo.selector).scrollIntoViewIfNeeded();
        stepResult = {
          type: "scrollTo",
          status: "pass",
          durationMs: Date.now() - stepStart,
          selector: step.scrollTo.selector
        };
      } else if ("screenshot" in step) {
        const name = step.screenshot.name ?? `manual_step_${index + 1}.png`;
        if (/[/\\]|\.\./.test(name)) {
          throw new Error(`Invalid screenshot name: "${name}" must not contain path separators or ".."`);
        }
        const fileName = name.endsWith(".png") ? name : `${name}.png`;
        const relative = await addScreenshot(fileName);
        stepResult = {
          type: "screenshot",
          status: "pass",
          durationMs: Date.now() - stepStart,
          screenshot: relative
        };
      } else if ("if" in step) {
        const condition = step.if;
        const selector = condition.visible ?? condition.notVisible!;
        assertAllowedSelector(selector, context.forbiddenSelectors);
        const count = await context.page.locator(selector).count();
        const conditionMet = condition.visible !== undefined ? count > 0 : count === 0;

        if (conditionMet) {
          const subResult = await executeSteps({
            ...context,
            steps: condition.then,
            stepPathPrefix: `${currentStepPath}.if.then`
          });
          for (const sr of subResult.results) {
            results.push({ ...sr, type: `if > ${sr.type}` });
          }
          screenshots.push(...subResult.screenshots);
          if (subResult.failed) {
            return {
              results,
              screenshots,
              failed: true,
              error: subResult.error
            };
          }
          stepResult = {
            type: "if",
            status: "pass",
            durationMs: Date.now() - stepStart,
            value: `condition met, executed ${condition.then.length} steps`
          };
        } else {
          stepResult = {
            type: "if",
            status: "pass",
            durationMs: Date.now() - stepStart,
            value: "condition not met, skipped"
          };
        }
      } else if ("repeat" in step) {
        const repeat = step.repeat;
        let totalSubSteps = 0;

        if (repeat.times !== undefined) {
          for (let i = 0; i < repeat.times; i++) {
            totalSubSteps += repeat.steps.length;
            if (totalSubSteps > context.maxSteps) {
              throw new Error(`Repeat exceeded maxSteps guardrail (${context.maxSteps})`);
            }
            const subResult = await executeSteps({
              ...context,
              steps: repeat.steps,
              stepPathPrefix: `${currentStepPath}.repeat.steps`
            });
            for (const sr of subResult.results) {
              results.push({ ...sr, type: `repeat[${i}] > ${sr.type}` });
            }
            screenshots.push(...subResult.screenshots);
            if (subResult.failed) {
              return {
                results,
                screenshots,
                failed: true,
                error: subResult.error
              };
            }
          }
        } else if (repeat.while !== undefined) {
          const maxIter = repeat.maxIterations!;
          const whileSelector = repeat.while.visible ?? repeat.while.notVisible!;
          assertAllowedSelector(whileSelector, context.forbiddenSelectors);
          for (let i = 0; i < maxIter; i++) {
            const whileCount = await context.page.locator(whileSelector).count();
            const shouldContinue = repeat.while.visible !== undefined ? whileCount > 0 : whileCount === 0;
            if (!shouldContinue) break;

            totalSubSteps += repeat.steps.length;
            if (totalSubSteps > context.maxSteps) {
              throw new Error(`Repeat exceeded maxSteps guardrail (${context.maxSteps})`);
            }
            const subResult = await executeSteps({
              ...context,
              steps: repeat.steps,
              stepPathPrefix: `${currentStepPath}.repeat.steps`
            });
            for (const sr of subResult.results) {
              results.push({ ...sr, type: `repeat[${i}] > ${sr.type}` });
            }
            screenshots.push(...subResult.screenshots);
            if (subResult.failed) {
              return {
                results,
                screenshots,
                failed: true,
                error: subResult.error
              };
            }
          }
        }

        stepResult = {
          type: "repeat",
          status: "pass",
          durationMs: Date.now() - stepStart
        };
      } else if ("mockRoute" in step) {
        const mock = step.mockRoute;
        const mocks = context.activeMocks ?? new Map<string, () => Promise<void>>();
        context.activeMocks = mocks;

        let responseBody: string;
        if (mock.response.body !== undefined) {
          responseBody = mock.response.body;
        } else {
          const responseFile = mock.response.file;
          if (!responseFile) {
            throw new Error("mock.response must include either body or file");
          }
          const filePath = path.isAbsolute(responseFile)
            ? responseFile
            : path.join(context.configDir, responseFile);
          responseBody = await fs.promises.readFile(filePath, "utf-8");
        }

        const contentType = mock.response.contentType ?? "application/json";
        const status = mock.response.status;

        await context.page.route(mock.url, (route) => {
          route.fulfill({
            status,
            contentType,
            body: responseBody
          });
        });

        mocks.set(mock.url, async () => {
          await context.page.unroute(mock.url);
        });

        stepResult = {
          type: "mockRoute",
          status: "pass",
          durationMs: Date.now() - stepStart,
          value: mock.url
        };
      } else if ("unmockRoute" in step) {
        const url = step.unmockRoute.url;
        const mocks = context.activeMocks;
        if (!mocks || !mocks.has(url)) {
          throw new Error(`No active mock for URL: ${url}`);
        }
        const cleanup = mocks.get(url)!;
        await cleanup();
        mocks.delete(url);

        stepResult = {
          type: "unmockRoute",
          status: "pass",
          durationMs: Date.now() - stepStart,
          value: url
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
      context.onStep?.(stepResult, step, index);
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
      context.onStep?.(stepResult, step, index);
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
