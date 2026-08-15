/**
 * PROWL-047 / ARCH-001 — Guardrail policy layer.
 *
 * The guardrails that used to be enforced inline in `steps.ts`
 * (`allowedDomains`, `forbiddenSelectors`, `maxSteps`, and self-healing) now
 * live here, wrapping a {@link SessionDriver}. Handlers call the policy for
 * selector/URL/step-count checks and to resolve (guard + optionally heal) the
 * selector an explicit-selector action should run against.
 *
 * The forbidden-selector matcher uses the driver-supplied selector parser
 * (`driver.parseTextSelector`) so it can interpret text-engine selectors
 * without hard-coding the engine's dialect.
 */
import type { SessionDriver } from "../browser/driver.js";
import { healSelector, type SelectorProbe } from "./healing.js";

const ALWAYS_ALLOWED_PROTOCOLS = ["about:", "data:"];

export type RunPolicyOptions = {
  forbiddenSelectors: string[];
  allowedDomains: string[];
  /** Allow-listed bundle IDs / process names for the macOS target (default []). */
  allowedApps?: string[];
  maxSteps: number;
  selfHealing?: boolean;
};

export type RunPolicy = {
  /** Throw if a hunt/step list exceeds the configured `maxSteps`. */
  assertWithinMaxSteps(stepCount: number, huntName?: string): void;
  /** Throw if navigating/landing on a URL whose host is not allow-listed. */
  ensureUrlAllowed(urlValue: string): void;
  /** Throw if a bundle id / process name is not allow-listed (macOS target). */
  ensureAppAllowed(app: string): void;
  /**
   * Re-assert scope after an action, in a target-aware way: on a URL-capable
   * driver (web) this is the allowed-domain check on the current URL; on a
   * driver without the `navigate` capability (e.g. macOS) there is no URL to
   * check and app scope is enforced at launch, so this is a no-op.
   */
  ensureLocationAllowed(driver: SessionDriver): void;
  /** Throw if a selector matches the forbidden list. */
  assertAllowedSelector(selector: string): void;
  /**
   * Guard a selector, then — when self-healing is on and it matches nothing —
   * attempt to heal to an equivalent selector (re-checked against the forbidden
   * list). Returns the selector to use plus, when healed, the original.
   */
  resolveActionSelector(selector: string): Promise<{ selector: string; healedFrom?: string }>;
};

export function createRunPolicy(driver: SessionDriver, options: RunPolicyOptions): RunPolicy {
  const { forbiddenSelectors, allowedDomains, maxSteps, selfHealing } = options;
  const allowedApps = options.allowedApps ?? [];

  // Substring match: if both the selector and forbidden pattern are text=
  // selectors, the selector's text is checked for whether it *contains* the
  // forbidden text. For example, forbidden 'text="Delete"' matches selector
  // 'text="Delete All"'. The driver supplies the text-selector parser.
  function matchesForbiddenPattern(selector: string, forbidden: string): boolean {
    const selectorText = driver.parseTextSelector(selector);
    if (selectorText === null) {
      return false;
    }
    const forbiddenText = driver.parseTextSelector(forbidden);
    if (forbiddenText !== null) {
      return selectorText.includes(forbiddenText);
    }
    return selectorText.includes(forbidden);
  }

  // A selector is forbidden if it contains any forbidden pattern as a substring
  // (e.g. forbidden "[data-danger]" matches "[data-danger].active"), or if the
  // text-based pattern match above succeeds.
  function isForbiddenSelector(selector: string): boolean {
    return forbiddenSelectors.some(
      (forbidden) => selector.includes(forbidden) || matchesForbiddenPattern(selector, forbidden)
    );
  }

  function assertAllowedSelector(selector: string): void {
    if (isForbiddenSelector(selector)) {
      throw new Error(`Forbidden selector: ${selector}`);
    }
  }

  function assertWithinMaxSteps(stepCount: number, huntName?: string): void {
    if (stepCount > maxSteps) {
      if (huntName) {
        throw new Error(`Hunt "${huntName}" has ${stepCount} steps. Max allowed is ${maxSteps}.`);
      }
      throw new Error(`Hunt has ${stepCount} steps. Max allowed is ${maxSteps}.`);
    }
  }

  function ensureUrlAllowed(urlValue: string): void {
    for (const protocol of ALWAYS_ALLOWED_PROTOCOLS) {
      if (urlValue.startsWith(protocol)) {
        return;
      }
    }
    let url: URL;
    try {
      url = new URL(urlValue);
    } catch {
      throw new Error(`Navigation target is not a valid absolute URL: ${urlValue}`);
    }
    if (!allowedDomains.includes(url.hostname)) {
      throw new Error(`Navigation to disallowed domain: ${url.hostname}`);
    }
  }

  function ensureAppAllowed(app: string): void {
    if (!allowedApps.includes(app)) {
      throw new Error(`Interaction with disallowed app: ${app}`);
    }
  }

  function ensureLocationAllowed(activeDriver: SessionDriver): void {
    // URL scope only applies to URL-capable (web) drivers. Non-navigating
    // drivers (macOS) have no URL; their app scope is enforced at launch.
    if (activeDriver.capabilities.has("navigate")) {
      ensureUrlAllowed(activeDriver.currentUrl());
    }
  }

  // Bridge the driver's `count` verb to the healing probe surface, so healing
  // stays driver-agnostic.
  const healProbe: SelectorProbe = {
    locator: (selector: string) => ({ count: () => driver.count(selector) })
  };

  async function resolveActionSelector(
    selector: string
  ): Promise<{ selector: string; healedFrom?: string }> {
    assertAllowedSelector(selector);

    if (!selfHealing) {
      return { selector };
    }

    let matched = false;
    try {
      matched = (await driver.count(selector)) > 0;
    } catch {
      // Unparseable/odd selector — let the real action surface the error.
      return { selector };
    }
    if (matched) {
      return { selector };
    }

    const healed = await healSelector(healProbe, selector, { enabled: true });
    if (!healed) {
      return { selector };
    }

    assertAllowedSelector(healed.selector);
    console.warn(
      `Self-healed selector: "${selector}" → "${healed.selector}" (${healed.strategy}). ` +
        "Update your hunt to use a stable selector."
    );
    return { selector: healed.selector, healedFrom: healed.healedFrom };
  }

  return {
    assertWithinMaxSteps,
    ensureUrlAllowed,
    ensureAppAllowed,
    ensureLocationAllowed,
    assertAllowedSelector,
    resolveActionSelector
  };
}
