import fs from "node:fs";
import path from "node:path";
// Type-only: the runner hands executeSteps a live Playwright page as the
// driver entrypoint. All *runtime* Playwright use lives in the driver
// (src/browser/playwright-driver.ts); this import is erased at build.
import type { Page } from "playwright";
import { createPlaywrightDriver } from "../browser/controller.js";
import type { DriverCapability, DriverDownload, SessionDriver } from "../browser/driver.js";
import type { Step, StepResult, Target } from "../types/index.js";
import { loadHunt } from "../config/loader.js";
import { interpolateHunt } from "../config/interpolate.js";
import { assertHuntAssertionsSupportedByTarget, assertStepsSupportedByTarget } from "../config/target.js";
import { createRunPolicy, type RunPolicy } from "./policy.js";
import {
  assertWithAiVision,
  tryResolveAiConfig,
  type AiConfig,
  type AiVisionInput,
  type AiVisionVerdict
} from "../generator/ai.js";

export type StepCallback = (result: StepResult, step: Step, index: number) => void;

export type StepExecutionContext = {
  /** Playwright page entrypoint for the web target; omitted for non-web drivers. */
  page?: Page;
  /** Pre-built driver; required when `page` is omitted (e.g. the macOS/Android target). */
  driver?: SessionDriver;
  /**
   * The execution target type, used to gate web-only steps inside sub-hunts.
   * Optional for back-compat: when omitted it is inferred from the driver's
   * capabilities (navigate ⇒ web, otherwise macOS).
   */
  targetType?: Target["type"];
  steps: Step[];
  targetUrl: string;
  runDir: string;
  screenshotsMode: "on-failure" | "all";
  forbiddenSelectors: string[];
  allowedDomains: string[];
  /** Allow-listed bundle IDs / process names for the macOS target (optional). */
  allowedApps?: string[];
  maxSteps: number;
  selfHealing?: boolean;
  maxTotalTimeMs: number;
  redactedFillSteps: Set<string>;
  configDir: string;
  onStep?: StepCallback;
  huntStack?: string[];
  activeMocks?: Map<string, () => Promise<void>>;
  runtimeVars?: Map<string, string>;
  randomVars?: Record<string, string>;
  pendingDownload?: Promise<DriverDownload>;
  runStartedAtMs?: number;
  stepPathPrefix?: string;
  /**
   * Test seam: resolve the AI config for `assertWithAI` (returns `null` when no
   * provider/key is configured, which makes the step skip with a warning).
   * Defaults to env-based {@link tryResolveAiConfig}.
   */
  resolveAiConfig?: () => AiConfig | null;
  /**
   * Test seam: perform the vision assertion. Defaults to the real fetch-based
   * {@link assertWithAiVision}. Injected in tests so the runner never hits the
   * network.
   */
  assertVision?: (input: AiVisionInput, config: AiConfig) => Promise<AiVisionVerdict>;
};

export type StepExecutionResult = {
  results: StepResult[];
  screenshots: string[];
  failed: boolean;
  error?: string;
};

/** Anything that can take a full-page screenshot (a driver or a Playwright page). */
type ScreenshotTaker = {
  screenshot(options: { path: string; fullPage?: boolean }): Promise<unknown>;
};

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
  if ("assertWithAI" in step) return "assertWithAI";
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
  if ("assertWithAI" in step) {
    return { assertWithAI: sub(step.assertWithAI) };
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
  driver: SessionDriver,
  policy: RunPolicy,
  text: string
): Promise<string> {
  const roleSelector = `role=button[name="${escapeForAttribute(text)}"]`;
  policy.assertAllowedSelector(roleSelector);
  if (await driver.countByRole("button", text)) {
    await driver.clickFirstByRole("button", text);
    return roleSelector;
  }

  const selector = exactTextSelector(text);
  policy.assertAllowedSelector(selector);
  await driver.clickFirst(selector);
  return selector;
}

async function fillByLabelOrPlaceholder(
  driver: SessionDriver,
  policy: RunPolicy,
  label: string,
  value: string
): Promise<string> {
  const labelSelector = `label="${escapeForAttribute(label)}"`;
  policy.assertAllowedSelector(labelSelector);
  if (await driver.countByLabel(label)) {
    await driver.fillFirstByLabel(label, value);
    return labelSelector;
  }

  const placeholder = `input[placeholder="${escapeForAttribute(label)}"], textarea[placeholder="${escapeForAttribute(label)}"]`;
  policy.assertAllowedSelector(placeholder);
  if (await driver.count(placeholder)) {
    await driver.fillFirst(placeholder, value);
    return placeholder;
  }

  throw new Error(`Could not resolve fill shorthand for "${label}"`);
}

async function selectByLabelOrFallback(
  driver: SessionDriver,
  policy: RunPolicy,
  label: string,
  value: string
): Promise<string> {
  const labelSelector = `label="${escapeForAttribute(label)}"`;
  policy.assertAllowedSelector(labelSelector);
  if (await driver.countByLabel(label)) {
    await driver.selectOptionFirstByLabel(label, value);
    return labelSelector;
  }

  const ariaSelector = `select[aria-label="${escapeForAttribute(label)}"]`;
  policy.assertAllowedSelector(ariaSelector);
  if (await driver.count(ariaSelector)) {
    await driver.selectOptionFirst(ariaSelector, value);
    return ariaSelector;
  }

  const placeholderSelector = `select[placeholder="${escapeForAttribute(label)}"]`;
  policy.assertAllowedSelector(placeholderSelector);
  if (await driver.count(placeholderSelector)) {
    await driver.selectOptionFirst(placeholderSelector, value);
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
  driver: SessionDriver,
  policy: RunPolicy,
  assertion: {
    visible?: string;
    notVisible?: string;
    urlIncludes?: string;
    urlEquals?: string;
  }
): Promise<string> {
  if (assertion.visible !== undefined) {
    const selector = toVisibilitySelector(assertion.visible);
    policy.assertAllowedSelector(selector);
    const count = await driver.count(selector);
    if (count === 0) {
      throw new Error(`Expected visible: ${assertion.visible}`);
    }
    return `visible:${assertion.visible}`;
  }

  if (assertion.notVisible !== undefined) {
    const selector = toVisibilitySelector(assertion.notVisible);
    policy.assertAllowedSelector(selector);
    const count = await driver.count(selector);
    if (count > 0) {
      throw new Error(`Expected not visible: ${assertion.notVisible}`);
    }
    return `notVisible:${assertion.notVisible}`;
  }

  if (assertion.urlIncludes !== undefined) {
    const current = driver.currentUrl();
    if (!current.includes(assertion.urlIncludes)) {
      throw new Error(`URL did not include ${assertion.urlIncludes}`);
    }
    return `urlIncludes:${assertion.urlIncludes}`;
  }

  if (assertion.urlEquals !== undefined) {
    const current = driver.currentUrl();
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

function armDownloadListener(driver: SessionDriver, timeout: number): Promise<DriverDownload> {
  const downloadPromise = driver.waitForDownloadEvent({ timeout });
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

async function captureScreenshot(taker: ScreenshotTaker, filePath: string): Promise<void> {
  try {
    await taker.screenshot({ path: filePath, fullPage: true });
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

/**
 * A step handler's outcome. `result` is a single completed step (which goes
 * through the common tail — "all"-mode screenshot + onStep callback). `abort`
 * signals that a nested execution failed and the whole run must stop; the
 * handler has already pushed its nested results/screenshots.
 */
type HandlerOutcome =
  | { kind: "result"; result: StepResult }
  | { kind: "abort"; error?: string };

/** Everything a step handler needs from the executing loop. */
type StepHandlerContext = {
  driver: SessionDriver;
  policy: RunPolicy;
  context: StepExecutionContext;
  step: Step;
  index: number;
  stepPath: string;
  stepStart: number;
  runtimeVars: Map<string, string>;
  results: StepResult[];
  screenshots: string[];
  addScreenshot: (fileName: string) => Promise<string>;
  executeNested: (
    overrides: Partial<StepExecutionContext> & Pick<StepExecutionContext, "steps">
  ) => Promise<StepExecutionResult>;
};

type StepHandler = {
  /** Driver capabilities this handler requires; checked before dispatch. */
  capabilities: DriverCapability[];
  run: (h: StepHandlerContext) => Promise<HandlerOutcome>;
};

function unknownStep(): never {
  throw new Error("Unknown step type");
}

const STEP_HANDLERS: Record<string, StepHandler> = {
  navigate: {
    capabilities: ["navigate"],
    run: async (h) => {
      if (!("navigate" in h.step)) unknownStep();
      const destination = resolveNavigationTarget(h.context.targetUrl, h.step.navigate);
      h.policy.ensureUrlAllowed(destination);
      await h.driver.goto(destination);
      h.policy.ensureLocationAllowed(h.driver);
      return { kind: "result", result: { type: "navigate", status: "pass", durationMs: Date.now() - h.stepStart } };
    }
  },

  click: {
    capabilities: ["interact", "query"],
    run: async (h) => {
      if (!("click" in h.step)) unknownStep();
      let selector: string;
      let healedFrom: string | undefined;
      if (typeof h.step.click === "string") {
        selector = await clickByTextWithFallback(h.driver, h.policy, h.step.click);
      } else {
        const resolved = await h.policy.resolveActionSelector(h.step.click.selector);
        await h.driver.click(resolved.selector);
        selector = resolved.selector;
        healedFrom = resolved.healedFrom;
      }
      h.policy.ensureLocationAllowed(h.driver);
      return {
        kind: "result",
        result: {
          type: "click",
          status: "pass",
          durationMs: Date.now() - h.stepStart,
          selector,
          ...(healedFrom ? { healedFrom } : {})
        }
      };
    }
  },

  fill: {
    capabilities: ["interact", "query"],
    run: async (h) => {
      if (!("fill" in h.step)) unknownStep();
      let selector: string;
      let value: string;
      let healedFrom: string | undefined;
      if (isExplicitFillStep(h.step.fill)) {
        const resolved = await h.policy.resolveActionSelector(h.step.fill.selector);
        await h.driver.fill(resolved.selector, h.step.fill.value);
        selector = resolved.selector;
        healedFrom = resolved.healedFrom;
        value = h.step.fill.value;
      } else {
        const [label, shorthandValue] = getSinglePair(h.step.fill, "fill");
        selector = await fillByLabelOrPlaceholder(h.driver, h.policy, label, shorthandValue);
        value = shorthandValue;
      }
      h.policy.ensureLocationAllowed(h.driver);
      return {
        kind: "result",
        result: {
          type: "fill",
          status: "pass",
          durationMs: Date.now() - h.stepStart,
          selector,
          value: h.context.redactedFillSteps.has(h.stepPath) ? "[REDACTED]" : value,
          ...(healedFrom ? { healedFrom } : {})
        }
      };
    }
  },

  type: {
    capabilities: ["interact"],
    run: async (h) => {
      if (!("type" in h.step)) unknownStep();
      h.policy.assertAllowedSelector(":focus");
      await h.driver.fill(":focus", h.step.type);
      h.policy.ensureLocationAllowed(h.driver);
      return {
        kind: "result",
        result: {
          type: "type",
          status: "pass",
          durationMs: Date.now() - h.stepStart,
          selector: ":focus",
          value: h.context.redactedFillSteps.has(h.stepPath) ? "[REDACTED]" : h.step.type
        }
      };
    }
  },

  selectOption: {
    capabilities: ["navigate", "interact", "query"],
    run: async (h) => {
      if (!("selectOption" in h.step)) unknownStep();
      const resolved = await h.policy.resolveActionSelector(h.step.selectOption.selector);
      await h.driver.selectOption(resolved.selector, h.step.selectOption.value);
      h.policy.ensureLocationAllowed(h.driver);
      return {
        kind: "result",
        result: {
          type: "selectOption",
          status: "pass",
          durationMs: Date.now() - h.stepStart,
          selector: resolved.selector,
          value: h.step.selectOption.value,
          ...(resolved.healedFrom ? { healedFrom: resolved.healedFrom } : {})
        }
      };
    }
  },

  select: {
    capabilities: ["navigate", "interact", "query"],
    run: async (h) => {
      if (!("select" in h.step)) unknownStep();
      const [label, value] = getSinglePair(h.step.select, "select");
      const selector = await selectByLabelOrFallback(h.driver, h.policy, label, value);
      h.policy.ensureLocationAllowed(h.driver);
      return {
        kind: "result",
        result: {
          type: "select",
          status: "pass",
          durationMs: Date.now() - h.stepStart,
          selector,
          value
        }
      };
    }
  },

  onDialog: {
    capabilities: ["dialog"],
    run: async (h) => {
      if (!("onDialog" in h.step)) unknownStep();
      h.driver.onDialog(h.step.onDialog.action);
      return {
        kind: "result",
        result: {
          type: "onDialog",
          status: "pass",
          durationMs: Date.now() - h.stepStart,
          value: h.step.onDialog.action
        }
      };
    }
  },

  setInputFiles: {
    capabilities: ["navigate", "interact", "query", "files"],
    run: async (h) => {
      if (!("setInputFiles" in h.step)) unknownStep();
      const resolvedInput = await h.policy.resolveActionSelector(h.step.setInputFiles.selector);
      const rawFiles = h.step.setInputFiles.files;
      const resolveFile = (f: string) => (path.isAbsolute(f) ? f : path.join(h.context.configDir, f));
      const resolvedFiles = Array.isArray(rawFiles) ? rawFiles.map(resolveFile) : resolveFile(rawFiles);
      await h.driver.setInputFiles(resolvedInput.selector, resolvedFiles);
      h.policy.ensureLocationAllowed(h.driver);
      const filesLabel = Array.isArray(rawFiles) ? rawFiles.join(", ") : rawFiles;
      return {
        kind: "result",
        result: {
          type: "setInputFiles",
          status: "pass",
          durationMs: Date.now() - h.stepStart,
          selector: resolvedInput.selector,
          ...(resolvedInput.healedFrom ? { healedFrom: resolvedInput.healedFrom } : {}),
          value: filesLabel
        }
      };
    }
  },

  runHunt: {
    capabilities: [],
    run: async (h) => {
      if (!("runHunt" in h.step)) unknownStep();
      const huntName = typeof h.step.runHunt === "string" ? h.step.runHunt : h.step.runHunt.name;
      const overrideVars = typeof h.step.runHunt === "string" ? undefined : h.step.runHunt.vars;
      const stack = h.context.huntStack ?? [];
      if (stack.includes(huntName)) {
        throw new Error(`Circular hunt dependency: ${[...stack, huntName].join(" → ")}`);
      }
      const subHunt = loadHunt(huntName, h.context.configDir);
      if (overrideVars) {
        subHunt.vars = { ...subHunt.vars, ...overrideVars };
      }
      const {
        hunt: interpolatedSubHunt,
        redactedFillSteps: subRedacted,
        randomVars
      } = interpolateHunt(subHunt, process.env, h.context.randomVars);
      // Sub-hunts bypass the top-level target check, so re-run it here against
      // the sub-hunt's own steps. The target type comes from the run context
      // (set by the native run paths); when absent it is derived from the
      // driver: a driver without the `navigate` capability is a native target,
      // where web-only steps — including `assert: urlIncludes`/`urlEquals`
      // against a native `currentUrl()` — must be rejected, not silently run.
      const subTargetType =
        h.context.targetType ?? (h.driver.capabilities.has("navigate") ? "web" : "macos");
      assertStepsSupportedByTarget(interpolatedSubHunt.steps, subTargetType);
      assertHuntAssertionsSupportedByTarget(interpolatedSubHunt.assertions, subTargetType);
      h.policy.assertWithinMaxSteps(interpolatedSubHunt.steps.length, huntName);
      const subResult = await h.executeNested({
        steps: interpolatedSubHunt.steps,
        redactedFillSteps: subRedacted,
        randomVars,
        stepPathPrefix: undefined,
        huntStack: [...stack, huntName],
        onStep: h.context.onStep
      });
      for (const sr of subResult.results) {
        h.results.push({ ...sr, type: `${huntName} > ${sr.type}` });
      }
      h.screenshots.push(...subResult.screenshots);
      if (subResult.failed) {
        return { kind: "abort", error: `Sub-hunt "${huntName}" failed: ${subResult.error}` };
      }
      return {
        kind: "result",
        result: { type: "runHunt", status: "pass", durationMs: Date.now() - h.stepStart, value: huntName }
      };
    }
  },

  press: {
    capabilities: ["interact", "query"],
    run: async (h) => {
      if (!("press" in h.step)) unknownStep();
      const resolved = await h.policy.resolveActionSelector(h.step.press.selector);
      await h.driver.press(resolved.selector, h.step.press.key);
      h.policy.ensureLocationAllowed(h.driver);
      return {
        kind: "result",
        result: {
          type: "press",
          status: "pass",
          durationMs: Date.now() - h.stepStart,
          selector: resolved.selector,
          ...(resolved.healedFrom ? { healedFrom: resolved.healedFrom } : {})
        }
      };
    }
  },

  assert: {
    capabilities: ["query"],
    run: async (h) => {
      if (!("assert" in h.step)) unknownStep();
      const value = await runInlineAssert(h.driver, h.policy, h.step.assert);
      return {
        kind: "result",
        result: { type: "assert", status: "pass", durationMs: Date.now() - h.stepStart, value }
      };
    }
  },

  wait: {
    capabilities: ["wait"],
    run: async (h) => {
      if (!("wait" in h.step)) unknownStep();
      const text = typeof h.step.wait === "string" ? h.step.wait : h.step.wait.for;
      const timeout = typeof h.step.wait === "string" ? undefined : h.step.wait.timeout;
      const selector = `text=${escapeForText(text)}`;
      h.policy.assertAllowedSelector(selector);
      await h.driver.waitForSelector(selector, { timeout });
      return {
        kind: "result",
        result: { type: "wait", status: "pass", durationMs: Date.now() - h.stepStart, selector }
      };
    }
  },

  waitForSelector: {
    capabilities: ["wait"],
    run: async (h) => {
      if (!("waitForSelector" in h.step)) unknownStep();
      h.policy.assertAllowedSelector(h.step.waitForSelector.selector);
      await h.driver.waitForSelector(h.step.waitForSelector.selector, {
        timeout: h.step.waitForSelector.timeout
      });
      return {
        kind: "result",
        result: {
          type: "waitForSelector",
          status: "pass",
          durationMs: Date.now() - h.stepStart,
          selector: h.step.waitForSelector.selector
        }
      };
    }
  },

  waitForUrl: {
    capabilities: ["navigate", "wait"],
    run: async (h) => {
      if (!("waitForUrl" in h.step)) unknownStep();
      const value = h.step.waitForUrl.value;
      await h.driver.waitForUrl((url) => url.includes(value), { timeout: h.step.waitForUrl.timeout });
      h.policy.ensureLocationAllowed(h.driver);
      return {
        kind: "result",
        result: { type: "waitForUrl", status: "pass", durationMs: Date.now() - h.stepStart, value }
      };
    }
  },

  waitForNetworkIdle: {
    capabilities: ["wait"],
    run: async (h) => {
      if (!("waitForNetworkIdle" in h.step)) unknownStep();
      await h.driver.waitForNetworkIdle({ timeout: h.step.waitForNetworkIdle.timeout });
      return {
        kind: "result",
        result: { type: "waitForNetworkIdle", status: "pass", durationMs: Date.now() - h.stepStart }
      };
    }
  },

  hover: {
    capabilities: ["interact", "query"],
    run: async (h) => {
      if (!("hover" in h.step)) unknownStep();
      const resolved = await h.policy.resolveActionSelector(h.step.hover.selector);
      await h.driver.hover(resolved.selector);
      h.policy.ensureLocationAllowed(h.driver);
      return {
        kind: "result",
        result: {
          type: "hover",
          status: "pass",
          durationMs: Date.now() - h.stepStart,
          selector: resolved.selector,
          ...(resolved.healedFrom ? { healedFrom: resolved.healedFrom } : {})
        }
      };
    }
  },

  scroll: {
    // Dispatched through the driver's `scroll` verb (interact), so native mobile
    // targets synthesize a touch swipe while web keeps its `window.scrollBy`
    // behavior. The per-target step gate rejects `scroll` on macOS before here.
    capabilities: ["interact"],
    run: async (h) => {
      if (!("scroll" in h.step)) unknownStep();
      const { direction, amount } = h.step.scroll;
      await h.driver.scroll(direction, amount);
      return {
        kind: "result",
        result: {
          type: "scroll",
          status: "pass",
          durationMs: Date.now() - h.stepStart,
          value: amount === undefined ? direction : `${direction} ${amount}px`
        }
      };
    }
  },

  scrollTo: {
    capabilities: ["interact", "query"],
    run: async (h) => {
      if (!("scrollTo" in h.step)) unknownStep();
      const resolved = await h.policy.resolveActionSelector(h.step.scrollTo.selector);
      await h.driver.scrollIntoView(resolved.selector);
      return {
        kind: "result",
        result: {
          type: "scrollTo",
          status: "pass",
          durationMs: Date.now() - h.stepStart,
          selector: resolved.selector,
          ...(resolved.healedFrom ? { healedFrom: resolved.healedFrom } : {})
        }
      };
    }
  },

  screenshot: {
    capabilities: ["screenshot"],
    run: async (h) => {
      if (!("screenshot" in h.step)) unknownStep();
      const name = h.step.screenshot.name ?? `manual_step_${h.index + 1}.png`;
      if (/[/\\]|\.\./.test(name)) {
        throw new Error(`Invalid screenshot name: "${name}" must not contain path separators or ".."`);
      }
      const fileName = name.endsWith(".png") ? name : `${name}.png`;
      const relative = await h.addScreenshot(fileName);
      return {
        kind: "result",
        result: { type: "screenshot", status: "pass", durationMs: Date.now() - h.stepStart, screenshot: relative }
      };
    }
  },

  if: {
    capabilities: ["query"],
    run: async (h) => {
      if (!("if" in h.step)) unknownStep();
      const condition = h.step.if;
      const selector = condition.visible ?? condition.notVisible!;
      h.policy.assertAllowedSelector(selector);
      const count = await h.driver.count(selector);
      const conditionMet = condition.visible !== undefined ? count > 0 : count === 0;

      if (conditionMet) {
        const subResult = await h.executeNested({
          steps: condition.then,
          stepPathPrefix: `${h.stepPath}.if.then`
        });
        for (const sr of subResult.results) {
          h.results.push({ ...sr, type: `if > ${sr.type}` });
        }
        h.screenshots.push(...subResult.screenshots);
        if (subResult.failed) {
          return { kind: "abort", error: subResult.error };
        }
        return {
          kind: "result",
          result: {
            type: "if",
            status: "pass",
            durationMs: Date.now() - h.stepStart,
            value: `condition met, executed ${condition.then.length} steps`
          }
        };
      }

      if (condition.else && condition.else.length > 0) {
        const subResult = await h.executeNested({
          steps: condition.else,
          stepPathPrefix: `${h.stepPath}.if.else`
        });
        for (const sr of subResult.results) {
          h.results.push({ ...sr, type: `if > ${sr.type}` });
        }
        h.screenshots.push(...subResult.screenshots);
        if (subResult.failed) {
          return { kind: "abort", error: subResult.error };
        }
        return {
          kind: "result",
          result: {
            type: "if",
            status: "pass",
            durationMs: Date.now() - h.stepStart,
            value: `condition not met, executed ${condition.else.length} else steps`
          }
        };
      }

      return {
        kind: "result",
        result: {
          type: "if",
          status: "pass",
          durationMs: Date.now() - h.stepStart,
          value: "condition not met, skipped"
        }
      };
    }
  },

  repeat: {
    capabilities: ["query"],
    run: async (h) => {
      if (!("repeat" in h.step)) unknownStep();
      const repeat = h.step.repeat;
      let totalSubSteps = 0;

      if (repeat.times !== undefined) {
        const totalPlanned = repeat.times * repeat.steps.length;
        if (totalPlanned + totalSubSteps > h.context.maxSteps) {
          throw new Error(`Repeat exceeded maxSteps guardrail (${h.context.maxSteps})`);
        }
        for (let i = 0; i < repeat.times; i++) {
          totalSubSteps += repeat.steps.length;
          const subResult = await h.executeNested({
            steps: repeat.steps,
            stepPathPrefix: `${h.stepPath}.repeat.steps`
          });
          for (const sr of subResult.results) {
            h.results.push({ ...sr, type: `repeat[${i}] > ${sr.type}` });
          }
          h.screenshots.push(...subResult.screenshots);
          if (subResult.failed) {
            return { kind: "abort", error: subResult.error };
          }
        }
      } else if (repeat.while !== undefined) {
        const maxIter = repeat.maxIterations!;
        const whileSelector = repeat.while.visible ?? repeat.while.notVisible!;
        h.policy.assertAllowedSelector(whileSelector);
        for (let i = 0; i < maxIter; i++) {
          const whileCount = await h.driver.count(whileSelector);
          const shouldContinue = repeat.while.visible !== undefined ? whileCount > 0 : whileCount === 0;
          if (!shouldContinue) break;

          totalSubSteps += repeat.steps.length;
          if (totalSubSteps > h.context.maxSteps) {
            throw new Error(`Repeat exceeded maxSteps guardrail (${h.context.maxSteps})`);
          }
          const subResult = await h.executeNested({
            steps: repeat.steps,
            stepPathPrefix: `${h.stepPath}.repeat.steps`
          });
          for (const sr of subResult.results) {
            h.results.push({ ...sr, type: `repeat[${i}] > ${sr.type}` });
          }
          h.screenshots.push(...subResult.screenshots);
          if (subResult.failed) {
            return { kind: "abort", error: subResult.error };
          }
        }
      }

      return {
        kind: "result",
        result: { type: "repeat", status: "pass", durationMs: Date.now() - h.stepStart }
      };
    }
  },

  mockRoute: {
    capabilities: ["route"],
    run: async (h) => {
      if (!("mockRoute" in h.step)) unknownStep();
      const mock = h.step.mockRoute;
      const mocks = h.context.activeMocks ?? new Map<string, () => Promise<void>>();
      h.context.activeMocks = mocks;

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
          : path.join(h.context.configDir, responseFile);
        const resolvedConfigDir = path.resolve(h.context.configDir);
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

      await h.driver.route(mock.url, async (route) => {
        await route.fulfill({
          status,
          contentType,
          body: responseBody
        });
      });

      mocks.set(mock.url, async () => {
        await h.driver.unroute(mock.url);
      });

      return {
        kind: "result",
        result: { type: "mockRoute", status: "pass", durationMs: Date.now() - h.stepStart, value: mock.url }
      };
    }
  },

  unmockRoute: {
    capabilities: ["route"],
    run: async (h) => {
      if (!("unmockRoute" in h.step)) unknownStep();
      const url = typeof h.step.unmockRoute === "string" ? h.step.unmockRoute : h.step.unmockRoute.url;
      const mocks = h.context.activeMocks;
      if (!mocks || !mocks.has(url)) {
        throw new Error(`No active mock for URL: ${url}`);
      }
      const cleanup = mocks.get(url)!;
      await cleanup();
      mocks.delete(url);

      return {
        kind: "result",
        result: { type: "unmockRoute", status: "pass", durationMs: Date.now() - h.stepStart, value: url }
      };
    }
  },

  evalScript: {
    capabilities: ["evaluate"],
    run: async (h) => {
      if (!("evalScript" in h.step)) unknownStep();
      const expression = typeof h.step.evalScript === "string" ? h.step.evalScript : h.step.evalScript.expression;
      const result = await h.driver.evaluate(expression);
      const resultStr = String(result);
      if (typeof h.step.evalScript !== "string" && h.step.evalScript.as) {
        h.runtimeVars.set(h.step.evalScript.as, resultStr);
      }
      return {
        kind: "result",
        result: {
          type: "evalScript",
          status: "pass",
          durationMs: Date.now() - h.stepStart,
          value: resultStr.length > 200 ? resultStr.slice(0, 200) + "…" : resultStr
        }
      };
    }
  },

  runScript: {
    capabilities: ["evaluate"],
    run: async (h) => {
      if (!("runScript" in h.step)) unknownStep();
      const filePath = path.isAbsolute(h.step.runScript.file)
        ? h.step.runScript.file
        : path.join(h.context.configDir, h.step.runScript.file);
      const fileContents = fs.readFileSync(filePath, "utf-8");
      await h.driver.evaluate(fileContents);
      return {
        kind: "result",
        result: {
          type: "runScript",
          status: "pass",
          durationMs: Date.now() - h.stepStart,
          value: h.step.runScript.file
        }
      };
    }
  },

  assertScreenshot: {
    capabilities: ["screenshot"],
    run: async (h) => {
      if (!("assertScreenshot" in h.step)) unknownStep();
      const { compareScreenshots, ensureBaselineDir } = await import("./visual.js");
      const name = h.step.assertScreenshot.name;
      const threshold = h.step.assertScreenshot.threshold ?? 0.1;
      const baselineDir = ensureBaselineDir(h.context.configDir);
      const baselinePath = path.join(baselineDir, `${name}.png`);
      const currentScreenshotPath = path.join(h.context.runDir, "screenshots", `${name}-current.png`);
      fs.mkdirSync(path.dirname(currentScreenshotPath), { recursive: true });
      await h.driver.screenshot({ path: currentScreenshotPath, fullPage: true });
      h.screenshots.push(path.join("screenshots", `${name}-current.png`));

      if (!fs.existsSync(baselinePath)) {
        fs.copyFileSync(currentScreenshotPath, baselinePath);
        return {
          kind: "result",
          result: { type: "assertScreenshot", status: "pass", durationMs: Date.now() - h.stepStart, value: "baseline created" }
        };
      }

      const diffPath = path.join(h.context.runDir, "screenshots", `${name}-diff.png`);
      const comparison = await compareScreenshots(baselinePath, currentScreenshotPath, diffPath, threshold);
      if (comparison.match) {
        return {
          kind: "result",
          result: {
            type: "assertScreenshot",
            status: "pass",
            durationMs: Date.now() - h.stepStart,
            value: `diff: ${(comparison.diffPercentage * 100).toFixed(2)}%`
          }
        };
      }
      h.screenshots.push(path.join("screenshots", `${name}-diff.png`));
      throw new Error(
        `Visual regression: ${(comparison.diffPercentage * 100).toFixed(2)}% diff exceeds threshold ${(threshold * 100).toFixed(0)}%`
      );
    }
  },

  assertWithAI: {
    capabilities: ["screenshot"],
    run: async (h) => {
      if (!("assertWithAI" in h.step)) unknownStep();
      const assertion = h.step.assertWithAI;

      // Resolve BYOK config. A future managed-credit path (BIZ-002) can slot in
      // behind this same seam without touching the handler.
      const resolve = h.context.resolveAiConfig ?? tryResolveAiConfig;
      const aiConfig = resolve();
      if (!aiConfig) {
        // Graceful degradation: no AI provider configured. Skip with a warning
        // — never a hard failure, never a silent pass.
        return {
          kind: "result",
          result: {
            type: "assertWithAI",
            status: "warn",
            durationMs: Date.now() - h.stepStart,
            value: `skipped: no AI provider configured (set PROWL_AI_KEY to enable) — "${assertion}"`
          }
        };
      }

      const fileName = `assertWithAI_step_${h.index + 1}.png`;
      const relative = await h.addScreenshot(fileName);
      const screenshotFullPath = path.join(h.context.runDir, relative);

      const imageBase64 = fs.readFileSync(screenshotFullPath).toString("base64");
      const assertVision = h.context.assertVision ?? assertWithAiVision;
      const verdict = await assertVision(
        { imageBase64, mediaType: "image/png", assertion },
        aiConfig
      );

      if (verdict.pass) {
        return {
          kind: "result",
          result: {
            type: "assertWithAI",
            status: "pass",
            durationMs: Date.now() - h.stepStart,
            value: verdict.reason,
            screenshot: relative
          }
        };
      }
      // Fail with the model's explanation as the developer-facing message.
      throw new Error(`AI assertion failed: ${verdict.reason}`);
    }
  },

  copyText: {
    capabilities: ["query"],
    run: async (h) => {
      if (!("copyText" in h.step)) unknownStep();
      h.policy.assertAllowedSelector(h.step.copyText.selector);
      const text = await h.driver.textContent(h.step.copyText.selector);
      if (text === null) {
        throw new Error(`No text content found for selector: ${h.step.copyText.selector}`);
      }
      h.runtimeVars.set(h.step.copyText.as, text);
      return {
        kind: "result",
        result: {
          type: "copyText",
          status: "pass",
          durationMs: Date.now() - h.stepStart,
          selector: h.step.copyText.selector,
          value: "[REDACTED]"
        }
      };
    }
  },

  waitForDownload: {
    capabilities: ["download"],
    run: async (h) => {
      if (!("waitForDownload" in h.step)) unknownStep();
      const opts = h.step.waitForDownload;
      const downloadPromise = h.context.pendingDownload ?? armDownloadListener(h.driver, opts?.timeout ?? 30000);
      h.context.pendingDownload = undefined;
      const download = await downloadPromise;
      const suggestedFilename = validateDownloadFilename(download.suggestedFilename());
      if (opts?.filename !== undefined && suggestedFilename !== opts.filename) {
        throw new Error(
          `Download filename mismatch: expected "${opts.filename}", got "${suggestedFilename}"`
        );
      }
      const savePath = path.join(h.context.runDir, suggestedFilename);
      await download.saveAs(savePath);
      return {
        kind: "result",
        result: {
          type: "waitForDownload",
          status: "pass",
          durationMs: Date.now() - h.stepStart,
          value: suggestedFilename
        }
      };
    }
  }
};

export async function executeSteps(context: StepExecutionContext): Promise<StepExecutionResult> {
  let driver = context.driver;
  if (!driver) {
    if (!context.page) {
      throw new Error("executeSteps requires a driver or a Playwright page");
    }
    driver = createPlaywrightDriver(context.page);
  }
  const policy = createRunPolicy(driver, {
    forbiddenSelectors: context.forbiddenSelectors,
    allowedDomains: context.allowedDomains,
    allowedApps: context.allowedApps,
    maxSteps: context.maxSteps,
    selfHealing: context.selfHealing
  });

  const screenshotsDir = path.join(context.runDir, "screenshots");
  fs.mkdirSync(screenshotsDir, { recursive: true });
  const currentHuntName = context.huntStack?.[context.huntStack.length - 1];
  policy.assertWithinMaxSteps(context.steps.length, currentHuntName);

  const results: StepResult[] = [];
  const screenshots: string[] = [];
  const runStartedAtMs = context.runStartedAtMs ?? Date.now();
  context.runStartedAtMs = runStartedAtMs;

  const addScreenshot = async (fileName: string): Promise<string> => {
    const fullPath = screenshotPath(screenshotsDir, fileName);
    await captureScreenshot(driver, fullPath);
    const relative = path.join("screenshots", fileName);
    screenshots.push(relative);
    return relative;
  };

  const executeNested = (
    overrides: Partial<StepExecutionContext> & Pick<StepExecutionContext, "steps">
  ): Promise<StepExecutionResult> => executeNestedSteps(context, { driver, ...overrides });

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
        driver,
        nextStep.waitForDownload?.timeout ?? 30000
      );
    }
    const stepStart = Date.now();
    const stepType = getStepType(step);
    let stepResult: StepResult | null = null;

    try {
      const handler = STEP_HANDLERS[stepType];
      if (!handler) {
        throw new Error("Unknown step type");
      }
      for (const capability of handler.capabilities) {
        if (!driver.capabilities.has(capability)) {
          throw new Error(
            `Driver does not support capability "${capability}" required by step "${stepType}"`
          );
        }
      }

      const outcome = await handler.run({
        driver,
        policy,
        context,
        step,
        index,
        stepPath: currentStepPath,
        stepStart,
        runtimeVars,
        results,
        screenshots,
        addScreenshot,
        executeNested
      });

      if (outcome.kind === "abort") {
        return { results, screenshots, failed: true, error: outcome.error };
      }

      stepResult = outcome.result;

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

export async function captureFinalScreenshot(page: ScreenshotTaker, runDir: string): Promise<string> {
  const screenshotsDir = path.join(runDir, "screenshots");
  fs.mkdirSync(screenshotsDir, { recursive: true });
  const fileName = "final.png";
  const filePath = screenshotPath(screenshotsDir, fileName);
  await captureScreenshot(page, filePath);
  return path.join("screenshots", fileName);
}
