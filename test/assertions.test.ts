import { describe, expect, it } from "vitest";
import { evaluateAssertions } from "../src/runner/assertions.js";
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
