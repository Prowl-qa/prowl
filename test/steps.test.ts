import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "yaml";
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

  it("redacts type shorthand value when marked sensitive", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-steps-"));
    const steps: Step[] = [{ type: "super-secret" }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      redactedFillSteps: new Set([0]),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    expect(result.results[0].value).toBe("[REDACTED]");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("fails type shorthand when :focus selector is forbidden", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-steps-"));
    const steps: Step[] = [{ type: "Hello world" }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [":focus"],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].error).toContain("Forbidden selector");
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

  it("fails click shorthand when derived role selector is forbidden", async () => {
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
      forbiddenSelectors: ["role=button"],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].error).toContain("Forbidden selector");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("fails click shorthand with escaped role selector for quoted text", async () => {
    const text = 'Sign "In" \\ Now';
    const page = createMockPage({
      roleCounts: { [`button:${text}`]: 1 }
    });
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-steps-"));
    const steps: Step[] = [{ click: text }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: ['role=button[name="Sign \\"In\\" \\\\ Now"]'],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].error).toContain("Forbidden selector");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("fails fill shorthand when derived placeholder selector is forbidden", async () => {
    const page = createMockPage({
      labelCounts: { Email: 0 }
    });
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-steps-"));
    const steps: Step[] = [{ fill: { Email: "user@test.com" } }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: ['input[placeholder="Email"]'],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].error).toContain("Forbidden selector");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("fails fill shorthand with escaped label selector for quoted label", async () => {
    const label = 'E"mail \\ Box';
    const page = createMockPage({
      labelCounts: { [label]: 1 }
    });
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-steps-"));
    const steps: Step[] = [{ fill: { [label]: "user@test.com" } }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: ['label="E\\"mail \\\\ Box"'],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].error).toContain("Forbidden selector");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("fails select shorthand when derived aria-label selector is forbidden", async () => {
    const page = createMockPage({
      labelCounts: { State: 0 }
    });
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-steps-"));
    const steps: Step[] = [{ select: { State: "FL" } }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: ['select[aria-label="State"]'],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].error).toContain("Forbidden selector");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("fails select shorthand with escaped label selector for quoted label", async () => {
    const label = 'Sta"te \\ Name';
    const page = createMockPage({
      labelCounts: { [label]: 1 }
    });
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-steps-"));
    const steps: Step[] = [{ select: { [label]: "FL" } }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: ['label="Sta\\"te \\\\ Name"'],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].error).toContain("Forbidden selector");
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

  it("fails explicit waitForSelector when selector is forbidden", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-steps-"));
    const steps: Step[] = [{ waitForSelector: { selector: "[data-danger]" } }];

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
    expect(result.results[0].error).toContain("Forbidden selector");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("fails wait shorthand when derived text selector is forbidden", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-steps-"));
    const steps: Step[] = [{ wait: "Welcome" }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: ['text="Welcome"'],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].error).toContain("Forbidden selector");
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

  it("fails inline assert when derived text selector is forbidden", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-steps-"));
    const steps: Step[] = [{ assert: { visible: "Welcome back" } }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: ['text="Welcome back"'],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].error).toContain("Forbidden selector");
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

  it("executes runHunt step and merges sub-hunt results", async () => {
    const page = createMockPage();
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-runhunt-"));
    const huntsDir = path.join(configDir, "hunts");
    fs.mkdirSync(huntsDir, { recursive: true });
    const runDir = path.join(configDir, "runs", "test");
    fs.mkdirSync(runDir, { recursive: true });

    const subHunt = { steps: [{ navigate: "/sub" }] };
    fs.writeFileSync(path.join(huntsDir, "login.yml"), yaml.stringify(subHunt));

    const steps: Step[] = [
      { navigate: "/" },
      { runHunt: "login" }
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
      configDir,
      huntStack: ["parent"]
    });

    expect(result.failed).toBe(false);
    const subStep = result.results.find((r) => r.type === "login > navigate");
    expect(subStep).toBeDefined();
    expect(subStep?.status).toBe("pass");
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it("detects circular hunt dependency", async () => {
    const page = createMockPage();
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-circular-"));
    const huntsDir = path.join(configDir, "hunts");
    fs.mkdirSync(huntsDir, { recursive: true });
    const runDir = path.join(configDir, "runs", "test");
    fs.mkdirSync(runDir, { recursive: true });

    const selfHunt = { steps: [{ navigate: "/" }] };
    fs.writeFileSync(path.join(huntsDir, "self.yml"), yaml.stringify(selfHunt));

    const steps: Step[] = [{ runHunt: "self" }];

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
      configDir,
      huntStack: ["self"]
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].error).toContain("Circular hunt dependency");
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it("executes runHunt with variable overrides", async () => {
    const page = createMockPage();
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-runhunt-vars-"));
    const huntsDir = path.join(configDir, "hunts");
    fs.mkdirSync(huntsDir, { recursive: true });
    const runDir = path.join(configDir, "runs", "test");
    fs.mkdirSync(runDir, { recursive: true });

    const subHunt = {
      vars: { EMAIL: "default@test.com" },
      steps: [{ fill: { selector: "#email", value: "{{EMAIL}}" } }]
    };
    fs.writeFileSync(path.join(huntsDir, "login.yml"), yaml.stringify(subHunt));

    const steps: Step[] = [
      { runHunt: { name: "login", vars: { EMAIL: "admin@test.com" } } }
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
      configDir,
      huntStack: []
    });

    expect(result.failed).toBe(false);
    const fillStep = result.results.find((r) => r.type === "login > fill");
    expect(fillStep).toBeDefined();
    expect(fillStep?.status).toBe("pass");
    fs.rmSync(configDir, { recursive: true, force: true });
  });
});
