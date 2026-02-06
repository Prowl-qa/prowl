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
    if (!varValue) {
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
  if ("navigate" in step) {
    const result = interpolateString(step.navigate, vars);
    return { navigate: result.value };
  }
  if ("click" in step) {
    const result = interpolateString(step.click.selector, vars);
    return { click: { selector: result.value } };
  }
  if ("fill" in step) {
    const selectorResult = interpolateString(step.fill.selector, vars);
    const valueResult = interpolateString(step.fill.value, vars);
    if (valueResult.usedVars.length > 0) {
      redacted.add(index);
    }
    return { fill: { selector: selectorResult.value, value: valueResult.value } };
  }
  if ("press" in step) {
    const selectorResult = interpolateString(step.press.selector, vars);
    const keyResult = interpolateString(step.press.key, vars);
    return { press: { selector: selectorResult.value, key: keyResult.value } };
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
  const vars = {
    ...Object.fromEntries(
      Object.entries(env).filter(([, value]) => value !== undefined) as Array<[string, string]>
    ),
    ...(hunt.vars ?? {})
  };
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
