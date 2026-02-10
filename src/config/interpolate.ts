import type { Assertion, Hunt, Step } from "../types/index.js";

export type InterpolatedHunt = {
  hunt: Hunt;
  redactedFillSteps: Set<number>;
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

function interpolateStep(
  step: Step,
  vars: Record<string, string>,
  index: number,
  redacted: Set<number>
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
        redacted.add(index);
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
      redacted.add(index);
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
      redacted.add(index);
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
  if ("screenshot" in step) {
    return { screenshot: { name: step.screenshot.name } };
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
  const redactedFillSteps = new Set<number>();

  const envVars = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined) as Array<[string, string]>
  );

  const resolvedHuntVars: Record<string, string> = {};
  for (const [key, value] of Object.entries(hunt.vars ?? {})) {
    resolvedHuntVars[key] = interpolateString(value, envVars).value;
  }

  const vars = { ...envVars, ...resolvedHuntVars };
  const steps = hunt.steps.map((step, index) => interpolateStep(step, vars, index, redactedFillSteps));
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
