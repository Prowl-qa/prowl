import crypto from "node:crypto";
import type { Assertion, Hunt, Step } from "../types/index.js";

export type InterpolatedHunt = {
  hunt: Hunt;
  redactedFillSteps: Set<string>;
};

export type InterpolationResult = {
  value: string;
  usedVars: string[];
};

const VAR_PATTERN = /\{\{([A-Z0-9_]+)\}\}/g;

export function interpolateString(
  input: string,
  vars: Record<string, string>
): InterpolationResult {
  const usedVars: string[] = [];
  const value = input.replace(VAR_PATTERN, (_, name: string) => {
    const varValue = vars[name];
    if (varValue === undefined) {
      throw new Error(`Missing variable: ${name}`);
    }
    usedVars.push(name);
    return varValue;
  });
  return { value, usedVars };
}

const RANDOM_FIRST_NAMES = ["Alex", "Jordan", "Morgan", "Taylor", "Casey", "Riley", "Quinn", "Avery"];
const RANDOM_LAST_NAMES = ["Smith", "Johnson", "Brown", "Davis", "Wilson", "Clark", "Hall", "Young"];

export function generateRandomVars(): Record<string, string> {
  const hex = crypto.randomBytes(4).toString("hex");
  const firstIndex = Math.floor(Math.random() * RANDOM_FIRST_NAMES.length);
  const lastIndex = Math.floor(Math.random() * RANDOM_LAST_NAMES.length);
  const num = Math.floor(Math.random() * 9000) + 1000;
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 8; i++) {
    text += chars[Math.floor(Math.random() * chars.length)];
  }
  return {
    RANDOM_EMAIL: `prowl_${hex}@test.com`,
    RANDOM_NAME: `${RANDOM_FIRST_NAMES[firstIndex]} ${RANDOM_LAST_NAMES[lastIndex]}`,
    RANDOM_NUMBER: String(num),
    RANDOM_UUID: crypto.randomUUID(),
    RANDOM_TEXT: text
  };
}

function interpolateStep(
  step: Step,
  vars: Record<string, string>,
  stepPath: string,
  redacted: Set<string>
): Step {
  const isExplicitFill = (
    value: { selector: string; value: string } | Record<string, string>
  ): value is { selector: string; value: string } =>
    typeof (value as { selector?: unknown }).selector === "string" &&
    typeof (value as { value?: unknown }).value === "string";

  const interpolateSinglePair = (record: Record<string, string>): Record<string, string> => {
    const entries = Object.entries(record);
    if (entries.length !== 1) {
      throw new Error("Shorthand step expects exactly one key-value pair");
    }
    const [key, value] = entries[0];
    return {
      [interpolateString(key, vars).value]: interpolateString(value, vars).value
    };
  };

  if ("navigate" in step) {
    const result = interpolateString(step.navigate, vars);
    return { navigate: result.value };
  }
  if ("click" in step) {
    if (typeof step.click === "string") {
      return { click: interpolateString(step.click, vars).value };
    }
    const result = interpolateString(step.click.selector, vars);
    return { click: { selector: result.value } };
  }
  if ("fill" in step) {
    if (isExplicitFill(step.fill)) {
      const selectorResult = interpolateString(step.fill.selector, vars);
      const valueResult = interpolateString(step.fill.value, vars);
      if (valueResult.usedVars.length > 0) {
        redacted.add(stepPath);
      }
      return { fill: { selector: selectorResult.value, value: valueResult.value } };
    }
    const [rawLabel, rawValue] = Object.entries(step.fill)[0] ?? [];
    if (rawLabel === undefined || rawValue === undefined) {
      throw new Error("Shorthand fill expects exactly one key-value pair");
    }
    const labelResult = interpolateString(rawLabel, vars);
    const valueResult = interpolateString(rawValue, vars);
    if (valueResult.usedVars.length > 0) {
      redacted.add(stepPath);
    }
    return {
      fill: {
        [labelResult.value]: valueResult.value
      }
    };
  }
  if ("type" in step) {
    const valueResult = interpolateString(step.type, vars);
    if (valueResult.usedVars.length > 0) {
      redacted.add(stepPath);
    }
    return { type: valueResult.value };
  }
  if ("selectOption" in step) {
    const selectorResult = interpolateString(step.selectOption.selector, vars);
    const valueResult = interpolateString(step.selectOption.value, vars);
    return { selectOption: { selector: selectorResult.value, value: valueResult.value } };
  }
  if ("select" in step) {
    return { select: interpolateSinglePair(step.select) };
  }
  if ("press" in step) {
    const selectorResult = interpolateString(step.press.selector, vars);
    const keyResult = interpolateString(step.press.key, vars);
    return { press: { selector: selectorResult.value, key: keyResult.value } };
  }
  if ("onDialog" in step) {
    return { onDialog: { action: step.onDialog.action } };
  }
  if ("setInputFiles" in step) {
    const selectorResult = interpolateString(step.setInputFiles.selector, vars);
    const rawFiles = step.setInputFiles.files;
    const files = Array.isArray(rawFiles)
      ? rawFiles.map((f) => interpolateString(f, vars).value)
      : interpolateString(rawFiles, vars).value;
    return { setInputFiles: { selector: selectorResult.value, files } };
  }
  if ("runHunt" in step) {
    if (typeof step.runHunt === "string") {
      return { runHunt: interpolateString(step.runHunt, vars).value };
    }
    const nameResult = interpolateString(step.runHunt.name, vars);
    const interpolatedVars: Record<string, string> = {};
    for (const [key, value] of Object.entries(step.runHunt.vars ?? {})) {
      interpolatedVars[key] = interpolateString(value, vars).value;
    }
    return {
      runHunt: {
        name: nameResult.value,
        ...(Object.keys(interpolatedVars).length > 0 ? { vars: interpolatedVars } : {})
      }
    };
  }
  if ("assert" in step) {
    if (step.assert.visible !== undefined) {
      return { assert: { visible: interpolateString(step.assert.visible, vars).value } };
    }
    if (step.assert.notVisible !== undefined) {
      return { assert: { notVisible: interpolateString(step.assert.notVisible, vars).value } };
    }
    if (step.assert.urlIncludes !== undefined) {
      return { assert: { urlIncludes: interpolateString(step.assert.urlIncludes, vars).value } };
    }
    if (step.assert.urlEquals !== undefined) {
      return { assert: { urlEquals: interpolateString(step.assert.urlEquals, vars).value } };
    }
    return step;
  }
  if ("wait" in step) {
    if (typeof step.wait === "string") {
      return { wait: interpolateString(step.wait, vars).value };
    }
    return {
      wait: {
        for: interpolateString(step.wait.for, vars).value,
        timeout: step.wait.timeout
      }
    };
  }
  if ("waitForSelector" in step) {
    const selectorResult = interpolateString(step.waitForSelector.selector, vars);
    return {
      waitForSelector: {
        selector: selectorResult.value,
        timeout: step.waitForSelector.timeout
      }
    };
  }
  if ("waitForUrl" in step) {
    const valueResult = interpolateString(step.waitForUrl.value, vars);
    return {
      waitForUrl: {
        value: valueResult.value,
        timeout: step.waitForUrl.timeout
      }
    };
  }
  if ("waitForNetworkIdle" in step) {
    return { waitForNetworkIdle: { timeout: step.waitForNetworkIdle.timeout } };
  }
  if ("hover" in step) {
    const selectorResult = interpolateString(step.hover.selector, vars);
    return { hover: { selector: selectorResult.value } };
  }
  if ("scroll" in step) {
    return { scroll: { direction: step.scroll.direction, amount: step.scroll.amount } };
  }
  if ("scrollTo" in step) {
    const selectorResult = interpolateString(step.scrollTo.selector, vars);
    return { scrollTo: { selector: selectorResult.value } };
  }
  if ("screenshot" in step) {
    return { screenshot: { name: step.screenshot.name } };
  }
  if ("if" in step) {
    const condition = step.if;
    const thenSteps = condition.then.map((s, i) =>
      interpolateStep(s, vars, `${stepPath}.if.then.${i}`, redacted)
    );
    const elseSteps = condition.else?.map((s, i) =>
      interpolateStep(s, vars, `${stepPath}.if.else.${i}`, redacted)
    );
    return {
      if: {
        ...(condition.visible !== undefined
          ? { visible: interpolateString(condition.visible, vars).value }
          : {}),
        ...(condition.notVisible !== undefined
          ? { notVisible: interpolateString(condition.notVisible, vars).value }
          : {}),
        then: thenSteps,
        ...(elseSteps !== undefined ? { else: elseSteps } : {})
      }
    };
  }
  if ("repeat" in step) {
    const repeat = step.repeat;
    const subSteps = repeat.steps.map((s, i) =>
      interpolateStep(s, vars, `${stepPath}.repeat.steps.${i}`, redacted)
    );
    return {
      repeat: {
        ...(repeat.times !== undefined ? { times: repeat.times } : {}),
        ...(repeat.while !== undefined
          ? {
              while: {
                ...(repeat.while.visible !== undefined
                  ? { visible: interpolateString(repeat.while.visible, vars).value }
                  : {}),
                ...(repeat.while.notVisible !== undefined
                  ? { notVisible: interpolateString(repeat.while.notVisible, vars).value }
                  : {})
              }
            }
          : {}),
        ...(repeat.maxIterations !== undefined ? { maxIterations: repeat.maxIterations } : {}),
        steps: subSteps
      }
    };
  }
  if ("mockRoute" in step) {
    const mock = step.mockRoute;
    return {
      mockRoute: {
        url: interpolateString(mock.url, vars).value,
        response: {
          status: mock.response.status,
          ...(mock.response.contentType !== undefined
            ? { contentType: interpolateString(mock.response.contentType, vars).value }
            : {}),
          ...(mock.response.body !== undefined
            ? { body: interpolateString(mock.response.body, vars).value }
            : {}),
          ...(mock.response.file !== undefined
            ? { file: interpolateString(mock.response.file, vars).value }
            : {})
        }
      }
    };
  }
  if ("unmockRoute" in step) {
    if (typeof step.unmockRoute === "string") {
      return { unmockRoute: interpolateString(step.unmockRoute, vars).value };
    }
    return {
      unmockRoute: { url: interpolateString(step.unmockRoute.url, vars).value }
    };
  }
  if ("evalScript" in step) {
    if (typeof step.evalScript === "string") {
      return { evalScript: interpolateString(step.evalScript, vars).value };
    }
    return {
      evalScript: {
        expression: interpolateString(step.evalScript.expression, vars).value,
        ...(step.evalScript.as !== undefined ? { as: step.evalScript.as } : {})
      }
    };
  }
  if ("runScript" in step) {
    return {
      runScript: { file: interpolateString(step.runScript.file, vars).value }
    };
  }
  if ("assertScreenshot" in step) {
    return {
      assertScreenshot: {
        name: interpolateString(step.assertScreenshot.name, vars).value,
        ...(step.assertScreenshot.threshold !== undefined
          ? { threshold: step.assertScreenshot.threshold }
          : {})
      }
    };
  }
  if ("copyText" in step) {
    return {
      copyText: {
        selector: interpolateString(step.copyText.selector, vars).value,
        as: step.copyText.as
      }
    };
  }
  if ("waitForDownload" in step) {
    if (step.waitForDownload === null) {
      return { waitForDownload: null };
    }
    return {
      waitForDownload: {
        ...(step.waitForDownload.filename !== undefined
          ? { filename: interpolateString(step.waitForDownload.filename, vars).value }
          : {}),
        ...(step.waitForDownload.timeout !== undefined
          ? { timeout: step.waitForDownload.timeout }
          : {})
      }
    };
  }
  return step;
}

function interpolateAssertion(assertion: Assertion, vars: Record<string, string>): Assertion {
  if ("selectorExists" in assertion) {
    return { selectorExists: interpolateString(assertion.selectorExists, vars).value };
  }
  if ("selectorNotExists" in assertion) {
    return { selectorNotExists: interpolateString(assertion.selectorNotExists, vars).value };
  }
  if ("urlIncludes" in assertion) {
    return { urlIncludes: interpolateString(assertion.urlIncludes, vars).value };
  }
  if ("urlEquals" in assertion) {
    return { urlEquals: interpolateString(assertion.urlEquals, vars).value };
  }
  if ("noConsoleErrors" in assertion) {
    return { noConsoleErrors: assertion.noConsoleErrors };
  }
  if ("noNetworkErrors" in assertion) {
    return { noNetworkErrors: assertion.noNetworkErrors };
  }
  return assertion;
}

export function interpolateHunt(hunt: Hunt, env: NodeJS.ProcessEnv): InterpolatedHunt {
  const redactedFillSteps = new Set<string>();

  const envVars = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined) as Array<[string, string]>
  );

  const resolvedHuntVars: Record<string, string> = {};
  for (const [key, value] of Object.entries(hunt.vars ?? {})) {
    resolvedHuntVars[key] = interpolateString(value, envVars).value;
  }

  const randomVars = generateRandomVars();
  const vars = { ...randomVars, ...envVars, ...resolvedHuntVars };
  const steps = hunt.steps.map((step, index) =>
    interpolateStep(step, vars, `${index}`, redactedFillSteps)
  );
  const assertions = hunt.assertions?.map((assertion) => interpolateAssertion(assertion, vars));
  return {
    hunt: {
      ...hunt,
      steps,
      assertions
    },
    redactedFillSteps
  };
}
