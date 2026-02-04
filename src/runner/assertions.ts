import type { Page } from "playwright";
import type { Assertion, AssertionResult, Config } from "../types/index.js";

export type ConsoleEntry = {
  type: string;
  text: string;
  location?: string;
};

export type NetworkEntry = {
  url: string;
  status: number;
};

function mergeAssertions(config: Config, goalAssertions: Assertion[] = []): Assertion[] {
  let noConsoleErrors = config.assertions.noConsoleErrors;
  let noNetworkErrors = config.assertions.noNetworkErrors;

  for (const assertion of goalAssertions) {
    if ("noConsoleErrors" in assertion) {
      noConsoleErrors = assertion.noConsoleErrors;
    }
    if ("noNetworkErrors" in assertion) {
      noNetworkErrors = assertion.noNetworkErrors;
    }
  }

  const merged: Assertion[] = [];
  if (noConsoleErrors) {
    merged.push({ noConsoleErrors: true });
  }
  if (noNetworkErrors) {
    merged.push({ noNetworkErrors: true });
  }

  for (const assertion of goalAssertions) {
    if ("noConsoleErrors" in assertion || "noNetworkErrors" in assertion) {
      continue;
    }
    merged.push(assertion);
  }

  return merged;
}

export async function evaluateAssertions(options: {
  page: Page;
  config: Config;
  goalAssertions?: Assertion[];
  consoleEntries: ConsoleEntry[];
  networkEntries: NetworkEntry[];
}): Promise<AssertionResult[]> {
  const assertions = mergeAssertions(options.config, options.goalAssertions);
  const results: AssertionResult[] = [];

  for (const assertion of assertions) {
    try {
      if ("selectorExists" in assertion) {
        const count = await options.page.locator(assertion.selectorExists).count();
        results.push({
          type: "selectorExists",
          value: assertion.selectorExists,
          status: count > 0 ? "pass" : "fail",
          error: count > 0 ? undefined : "Selector not found"
        });
        continue;
      }
      if ("selectorNotExists" in assertion) {
        const count = await options.page.locator(assertion.selectorNotExists).count();
        results.push({
          type: "selectorNotExists",
          value: assertion.selectorNotExists,
          status: count === 0 ? "pass" : "fail",
          error: count === 0 ? undefined : "Selector exists"
        });
        continue;
      }
      if ("urlIncludes" in assertion) {
        const current = options.page.url();
        const pass = current.includes(assertion.urlIncludes);
        results.push({
          type: "urlIncludes",
          value: assertion.urlIncludes,
          status: pass ? "pass" : "fail",
          error: pass ? undefined : `URL did not include ${assertion.urlIncludes}`
        });
        continue;
      }
      if ("urlEquals" in assertion) {
        const current = options.page.url();
        const pass = current === assertion.urlEquals;
        results.push({
          type: "urlEquals",
          value: assertion.urlEquals,
          status: pass ? "pass" : "fail",
          error: pass ? undefined : `URL did not equal ${assertion.urlEquals}`
        });
        continue;
      }
      if ("noConsoleErrors" in assertion) {
        const errors = options.consoleEntries.filter((entry) => entry.type === "error");
        const pass = errors.length === 0;
        results.push({
          type: "noConsoleErrors",
          value: true,
          status: pass ? "pass" : "fail",
          error: pass ? undefined : `${errors.length} console error(s)`
        });
        continue;
      }
      if ("noNetworkErrors" in assertion) {
        const pass = options.networkEntries.length === 0;
        results.push({
          type: "noNetworkErrors",
          value: true,
          status: pass ? "pass" : "fail",
          error: pass ? undefined : `${options.networkEntries.length} network error(s)`
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Assertion failed";
      const type = Object.keys(assertion)[0] ?? "assertion";
      results.push({
        type,
        status: "fail",
        error: message
      });
    }
  }

  return results;
}
