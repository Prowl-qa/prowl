import { describe, expect, it } from "vitest";
import { evaluateAssertions, evaluateNativeAssertions } from "../src/runner/assertions.js";
import type { Page } from "playwright";
import type { Config } from "../src/types/index.js";

const baseConfig: Config = {
  target: { url: "http://example.com" },
  browser: { headless: true, slowMo: 0, timeout: 30000 },
  artifacts: { screenshots: "on-failure", networkHar: false, console: true },
  assertions: {
    noConsoleErrors: true,
    noNetworkErrors: true,
    maxTotalTimeMs: 30000,
    networkIgnorePatterns: []
  },
  guardrails: { maxSteps: 50, allowedDomains: ["example.com"], forbiddenSelectors: [] },
  auth: { storageStatePath: ".prowl/auth-state.json" }
};

function createMockPage() {
  return {
    url: () => "http://example.com/dashboard",
    locator: (selector: string) => ({
      count: async () => (selector === "h1" ? 1 : 0)
    })
  };
}

describe("evaluateAssertions", () => {
  it("evaluates selector and url assertions", async () => {
    const page = createMockPage();
    const results = await evaluateAssertions({
      page: page as unknown as Page,
      config: baseConfig,
      huntAssertions: [{ selectorExists: "h1" }, { urlIncludes: "/dashboard" }],
      consoleEntries: [],
      networkEntries: []
    });

    const selector = results.find((result) => result.type === "selectorExists");
    const url = results.find((result) => result.type === "urlIncludes");

    expect(selector?.status).toBe("pass");
    expect(url?.status).toBe("pass");
  });

  it("honors hunt disabling noConsoleErrors", async () => {
    const page = createMockPage();
    const results = await evaluateAssertions({
      page: page as unknown as Page,
      config: baseConfig,
      huntAssertions: [{ noConsoleErrors: false }],
      consoleEntries: [{ type: "error", text: "boom" }],
      networkEntries: []
    });

    const noConsole = results.find((result) => result.type === "noConsoleErrors");
    expect(noConsole).toBeUndefined();
  });

  it("ignores network errors matching patterns", async () => {
    const page = createMockPage();
    const config = {
      ...baseConfig,
      assertions: {
        ...baseConfig.assertions,
        networkIgnorePatterns: ["analytics"]
      }
    };

    const results = await evaluateAssertions({
      page: page as unknown as Page,
      config,
      huntAssertions: [{ noNetworkErrors: true }],
      consoleEntries: [],
      networkEntries: [
        { url: "https://analytics.example.com/track", status: 500 },
        { url: "https://api.example.com/boom", status: 500 }
      ]
    });

    const noNetwork = results.find((result) => result.type === "noNetworkErrors");
    expect(noNetwork?.status).toBe("fail");
  });
});

describe("evaluateNativeAssertions (PROWL-050 / ARCH-004)", () => {
  // A native driver's minimal surface: selectorExists/NotExists resolve via count.
  const driver = (counts: Record<string, number>) => ({
    count: async (selector: string) => counts[selector] ?? 0
  });

  it("runs applicable selector assertions against the driver", async () => {
    const { results } = await evaluateNativeAssertions({
      driver: driver({ Saved: 1, Gone: 0 }),
      config: baseConfig,
      huntAssertions: [{ selectorExists: "Saved" }, { selectorNotExists: "Gone" }],
      targetLabel: "macOS"
    });

    expect(results.find((r) => r.type === "selectorExists")).toMatchObject({
      status: "pass",
      value: "Saved"
    });
    expect(results.find((r) => r.type === "selectorNotExists")).toMatchObject({
      status: "pass",
      value: "Gone"
    });
  });

  it("fails an applicable assertion that does not hold", async () => {
    const { results } = await evaluateNativeAssertions({
      driver: driver({ Saved: 0 }),
      config: baseConfig,
      huntAssertions: [{ selectorExists: "Saved" }],
      targetLabel: "macOS"
    });
    expect(results.find((r) => r.type === "selectorExists")?.status).toBe("fail");
  });

  it("marks hunt-authored web-only assertions skipped and warns for them", async () => {
    const { results, warnings } = await evaluateNativeAssertions({
      driver: driver({}),
      config: baseConfig,
      huntAssertions: [{ urlIncludes: "/home" }],
      targetLabel: "iOS"
    });

    const url = results.find((r) => r.type === "urlIncludes");
    expect(url?.status).toBe("skipped");
    expect(url?.error).toContain("web-only");
    expect(url?.value).toBe("/home");
    expect(warnings).toContain("urlIncludes is web-only; skipped on iOS target");
  });

  it("surfaces config-default console/network checks as skipped WITHOUT warning", async () => {
    // noConsoleErrors/noNetworkErrors default to true in config; on a native
    // target they must be visible (skipped) but must not spam a warning on every
    // run since the hunt did not author them.
    const { results, warnings } = await evaluateNativeAssertions({
      driver: driver({}),
      config: baseConfig,
      huntAssertions: [],
      targetLabel: "Android"
    });

    expect(results.find((r) => r.type === "noConsoleErrors")?.status).toBe("skipped");
    expect(results.find((r) => r.type === "noNetworkErrors")?.status).toBe("skipped");
    expect(warnings).toHaveLength(0);
  });

  it("warns for a hunt-authored noConsoleErrors even though it is a config key", async () => {
    const { results, warnings } = await evaluateNativeAssertions({
      driver: driver({}),
      config: baseConfig,
      huntAssertions: [{ noConsoleErrors: true }],
      targetLabel: "macOS"
    });
    expect(results.find((r) => r.type === "noConsoleErrors")?.status).toBe("skipped");
    expect(warnings).toContain("noConsoleErrors is web-only; skipped on macOS target");
  });
});
