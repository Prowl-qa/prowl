import type { Assertion, Goal, Step } from "../types/index.js";

export type InterpolatedGoal = {
  goal: Goal;
  redactedFillSteps: Set<number>;
};

export type InterpolationResult = {
  value: string;
  usedVars: string[];
};

const VAR_PATTERN = /\{\{([A-Z0-9_]+)\}\}/g;

export function interpolateString(input: string, env: NodeJS.ProcessEnv): InterpolationResult {
  const usedVars: string[] = [];
  const value = input.replace(VAR_PATTERN, (_, name: string) => {
    const envValue = env[name];
    if (!envValue) {
      throw new Error(`Missing environment variable: ${name}`);
    }
    usedVars.push(name);
    return envValue;
  });
  return { value, usedVars };
}

function interpolateStep(step: Step, env: NodeJS.ProcessEnv, index: number, redacted: Set<number>): Step {
  if ("navigate" in step) {
    const result = interpolateString(step.navigate, env);
    return { navigate: result.value };
  }
  if ("click" in step) {
    const result = interpolateString(step.click.selector, env);
    return { click: { selector: result.value } };
  }
  if ("fill" in step) {
    const selectorResult = interpolateString(step.fill.selector, env);
    const valueResult = interpolateString(step.fill.value, env);
    if (valueResult.usedVars.length > 0) {
      redacted.add(index);
    }
    return { fill: { selector: selectorResult.value, value: valueResult.value } };
  }
  if ("press" in step) {
    const selectorResult = interpolateString(step.press.selector, env);
    const keyResult = interpolateString(step.press.key, env);
    return { press: { selector: selectorResult.value, key: keyResult.value } };
  }
  if ("waitForSelector" in step) {
    const selectorResult = interpolateString(step.waitForSelector.selector, env);
    return {
      waitForSelector: {
        selector: selectorResult.value,
        timeout: step.waitForSelector.timeout
      }
    };
  }
  if ("waitForUrl" in step) {
    const valueResult = interpolateString(step.waitForUrl.value, env);
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

function interpolateAssertion(assertion: Assertion, env: NodeJS.ProcessEnv): Assertion {
  if ("selectorExists" in assertion) {
    return { selectorExists: interpolateString(assertion.selectorExists, env).value };
  }
  if ("selectorNotExists" in assertion) {
    return { selectorNotExists: interpolateString(assertion.selectorNotExists, env).value };
  }
  if ("urlIncludes" in assertion) {
    return { urlIncludes: interpolateString(assertion.urlIncludes, env).value };
  }
  if ("urlEquals" in assertion) {
    return { urlEquals: interpolateString(assertion.urlEquals, env).value };
  }
  if ("noConsoleErrors" in assertion) {
    return { noConsoleErrors: assertion.noConsoleErrors };
  }
  if ("noNetworkErrors" in assertion) {
    return { noNetworkErrors: assertion.noNetworkErrors };
  }
  return assertion;
}

export function interpolateGoal(goal: Goal, env: NodeJS.ProcessEnv): InterpolatedGoal {
  const redactedFillSteps = new Set<number>();
  const steps = goal.steps.map((step, index) => interpolateStep(step, env, index, redactedFillSteps));
  const assertions = goal.assertions?.map((assertion) => interpolateAssertion(assertion, env));
  return {
    goal: {
      ...goal,
      steps,
      assertions
    },
    redactedFillSteps
  };
}
