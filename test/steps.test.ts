import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { executeSteps } from "../src/runner/steps.js";
import type { Page } from "playwright";
import type { Step } from "../src/types/index.js";

function createMockPage(options?: {
  roleCounts?: Record<string, number>;
  labelCounts?: Record<string, number>;
  locatorCounts?: Record<string, number>;
}) {
  let currentUrl = "http://localhost";
  const createLocator = (count: number) => {
    const locator = {
      count: vi.fn(async () => count),
      first: vi.fn(() => locator),
      click: vi.fn(async () => undefined),
      fill: vi.fn(async () => undefined),
      press: vi.fn(async () => undefined),
      selectOption: vi.fn(async () => undefined),
      setInputFiles: vi.fn(async () => undefined)
    };
    return locator;
  };

  return {
    goto: vi.fn(async (url: string) => {
      currentUrl = url;
    }),
    url: () => currentUrl,
    locator: vi.fn((selector: string) => createLocator(options?.locatorCounts?.[selector] ?? 1)),
    getByRole: vi.fn((role: string, params?: { name?: string }) =>
      createLocator(options?.roleCounts?.[`${role}:${String(params?.name ?? "")}`] ?? 1)
    ),
    getByLabel: vi.fn((label: string) => createLocator(options?.labelCounts?.[label] ?? 1)),
    once: vi.fn(),
    waitForSelector: vi.fn(async () => undefined),
    waitForURL: vi.fn(async () => undefined),
    waitForLoadState: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => undefined)
  };
}

describe("executeSteps", () => {
  it("executes steps and returns pass", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-steps-"));
    const steps: Step[] = [
      { navigate: "/" },
      { click: { selector: "button" } }
    ];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    expect(result.results).toHaveLength(2);
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("fails on forbidden selector", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-steps-"));
    const steps: Step[] = [{ click: { selector: "[data-danger]" } }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: ["[data-danger]"],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].status).toBe("fail");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("registers dialog handler for onDialog step", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-steps-"));
    const steps: Step[] = [{ onDialog: { action: "accept" } }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    expect(result.results[0].type).toBe("onDialog");
    expect(result.results[0].value).toBe("accept");
    expect(page.once).toHaveBeenCalledWith("dialog", expect.any(Function));
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("uses click shorthand with role=button first", async () => {
    const page = createMockPage({
      roleCounts: { "button:Sign In": 1 }
    });
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-steps-"));
    const steps: Step[] = [{ click: "Sign In" }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    expect(page.getByRole).toHaveBeenCalledWith("button", { name: "Sign In" });
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("falls back to text selector for click shorthand when no button matches", async () => {
    const page = createMockPage({
      roleCounts: { "button:Sign In": 0 },
      locatorCounts: { 'text="Sign In"': 1 }
    });
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-steps-"));
    const steps: Step[] = [{ click: "Sign In" }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    expect(page.locator).toHaveBeenCalledWith('text="Sign In"');
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("uses fill shorthand with label-first matching", async () => {
    const page = createMockPage({
      labelCounts: { Email: 1 }
    });
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-steps-"));
    const steps: Step[] = [{ fill: { Email: "user@test.com" } }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    expect(page.getByLabel).toHaveBeenCalledWith("Email", { exact: true });
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("falls back to placeholder for fill shorthand when label is missing", async () => {
    const placeholder = 'input[placeholder="Email"], textarea[placeholder="Email"]';
    const page = createMockPage({
      labelCounts: { Email: 0 },
      locatorCounts: { [placeholder]: 1 }
    });
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-steps-"));
    const steps: Step[] = [{ fill: { Email: "user@test.com" } }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    expect(page.locator).toHaveBeenCalledWith(placeholder);
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("supports type shorthand by filling focused element", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-steps-"));
    const steps: Step[] = [{ type: "Hello world" }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    expect(page.locator).toHaveBeenCalledWith(":focus");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("executes selectOption step", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-steps-"));
    const steps: Step[] = [
      {
        selectOption: {
          selector: "[data-testid=country-select]",
          value: "US"
        }
      }
    ];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    expect(result.results[0].type).toBe("selectOption");
    expect(result.results[0].selector).toBe("[data-testid=country-select]");
    expect(result.results[0].value).toBe("US");
    expect(page.locator).toHaveBeenCalledWith("[data-testid=country-select]");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("uses select shorthand with label-first matching", async () => {
    const page = createMockPage({
      labelCounts: { State: 1 }
    });
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-steps-"));
    const steps: Step[] = [{ select: { State: "FL" } }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    expect(page.getByLabel).toHaveBeenCalledWith("State", { exact: true });
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("uses wait shorthand with text selector", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-steps-"));
    const steps: Step[] = [{ wait: "Welcome" }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    expect(page.waitForSelector).toHaveBeenCalledWith('text="Welcome"', { timeout: undefined });
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("fails inline assert visible when text is missing", async () => {
    const page = createMockPage({
      locatorCounts: { 'text="Welcome back"': 0 }
    });
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-steps-"));
    const steps: Step[] = [{ assert: { visible: "Welcome back" } }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].type).toBe("assert");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("fails selectOption on forbidden selector", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-steps-"));
    const steps: Step[] = [{ selectOption: { selector: "[data-danger]", value: "US" } }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: ["[data-danger]"],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].status).toBe("fail");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("executes setInputFiles step", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-steps-"));
    const steps: Step[] = [
      {
        setInputFiles: {
          selector: "[data-testid=avatar-file]",
          files: "fixtures/avatar.png"
        }
      }
    ];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    expect(result.results[0].type).toBe("setInputFiles");
    expect(result.results[0].selector).toBe("[data-testid=avatar-file]");
    expect(page.locator).toHaveBeenCalledWith("[data-testid=avatar-file]");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("fails setInputFiles on forbidden selector", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-steps-"));
    const steps: Step[] = [
      { setInputFiles: { selector: "[data-danger]", files: "file.png" } }
    ];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: ["[data-danger]"],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].status).toBe("fail");
    fs.rmSync(runDir, { recursive: true, force: true });
  });
});
