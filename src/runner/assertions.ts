import type { Assertion, AssertionResult, Config } from "../types/index.js";

/**
 * The minimal session surface assertions read from. Both a live Playwright page
 * and a {@link SessionDriver}-backed page satisfy it structurally, so
 * `evaluateAssertions` has no Playwright dependency.
 */
type AssertionSession = {
  url(): string;
  locator(selector: string): { count(): Promise<number> };
};

export type ConsoleEntry = {
  type: string;
  text: string;
  location?: string;
};

export type NetworkEntry = {
  url: string;
  status: number;
};

function shouldIgnoreNetwork(url: string, patterns: string[]): boolean {
  return patterns.some((pattern) => url.includes(pattern));
}

function filterNetworkEntries(entries: NetworkEntry[], patterns: string[]): NetworkEntry[] {
  if (patterns.length === 0) {
    return entries;
  }
  return entries.filter((entry) => !shouldIgnoreNetwork(entry.url, patterns));
}

function mergeAssertions(config: Config, huntAssertions: Assertion[] = []): Assertion[] {
  let noConsoleErrors = config.assertions.noConsoleErrors;
  let noNetworkErrors = config.assertions.noNetworkErrors;

  for (const assertion of huntAssertions) {
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

  for (const assertion of huntAssertions) {
    if ("noConsoleErrors" in assertion || "noNetworkErrors" in assertion) {
      continue;
    }
    merged.push(assertion);
  }

  return merged;
}

export async function evaluateAssertions(options: {
  page: AssertionSession;
  config: Config;
  huntAssertions?: Assertion[];
  consoleEntries: ConsoleEntry[];
  networkEntries: NetworkEntry[];
}): Promise<AssertionResult[]> {
  const assertions = mergeAssertions(options.config, options.huntAssertions);
  const results: AssertionResult[] = [];
  const networkEntries = filterNetworkEntries(
    options.networkEntries,
    options.config.assertions.networkIgnorePatterns
  );

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
        const pass = networkEntries.length === 0;
        results.push({
          type: "noNetworkErrors",
          value: true,
          status: pass ? "pass" : "fail",
          error: pass ? undefined : `${networkEntries.length} network error(s)`
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

/** The minimal driver surface the native assertion evaluator queries. */
type NativeAssertionDriver = {
  count(selector: string): Promise<number>;
};

export type NativeAssertionEvaluation = {
  results: AssertionResult[];
  /** Human-facing warnings (one per web-only assertion skipped), to log. */
  warnings: string[];
};

/**
 * PROWL-050 / ARCH-004 — evaluate hunt- and config-level assertions on a native
 * (macOS / Android / iOS) target. Config- and hunt-level blocks are merged with
 * exactly the same {@link mergeAssertions} the web path uses, so precedence is
 * identical. Assertion types that resolve a selector
 * ({@link NATIVE_APPLICABLE_ASSERTION_TYPES}) run against the driver's `count`;
 * web-only types (URL / console / network) are reported with status `skipped`,
 * never silently dropped and never a hard error. Mirrors the web path's
 * semantics: config- and hunt-level blocks merge identically and assertions are
 * evaluated after steps regardless of whether a step failed.
 *
 * A console warning is emitted only for web-only assertions the **hunt** authored
 * (clear intent), not for the `noConsoleErrors`/`noNetworkErrors` config defaults
 * that apply to every run — those still surface as skipped results, so they are
 * fully auditable without spamming a warning on every native run.
 */
export async function evaluateNativeAssertions(options: {
  driver: NativeAssertionDriver;
  config: Config;
  huntAssertions?: Assertion[];
  /** Display label for the target, e.g. "macOS" / "Android" / "iOS". */
  targetLabel: string;
}): Promise<NativeAssertionEvaluation> {
  const assertions = mergeAssertions(options.config, options.huntAssertions);
  const authoredTypes = new Set(
    (options.huntAssertions ?? []).map((assertion) => Object.keys(assertion)[0])
  );
  const results: AssertionResult[] = [];
  const warnings: string[] = [];

  for (const assertion of assertions) {
    const type = Object.keys(assertion)[0] ?? "assertion";
    try {
      if ("selectorExists" in assertion) {
        const count = await options.driver.count(assertion.selectorExists);
        results.push({
          type: "selectorExists",
          value: assertion.selectorExists,
          status: count > 0 ? "pass" : "fail",
          error: count > 0 ? undefined : "Selector not found"
        });
        continue;
      }
      if ("selectorNotExists" in assertion) {
        const count = await options.driver.count(assertion.selectorNotExists);
        results.push({
          type: "selectorNotExists",
          value: assertion.selectorNotExists,
          status: count === 0 ? "pass" : "fail",
          error: count === 0 ? undefined : "Selector exists"
        });
        continue;
      }

      // Every remaining Assertion type is web-only on a native target.
      const rawValue = (assertion as Record<string, string | boolean>)[type];
      results.push({
        type,
        value: rawValue,
        status: "skipped",
        error: `skipped (web-only): not supported on the ${options.targetLabel} target`
      });
      if (authoredTypes.has(type)) {
        warnings.push(`${type} is web-only; skipped on ${options.targetLabel} target`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Assertion failed";
      results.push({ type, status: "fail", error: message });
    }
  }

  return { results, warnings };
}
