import { describe, expect, it } from "vitest";
import type { SessionDriver } from "../src/browser/driver.js";
import { createRunPolicy } from "../src/runner/policy.js";

function policyDriver(): SessionDriver {
  return {
    parseTextSelector: () => null
  } as unknown as SessionDriver;
}

describe("createRunPolicy", () => {
  it("throws an actionable error for invalid navigation URLs", () => {
    const policy = createRunPolicy(policyDriver(), {
      forbiddenSelectors: [],
      allowedDomains: ["example.com"],
      maxSteps: 50
    });

    expect(() => policy.ensureUrlAllowed("not an absolute URL")).toThrow(
      "Navigation target is not a valid absolute URL: not an absolute URL"
    );
  });

  it("preserves disallowed-domain errors for valid URLs", () => {
    const policy = createRunPolicy(policyDriver(), {
      forbiddenSelectors: [],
      allowedDomains: ["example.com"],
      maxSteps: 50
    });

    expect(() => policy.ensureUrlAllowed("https://evil.test/path")).toThrow(
      "Navigation to disallowed domain: evil.test"
    );
  });
});
