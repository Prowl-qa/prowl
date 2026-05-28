import fs from "node:fs";
import path from "node:path";
import type { Download, Page } from "playwright";
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
  runtimeVars?: Map<string, string>;
  randomVars?: Record<string, string>;
  pendingDownload?: Promise<Download>;
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
  if ("evalScript" in step) return "evalScript";
  if ("runScript" in step) return "runScript";
  if ("assertScreenshot" in step) return "assertScreenshot";
  if ("copyText" in step) return "copyText";
  if ("waitForDownload" in step) return "waitForDownload";
  return "step";
}

const RUNTIME_VAR_PATTERN = /\{\{([A-Z0-9_]+)\}\}/g;

function substituteRuntimeVars(input: string, vars: Map<string, string>): string {
  return input.replace(RUNTIME_VAR_PATTERN, (match, name: string) => {
    const value = vars.get(name);
    return value !== undefined ? value : match;
  });
}

function applyRuntimeVars(step: Step, vars: Map<string, string>): Step {
  const sub = (s: string) => substituteRuntimeVars(s, vars);

  if ("navigate" in step) return { navigate: sub(step.navigate) };
  if ("click" in step) {
    if (typeof step.click === "string") return { click: sub(step.click) };
    return { click: { selector: sub(step.click.selector) } };
  }
  if ("fill" in step) {
    if ("selector" in step.fill && "value" in step.fill) {
      const f = step.fill as { selector: string; value: string };
      return { fill: { selector: sub(f.selector), value: sub(f.value) } };
    }
    const [key, value] = Object.entries(step.fill)[0];
    return { fill: { [sub(key)]: sub(value) } };
  }
  if ("type" in step) return { type: sub(step.type) };
  if ("assert" in step) {
    const a = step.assert;
    if (a.visible !== undefined) return { assert: { visible: sub(a.visible) } };
    if (a.notVisible !== undefined) return { assert: { notVisible: sub(a.notVisible) } };
    if (a.urlIncludes !== undefined) return { assert: { urlIncludes: sub(a.urlIncludes) } };
    if (a.urlEquals !== undefined) return { assert: { urlEquals: sub(a.urlEquals) } };
    return step;
  }
  if ("wait" in step) {
    if (typeof step.wait === "string") return { wait: sub(step.wait) };
    return { wait: { for: sub(step.wait.for), timeout: step.wait.timeout } };
  }
  if ("waitForSelector" in step) {
    return { waitForSelector: { selector: sub(step.waitForSelector.selector), timeout: step.waitForSelector.timeout } };
  }
  if ("evalScript" in step) {
    if (typeof step.evalScript === "string") return { evalScript: sub(step.evalScript) };
    return {
      evalScript: {
        expression: sub(step.evalScript.expression),
        ...(step.evalScript.as !== undefined ? { as: step.evalScript.as } : {})
      }
    };
  }
  if ("assertScreenshot" in step) {
    return {
      assertScreenshot: {
        name: sub(step.assertScreenshot.name),
        ...(step.assertScreenshot.threshold !== undefined ? { threshold: step.assertScreenshot.threshold } : {})
      }
    };
  }
  if ("copyText" in step) {
    return { copyText: { selector: sub(step.copyText.selector), as: step.copyText.as } };
  }
  if ("waitForDownload" in step) {
    if (step.waitForDownload === null) return step;
    return {
      waitForDownload: {
        ...(step.waitForDownload.filename !== undefined ? { filename: sub(step.waitForDownload.filename) } : {}),
        ...(step.waitForDownload.timeout !== undefined ? { timeout: step.waitForDownload.timeout } : {})
      }
    };
  }
  return step;
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

function exactTextSelector(text: string): string {
  return `text="${escapeForText(text)}"`;
}

function textContainsSelector(text: string): string {
  return `text=${escapeForText(text)}`;
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

  const selector = exactTextSelector(text);
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

// Playwright engine prefixes (e.g. `css=`, `xpath=…`, `text="…"`) that mark a
// value as an explicit selector rather than text to match.
const SELECTOR_ENGINE_PREFIX = /^(?:css|xpath|text|id|role|data-testid)=/i;
const HTML_TYPE_SELECTORS = new Set([
  "a",
  "article",
  "aside",
  "body",
  "button",
  "canvas",
  "dialog",
  "div",
  "fieldset",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "html",
  "iframe",
  "img",
  "input",
  "label",
  "li",
  "main",
  "nav",
  "ol",
  "option",
  "p",
  "section",
  "select",
  "span",
  "table",
  "tbody",
  "td",
  "textarea",
  "th",
  "thead",
  "tr",
  "ul"
]);

function isKnownCssTypeSelector(value: string): boolean {
  return value === "*" || value.includes("-") || HTML_TYPE_SELECTORS.has(value.toLowerCase());
}

function readCssTypeSelector(value: string, start: number): { end: number; isKnown: boolean } | null {
  const match = /^(?:[A-Za-z][\w-]*|\*)/.exec(value.slice(start));
  if (!match) return null;
  return { end: start + match[0].length, isKnown: isKnownCssTypeSelector(match[0]) };
}

function readCssStructuralSelectorPart(value: string, start: number): number | null {
  const rest = value.slice(start);
  const classOrId = /^[.#][A-Za-z_][\w-]*/.exec(rest);
  if (classOrId) return start + classOrId[0].length;

  const attribute = /^\[[A-Za-z_][\w:-]*(?:\s*(?:[~|^$*]?=)\s*(?:"[^"]*"|'[^']*'|[^\]\s]+))?\]/.exec(rest);
  if (attribute) return start + attribute[0].length;

  return null;
}

function readCssCompoundSelector(value: string, start: number): { end: number; hasStructuralPart: boolean } | null {
  let cursor = start;
  const type = readCssTypeSelector(value, cursor);
  if (type) {
    cursor = type.end;
  }

  let hasStructuralPart = false;
  for (;;) {
    const next = readCssStructuralSelectorPart(value, cursor);
    if (next === null) break;
    hasStructuralPart = true;
    cursor = next;
  }

  if (cursor === start) return null;
  if (type && !type.isKnown) return null;
  return { end: cursor, hasStructuralPart };
}

function readCssSelectorSeparator(value: string, start: number): number | null {
  let cursor = start;
  let sawWhitespace = false;
  while (/\s/.test(value[cursor] ?? "")) {
    sawWhitespace = true;
    cursor += 1;
  }

  if (/[>+~]/.test(value[cursor] ?? "")) {
    cursor += 1;
    while (/\s/.test(value[cursor] ?? "")) {
      cursor += 1;
    }
    return cursor;
  }

  return sawWhitespace ? cursor : null;
}

function isCssSelectorSequence(value: string): boolean {
  const first = readCssCompoundSelector(value, 0);
  if (!first) return false;

  let cursor = first.end;
  let sawSeparator = false;
  let hasStructuralPart = first.hasStructuralPart;

  while (cursor < value.length) {
    const afterSeparator = readCssSelectorSeparator(value, cursor);
    if (afterSeparator === null) return false;

    const next = readCssCompoundSelector(value, afterSeparator);
    if (!next) return false;

    sawSeparator = true;
    hasStructuralPart = hasStructuralPart || next.hasStructuralPart;
    cursor = next.end;
  }

  return sawSeparator && hasStructuralPart;
}

// A visibility value is treated as a selector only when it has a clear
// structural signature: a leading class/id/attribute token, a supported CSS
// compound/sequence, or explicit Playwright engine prefix (incl. `//` xpath).
// Everything else — including prose that merely contains punctuation such as
// "name:" or a sentence ending in "." — is matched as text, so assertions read
// the way they are written. For exotic selectors (pseudo-classes), use an
// explicit engine prefix like `css=input:checked`.
export function looksLikeSelector(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (SELECTOR_ENGINE_PREFIX.test(trimmed) || trimmed.startsWith("//")) return true;
  if (/^[.#]/.test(trimmed)) return true; // leading class or id selector
  const compound = readCssCompoundSelector(trimmed, 0);
  if (compound?.end === trimmed.length && compound.hasStructuralPart) return true;
  if (isCssSelectorSequence(trimmed)) return true;
  return false;
}

export function toVisibilitySelector(value: string): string {
  if (looksLikeSelector(value)) return value;
  return textContainsSelector(value);
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
    const selector = toVisibilitySelector(assertion.visible);
    assertAllowedSelector(selector, forbiddenSelectors);
    const count = await page.locator(selector).count();
    if (count === 0) {
      throw new Error(`Expected visible: ${assertion.visible}`);
    }
    return `visible:${assertion.visible}`;
  }

  if (assertion.notVisible !== undefined) {
    const selector = toVisibilitySelector(assertion.notVisible);
    assertAllowedSelector(selector, forbiddenSelectors);
    const count = await page.locator(selector).count();
    if (count > 0) {
      throw new Error(`Expected not visible: ${assertion.notVisible}`);
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

function isWaitForDownloadStep(step: Step | undefined): step is Extract<Step, { waitForDownload: unknown }> {
  return step !== undefined && "waitForDownload" in step;
}

function armDownloadListener(page: Page, timeout: number): Promise<Download> {
  const downloadPromise = page.waitForEvent("download", { timeout });
  void downloadPromise.catch(() => undefined);
  return downloadPromise;
}

function validateDownloadFilename(suggestedFilename: string): string {
  const safeFilename = suggestedFilename.trim();
  const allowedFilenamePattern = /^[^<>:"/\\|?*]+$/;
  const hasControlCharacter = Array.from(safeFilename).some((char) => char.charCodeAt(0) < 32);

  if (
    safeFilename.length === 0
    || safeFilename !== suggestedFilename
    || safeFilename !== path.basename(safeFilename)
    || safeFilename.includes("..")
    || /[/\\]/.test(safeFilename)
    || hasControlCharacter
    || !allowedFilenamePattern.test(safeFilename)
  ) {
    throw new Error(`Invalid download filename: "${suggestedFilename}"`);
  }

  return safeFilename;
}

async function captureScreenshot(page: Page, filePath: string): Promise<void> {
  try {
    await page.screenshot({ path: filePath, fullPage: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Screenshot failed";
    throw new Error(`Failed to capture screenshot at ${filePath}: ${message}`);
  }
}

async function executeNestedSteps(
  context: StepExecutionContext,
  overrides: Partial<StepExecutionContext> & Pick<StepExecutionContext, "steps">
): Promise<StepExecutionResult> {
  const nestedContext: StepExecutionContext = {
    ...context,
    ...overrides,
    pendingDownload: context.pendingDownload
  };
  const result = await executeSteps(nestedContext);
  context.pendingDownload = nestedContext.pendingDownload;
  if (nestedContext.randomVars !== undefined) {
    context.randomVars = nestedContext.randomVars;
  }
  return result;
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

    const runtimeVars = context.runtimeVars ?? new Map<string, string>();
    context.runtimeVars = runtimeVars;

    let step = context.steps[index];
    if (runtimeVars.size > 0) {
      step = applyRuntimeVars(step, runtimeVars);
    }
    const nextStep = context.steps[index + 1];
    if (
      !isWaitForDownloadStep(step)
      && context.pendingDownload === undefined
      && isWaitForDownloadStep(nextStep)
    ) {
      context.pendingDownload = armDownloadListener(
        context.page,
        nextStep.waitForDownload?.timeout ?? 30000
      );
    }
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
        const {
          hunt: interpolatedSubHunt,
          redactedFillSteps: subRedacted,
          randomVars
        } = interpolateHunt(
          subHunt,
          process.env,
          context.randomVars
        );
        assertWithinMaxSteps(interpolatedSubHunt.steps.length, context.maxSteps, huntName);
        const subResult = await executeNestedSteps(context, {
          steps: interpolatedSubHunt.steps,
          redactedFillSteps: subRedacted,
          randomVars,
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
        const text = typeof step.wait === "string" ? step.wait : step.wait.for;
        const timeout = typeof step.wait === "string" ? undefined : step.wait.timeout;
        const selector = `text=${escapeForText(text)}`;
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
          const subResult = await executeNestedSteps(context, {
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
          if (condition.else && condition.else.length > 0) {
            const subResult = await executeNestedSteps(context, {
              steps: condition.else,
              stepPathPrefix: `${currentStepPath}.if.else`
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
              value: `condition not met, executed ${condition.else.length} else steps`
            };
          } else {
            stepResult = {
              type: "if",
              status: "pass",
              durationMs: Date.now() - stepStart,
              value: "condition not met, skipped"
            };
          }
        }
      } else if ("repeat" in step) {
        const repeat = step.repeat;
        let totalSubSteps = 0;

        if (repeat.times !== undefined) {
          const totalPlanned = repeat.times * repeat.steps.length;
          if (totalPlanned + totalSubSteps > context.maxSteps) {
            throw new Error(`Repeat exceeded maxSteps guardrail (${context.maxSteps})`);
          }
          for (let i = 0; i < repeat.times; i++) {
            totalSubSteps += repeat.steps.length;
            const subResult = await executeNestedSteps(context, {
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
            const subResult = await executeNestedSteps(context, {
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
          const candidateFilePath = path.isAbsolute(responseFile)
            ? responseFile
            : path.join(context.configDir, responseFile);
          const resolvedConfigDir = path.resolve(context.configDir);
          const resolvedFilePath = path.resolve(candidateFilePath);
          const relativePath = path.relative(resolvedConfigDir, resolvedFilePath);
          const isWithinConfigDir =
            relativePath === ""
            || (
              relativePath !== ".."
              && !relativePath.startsWith(`..${path.sep}`)
              && !path.isAbsolute(relativePath)
            );
          if (!isWithinConfigDir) {
            throw new Error("mock.response.file must resolve within config directory");
          }
          responseBody = await fs.promises.readFile(resolvedFilePath, "utf-8");
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
        const url = typeof step.unmockRoute === "string" ? step.unmockRoute : step.unmockRoute.url;
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
      } else if ("evalScript" in step) {
        const expression = typeof step.evalScript === "string"
          ? step.evalScript
          : step.evalScript.expression;
        const result = await context.page.evaluate(expression);
        const resultStr = String(result);
        if (typeof step.evalScript !== "string" && step.evalScript.as) {
          runtimeVars.set(step.evalScript.as, resultStr);
        }
        stepResult = {
          type: "evalScript",
          status: "pass",
          durationMs: Date.now() - stepStart,
          value: resultStr.length > 200 ? resultStr.slice(0, 200) + "\u2026" : resultStr
        };
      } else if ("runScript" in step) {
        const filePath = path.isAbsolute(step.runScript.file)
          ? step.runScript.file
          : path.join(context.configDir, step.runScript.file);
        const fileContents = fs.readFileSync(filePath, "utf-8");
        await context.page.evaluate(fileContents);
        stepResult = {
          type: "runScript",
          status: "pass",
          durationMs: Date.now() - stepStart,
          value: step.runScript.file
        };
      } else if ("assertScreenshot" in step) {
        const { compareScreenshots, ensureBaselineDir } = await import("./visual.js");
        const name = step.assertScreenshot.name;
        const threshold = step.assertScreenshot.threshold ?? 0.1;
        const baselineDir = ensureBaselineDir(context.configDir);
        const baselinePath = path.join(baselineDir, `${name}.png`);
        const currentScreenshotPath = path.join(context.runDir, "screenshots", `${name}-current.png`);
        fs.mkdirSync(path.dirname(currentScreenshotPath), { recursive: true });
        await context.page.screenshot({ path: currentScreenshotPath, fullPage: true });
        screenshots.push(path.join("screenshots", `${name}-current.png`));

        if (!fs.existsSync(baselinePath)) {
          fs.copyFileSync(currentScreenshotPath, baselinePath);
          stepResult = {
            type: "assertScreenshot",
            status: "pass",
            durationMs: Date.now() - stepStart,
            value: "baseline created"
          };
        } else {
          const diffPath = path.join(context.runDir, "screenshots", `${name}-diff.png`);
          const comparison = await compareScreenshots(baselinePath, currentScreenshotPath, diffPath, threshold);
          if (comparison.match) {
            stepResult = {
              type: "assertScreenshot",
              status: "pass",
              durationMs: Date.now() - stepStart,
              value: `diff: ${(comparison.diffPercentage * 100).toFixed(2)}%`
            };
          } else {
            screenshots.push(path.join("screenshots", `${name}-diff.png`));
            throw new Error(
              `Visual regression: ${(comparison.diffPercentage * 100).toFixed(2)}% diff exceeds threshold ${(threshold * 100).toFixed(0)}%`
            );
          }
        }
      } else if ("copyText" in step) {
        assertAllowedSelector(step.copyText.selector, context.forbiddenSelectors);
        const text = await context.page.locator(step.copyText.selector).textContent();
        if (text === null) {
          throw new Error(`No text content found for selector: ${step.copyText.selector}`);
        }
        runtimeVars.set(step.copyText.as, text);
        stepResult = {
          type: "copyText",
          status: "pass",
          durationMs: Date.now() - stepStart,
          selector: step.copyText.selector,
          value: "[REDACTED]"
        };
      } else if ("waitForDownload" in step) {
        const opts = step.waitForDownload;
        const downloadPromise = context.pendingDownload ?? armDownloadListener(
          context.page,
          opts?.timeout ?? 30000
        );
        context.pendingDownload = undefined;
        const download = await downloadPromise;
        const suggestedFilename = validateDownloadFilename(download.suggestedFilename());
        if (opts?.filename !== undefined && suggestedFilename !== opts.filename) {
          throw new Error(
            `Download filename mismatch: expected "${opts.filename}", got "${suggestedFilename}"`
          );
        }
        const savePath = path.join(context.runDir, suggestedFilename);
        await download.saveAs(savePath);
        stepResult = {
          type: "waitForDownload",
          status: "pass",
          durationMs: Date.now() - stepStart,
          value: suggestedFilename
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
