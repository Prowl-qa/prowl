import { describe, expect, it } from "vitest";
import type { SessionDriver } from "../src/browser/driver.js";
import { createRunPolicy } from "../src/runner/policy.js";

function policyDriver(): SessionDriver {
  return {
    parseTextSelector: () => null
  } as unknown as SessionDriver;
}

function driverWithCapabilities(caps: string[], currentUrl: () => string): SessionDriver {
  return {
    parseTextSelector: () => null,
    capabilities: new Set(caps),
    currentUrl
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

describe("createRunPolicy — native scope (PROWL-048)", () => {
  const base = { forbiddenSelectors: [], allowedDomains: [], maxSteps: 50 };

  it("ensureAppAllowed passes an allow-listed bundle id and rejects others", () => {
    const policy = createRunPolicy(policyDriver(), { ...base, allowedApps: ["com.example.App"] });
    expect(() => policy.ensureAppAllowed("com.example.App")).not.toThrow();
    expect(() => policy.ensureAppAllowed("com.evil.App")).toThrow(
      "Interaction with disallowed app: com.evil.App"
    );
  });

  it("ensureAppAllowed rejects everything when allowedApps is empty/omitted", () => {
    const policy = createRunPolicy(policyDriver(), base);
    expect(() => policy.ensureAppAllowed("com.example.App")).toThrow(
      "Interaction with disallowed app: com.example.App"
    );
  });

  it("ensureLocationAllowed enforces allowed domains on a navigating (web) driver", () => {
    const policy = createRunPolicy(policyDriver(), { ...base, allowedDomains: ["example.com"] });
    const webDriver = driverWithCapabilities(["navigate"], () => "https://evil.test/x");
    expect(() => policy.ensureLocationAllowed(webDriver)).toThrow(
      "Navigation to disallowed domain: evil.test"
    );
  });

  it("ensureLocationAllowed is a no-op for a driver without navigate (macOS) and never reads the URL", () => {
    const policy = createRunPolicy(policyDriver(), base);
    const macDriver = driverWithCapabilities(["query", "interact"], () => {
      throw new Error("currentUrl should not be called");
    });
    expect(() => policy.ensureLocationAllowed(macDriver)).not.toThrow();
  });
});
