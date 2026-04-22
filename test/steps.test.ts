import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "yaml";
import { describe, expect, it, vi } from "vitest";
import { executeSteps } from "../src/runner/steps.js";
import { interpolateHunt } from "../src/config/interpolate.js";
import type { Page } from "playwright";
import type { Step } from "../src/types/index.js";

function createMockPage(options?: {
  roleCounts?: Record<string, number>;
  labelCounts?: Record<string, number>;
  locatorCounts?: Record<string, number>;
  textContents?: Record<string, string | null>;
  waitForEventResult?: unknown;
}) {
  let currentUrl = "http://localhost";
  const locators = new Map<string, { click: ReturnType<typeof vi.fn> }>();
  const createLocator = (count: number, selector?: string) => {
    const locator = {
      count: vi.fn(async () => count),
      first: vi.fn(() => locator),
      click: vi.fn(async () => undefined),
      fill: vi.fn(async () => undefined),
      press: vi.fn(async () => undefined),
      selectOption: vi.fn(async () => undefined),
      setInputFiles: vi.fn(async () => undefined),
      hover: vi.fn(async () => undefined),
      scrollIntoViewIfNeeded: vi.fn(async () => undefined),
      textContent: vi.fn(async () =>
        selector && options?.textContents?.[selector] !== undefined
          ? options.textContents[selector]
          : "mock text"
      )
    };
    return locator;
  };

  return {
    goto: vi.fn(async (url: string) => {
      currentUrl = url;
    }),
    url: () => currentUrl,
    locator: vi.fn((selector: string) => {
      const locator = createLocator(options?.locatorCounts?.[selector] ?? 1, selector);
      locators.set(selector, locator);
      return locator;
    }),
    getByRole: vi.fn((role: string, params?: { name?: string }) =>
      createLocator(options?.roleCounts?.[`${role}:${String(params?.name ?? "")}`] ?? 1)
    ),
    getByLabel: vi.fn((label: string) => createLocator(options?.labelCounts?.[label] ?? 1)),
    once: vi.fn(),
    waitForSelector: vi.fn(async () => undefined),
    waitForURL: vi.fn(async () => undefined),
    waitForLoadState: vi.fn(async () => undefined),
    waitForEvent: vi.fn(async () => options?.waitForEventResult ?? undefined),
    evaluate: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => undefined),
    __locators: locators
  };
}

describe("executeSteps", () => {
  it("executes steps and returns pass", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
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
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    expect(result.results).toHaveLength(2);
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("fails on forbidden selector", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
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
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].status).toBe("fail");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("registers dialog handler for onDialog step", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
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
      maxSteps: 50,
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
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
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
      maxSteps: 50,
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
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
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
      maxSteps: 50,
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
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
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
      maxSteps: 50,
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
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
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
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    expect(page.locator).toHaveBeenCalledWith(placeholder);
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("supports type shorthand by filling focused element", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
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
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    expect(page.locator).toHaveBeenCalledWith(":focus");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("redacts type shorthand value when marked sensitive", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
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
      maxSteps: 50,
      redactedFillSteps: new Set(["0"]),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    expect(result.results[0].value).toBe("[REDACTED]");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("fails type shorthand when :focus selector is forbidden", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
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
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].error).toContain("Forbidden selector");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("executes selectOption step", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
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
      maxSteps: 50,
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
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
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
      maxSteps: 50,
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
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
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
      maxSteps: 50,
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
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
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
      maxSteps: 50,
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
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
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
      maxSteps: 50,
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
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
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
      maxSteps: 50,
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
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
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
      maxSteps: 50,
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
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
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
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].error).toContain("Forbidden selector");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("uses wait shorthand with text selector", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
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
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    expect(page.waitForSelector).toHaveBeenCalledWith("text=Welcome", { timeout: undefined });
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("fails explicit waitForSelector when selector is forbidden", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
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
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].error).toContain("Forbidden selector");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("fails wait shorthand when derived text selector is forbidden", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps: Step[] = [{ wait: "Welcome" }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: ["text=Welcome"],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].error).toContain("Forbidden selector");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("fails inline assert visible when text is missing", async () => {
    const page = createMockPage({
      locatorCounts: { "text=Welcome back": 0 }
    });
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
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
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].type).toBe("assert");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("fails inline assert when derived text selector is forbidden", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps: Step[] = [{ assert: { visible: "Welcome back" } }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: ["text=Welcome back"],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].error).toContain("Forbidden selector");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("fails selectOption on forbidden selector", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
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
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].status).toBe("fail");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("executes setInputFiles step", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
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
      maxSteps: 50,
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
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
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
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].status).toBe("fail");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("executes runHunt step and merges sub-hunt results", async () => {
    const page = createMockPage();
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-runhunt-"));
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
      maxSteps: 50,
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
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-circular-"));
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
      maxSteps: 50,
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
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-runhunt-vars-"));
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
      maxSteps: 50,
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

  it("reuses RANDOM vars across parent and nested hunts", async () => {
    const page = createMockPage();
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-runhunt-random-"));
    const huntsDir = path.join(configDir, "hunts");
    fs.mkdirSync(huntsDir, { recursive: true });
    const runDir = path.join(configDir, "runs", "test");
    fs.mkdirSync(runDir, { recursive: true });

    const subHunt = { steps: [{ navigate: "/{{RANDOM_TEXT}}" }] };
    fs.writeFileSync(path.join(huntsDir, "login.yml"), yaml.stringify(subHunt));

    const randomVars = {
      RANDOM_EMAIL: "prowl_fixed@test.com",
      RANDOM_NAME: "Alex Smith",
      RANDOM_NUMBER: "1234",
      RANDOM_UUID: "11111111-1111-1111-1111-111111111111",
      RANDOM_TEXT: "shared123"
    };
    const parentHunt = {
      steps: [
        { navigate: "/{{RANDOM_TEXT}}" },
        { runHunt: "login" }
      ]
    };
    const { hunt: interpolatedParent, redactedFillSteps } = interpolateHunt(
      parentHunt,
      {},
      randomVars
    );

    const result = await executeSteps({
      page: page as unknown as Page,
      steps: interpolatedParent.steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps,
      configDir,
      huntStack: ["parent"],
      randomVars
    });

    expect(result.failed).toBe(false);
    expect(page.goto.mock.calls[0]?.[0]).toBe("http://localhost/shared123");
    expect(page.goto.mock.calls[1]?.[0]).toBe("http://localhost/shared123");
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it("shares generated RANDOM vars across sibling runHunt steps", async () => {
    const page = createMockPage();
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-runhunt-siblings-"));
    const huntsDir = path.join(configDir, "hunts");
    fs.mkdirSync(huntsDir, { recursive: true });
    const runDir = path.join(configDir, "runs", "test");
    fs.mkdirSync(runDir, { recursive: true });

    const subHunt = { steps: [{ navigate: "/{{RANDOM_TEXT}}" }] };
    fs.writeFileSync(path.join(huntsDir, "first.yml"), yaml.stringify(subHunt));
    fs.writeFileSync(path.join(huntsDir, "second.yml"), yaml.stringify(subHunt));

    const randomSpy = vi
      .spyOn(Math, "random")
      .mockImplementationOnce(() => 0)
      .mockImplementationOnce(() => 0)
      .mockImplementationOnce(() => 0)
      .mockImplementationOnce(() => 0)
      .mockImplementationOnce(() => 0)
      .mockImplementationOnce(() => 0)
      .mockImplementationOnce(() => 0)
      .mockImplementationOnce(() => 0)
      .mockImplementationOnce(() => 0)
      .mockImplementationOnce(() => 0)
      .mockImplementationOnce(() => 0)
      .mockImplementation(() => 0.5);
    const randomBytesSpy = vi
      .spyOn(crypto, "randomBytes")
      .mockReturnValueOnce(Buffer.from("12345678", "hex"))
      .mockReturnValue(Buffer.from("87654321", "hex"));
    const randomUuidSpy = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("11111111-1111-1111-1111-111111111111")
      .mockReturnValue("22222222-2222-2222-2222-222222222222");

    const context = {
      page: page as unknown as Page,
      steps: [{ runHunt: "first" }, { runHunt: "second" }],
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure" as const,
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set<string>(),
      configDir,
      huntStack: ["parent"]
    };

    try {
      const result = await executeSteps(context);

      expect(result.failed).toBe(false);
      expect(page.goto.mock.calls[0]?.[0]).toBe("http://localhost/aaaaaaaa");
      expect(page.goto.mock.calls[1]?.[0]).toBe("http://localhost/aaaaaaaa");
      expect(context.randomVars?.RANDOM_TEXT).toBe("aaaaaaaa");
      expect(randomBytesSpy).toHaveBeenCalledTimes(1);
      expect(randomUuidSpy).toHaveBeenCalledTimes(1);
    } finally {
      randomSpy.mockRestore();
      randomBytesSpy.mockRestore();
      randomUuidSpy.mockRestore();
      fs.rmSync(configDir, { recursive: true, force: true });
    }
  });

  it("executes hover step", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps: Step[] = [{ hover: { selector: "[data-testid=menu-item]" } }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    expect(result.results[0].type).toBe("hover");
    expect(result.results[0].selector).toBe("[data-testid=menu-item]");
    expect(page.locator).toHaveBeenCalledWith("[data-testid=menu-item]");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("fails hover on forbidden selector", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps: Step[] = [{ hover: { selector: "[data-danger]" } }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: ["[data-danger]"],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].error).toContain("Forbidden selector");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("executes scroll step", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps: Step[] = [{ scroll: { direction: "down", amount: 300 } }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    expect(result.results[0].type).toBe("scroll");
    expect(result.results[0].value).toBe("down 300px");
    expect(page.evaluate).toHaveBeenCalled();
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("executes scrollTo step", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps: Step[] = [{ scrollTo: { selector: "#footer" } }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    expect(result.results[0].type).toBe("scrollTo");
    expect(result.results[0].selector).toBe("#footer");
    expect(page.locator).toHaveBeenCalledWith("#footer");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("fails scrollTo on forbidden selector", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps: Step[] = [{ scrollTo: { selector: "[data-danger]" } }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: ["[data-danger]"],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].error).toContain("Forbidden selector");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("rejects screenshot name with path traversal", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps: Step[] = [{ screenshot: { name: "../../etc/passwd" } }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].error).toContain("Invalid screenshot name");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("rejects screenshot name with path separator", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps: Step[] = [{ screenshot: { name: "sub/dir" } }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].error).toContain("Invalid screenshot name");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("executes if step when condition is met", async () => {
    const page = createMockPage({
      locatorCounts: { ".cookie-banner": 1 }
    });
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps = [
      {
        if: {
          visible: ".cookie-banner",
          then: [{ navigate: "/accept" }]
        }
      }
    ] as Step[];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    const ifSubStep = result.results.find((r) => r.type === "if > navigate");
    expect(ifSubStep).toBeDefined();
    expect(ifSubStep?.status).toBe("pass");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("skips if step when condition is not met", async () => {
    const page = createMockPage({
      locatorCounts: { ".cookie-banner": 0 }
    });
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps = [
      {
        if: {
          visible: ".cookie-banner",
          then: [{ navigate: "/accept" }]
        }
      }
    ] as Step[];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].type).toBe("if");
    expect(result.results[0].value).toBe("condition not met, skipped");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("executes if else steps when condition is not met", async () => {
    const page = createMockPage({
      locatorCounts: { ".cookie-banner": 0 }
    });
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps = [
      {
        if: {
          visible: ".cookie-banner",
          then: [{ navigate: "/accept" }],
          else: [{ navigate: "/fallback" }]
        }
      }
    ] as Step[];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    const ifSubStep = result.results.find((r) => r.type === "if > navigate");
    expect(ifSubStep).toBeDefined();
    expect(result.results[result.results.length - 1].value).toBe("condition not met, executed 1 else steps");
    expect(page.goto).toHaveBeenCalledWith("http://localhost/fallback");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("propagates sub-step failure from if step", async () => {
    const page = createMockPage({
      locatorCounts: { ".banner": 1, ".missing": 0 }
    });
    // Make page.goto throw for the sub-step
    page.goto.mockRejectedValueOnce(new Error("Navigation failed"));
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps = [
      {
        if: {
          visible: ".banner",
          then: [{ navigate: "/bad" }]
        }
      }
    ] as Step[];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("executes if step with notVisible condition when element is absent", async () => {
    const page = createMockPage({
      locatorCounts: { ".welcome-modal": 0 }
    });
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps = [
      {
        if: {
          notVisible: ".welcome-modal",
          then: [{ navigate: "/onboarding" }]
        }
      }
    ] as Step[];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    const ifSubStep = result.results.find((r) => r.type === "if > navigate");
    expect(ifSubStep).toBeDefined();
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("fails if step when condition selector is forbidden", async () => {
    const page = createMockPage({
      locatorCounts: { ".danger-banner": 1 }
    });
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps = [
      {
        if: {
          visible: ".danger-banner",
          then: [{ navigate: "/safe" }]
        }
      }
    ] as Step[];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [".danger-banner"],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].error).toContain("Forbidden selector");
    fs.rmSync(runDir, { recursive: true, force: true });
  });


  it("redacts sensitive type values inside if sub-steps", async () => {
    const page = createMockPage({
      locatorCounts: { ".cookie-banner": 1 }
    });
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps = [
      {
        if: {
          visible: ".cookie-banner",
          then: [{ type: "nested-secret" }]
        }
      }
    ] as Step[];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(["0.if.then.0"]),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    const nestedType = result.results.find((r) => r.type === "if > type");
    expect(nestedType?.value).toBe("[REDACTED]");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("redacts sensitive type values inside if else sub-steps", async () => {
    const page = createMockPage({
      locatorCounts: { ".cookie-banner": 0 }
    });
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps = [
      {
        if: {
          visible: ".cookie-banner",
          then: [{ navigate: "/accept" }],
          else: [{ type: "nested-secret" }]
        }
      }
    ] as Step[];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(["0.if.else.0"]),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    const nestedType = result.results.find((r) => r.type === "if > type");
    expect(nestedType?.value).toBe("[REDACTED]");
    fs.rmSync(runDir, { recursive: true, force: true });
  });


  it("executes repeat step with fixed count", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps = [
      {
        repeat: {
          times: 3,
          steps: [{ navigate: "/page" }]
        }
      }
    ] as Step[];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    const repeatSteps = result.results.filter((r) => r.type.startsWith("repeat["));
    expect(repeatSteps).toHaveLength(3);
    expect(repeatSteps[0].type).toBe("repeat[0] > navigate");
    expect(repeatSteps[1].type).toBe("repeat[1] > navigate");
    expect(repeatSteps[2].type).toBe("repeat[2] > navigate");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("executes repeat step with while condition", async () => {
    let callCount = 0;
    const page = createMockPage();
    // Override locator to return decreasing counts
    page.locator.mockImplementation(() => ({
      count: vi.fn(async () => {
        callCount++;
        return callCount <= 2 ? 1 : 0;
      }),
      first: vi.fn().mockReturnThis(),
      click: vi.fn(async () => undefined),
      fill: vi.fn(async () => undefined),
      press: vi.fn(async () => undefined),
      selectOption: vi.fn(async () => undefined),
      setInputFiles: vi.fn(async () => undefined),
      hover: vi.fn(async () => undefined),
      scrollIntoViewIfNeeded: vi.fn(async () => undefined)
    }));
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps = [
      {
        repeat: {
          while: { visible: ".load-more" },
          maxIterations: 10,
          steps: [{ navigate: "/next" }]
        }
      }
    ] as Step[];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    const repeatSteps = result.results.filter((r) => r.type.startsWith("repeat["));
    expect(repeatSteps).toHaveLength(2);
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("repeat stops immediately when while condition is false initially", async () => {
    const page = createMockPage({
      locatorCounts: { ".load-more": 0 }
    });
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps = [
      {
        repeat: {
          while: { visible: ".load-more" },
          maxIterations: 10,
          steps: [{ navigate: "/next" }]
        }
      }
    ] as Step[];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    const repeatSteps = result.results.filter((r) => r.type.startsWith("repeat["));
    expect(repeatSteps).toHaveLength(0);
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("fails repeat while when condition selector is forbidden", async () => {
    const page = createMockPage({
      locatorCounts: { ".danger-load-more": 1 }
    });
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps = [
      {
        repeat: {
          while: { visible: ".danger-load-more" },
          maxIterations: 3,
          steps: [{ navigate: "/next" }]
        }
      }
    ] as Step[];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [".danger-load-more"],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].error).toContain("Forbidden selector");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("repeat enforces maxSteps guardrail", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps = [
      {
        repeat: {
          times: 10,
          steps: [{ navigate: "/page" }]
        }
      }
    ] as Step[];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 3,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    expect(result.error).toContain("maxSteps");
    const repeatSubSteps = result.results.filter((r) => r.type.startsWith("repeat["));
    expect(repeatSubSteps).toHaveLength(0);
    expect(page.goto).not.toHaveBeenCalled();
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("repeat sub-step failure stops iteration", async () => {
    const page = createMockPage();
    page.goto
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Navigation failed"));
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps = [
      {
        repeat: {
          times: 5,
          steps: [{ navigate: "/page" }]
        }
      }
    ] as Step[];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    const repeatSteps = result.results.filter((r) => r.type.startsWith("repeat["));
    expect(repeatSteps.length).toBeLessThan(5);
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("redacts sensitive fill values inside repeat sub-steps", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps = [
      {
        repeat: {
          times: 2,
          steps: [{ fill: { selector: "#password", value: "nested-secret" } }]
        }
      }
    ] as Step[];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(["0.repeat.steps.0"]),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    const nestedFill = result.results.filter((r) => r.type.startsWith("repeat[") && r.type.endsWith("fill"));
    expect(nestedFill).toHaveLength(2);
    expect(nestedFill[0].value).toBe("[REDACTED]");
    expect(nestedFill[1].value).toBe("[REDACTED]");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("enforces maxTotalTimeMs across repeat iterations", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps = [
      {
        repeat: {
          times: 2,
          steps: [{ navigate: "/page" }]
        }
      }
    ] as Step[];

    const values = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    let cursor = 0;
    // Advance Date.now deterministically so timeout assertions are stable across runs.
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => {
      const value = values[cursor] ?? values[values.length - 1] + (cursor - values.length + 1);
      cursor += 1;
      return value;
    });

    try {
      const result = await executeSteps({
        page: page as unknown as Page,
        steps,
        targetUrl: "http://localhost",
        runDir,
        screenshotsMode: "on-failure",
        forbiddenSelectors: [],
        allowedDomains: ["localhost"],
        maxTotalTimeMs: 5,
        maxSteps: 50,
        redactedFillSteps: new Set(),
        configDir: runDir
      });

      expect(result.failed).toBe(true);
      expect(result.error).toContain("Max total time exceeded");
      expect(result.results.some((r) => r.type.includes("timeout"))).toBe(true);
    } finally {
      nowSpy.mockRestore();
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });

  it("executes mockRoute step", async () => {
    const page = createMockPage();
    page.route = vi.fn(async () => undefined);
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps = [
      {
        mockRoute: {
          url: "**/api/users",
          response: { status: 200, body: '{"users": []}' }
        }
      }
    ] as Step[];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    expect(result.results[0].type).toBe("mockRoute");
    expect(result.results[0].value).toBe("**/api/users");
    expect(page.route).toHaveBeenCalledWith("**/api/users", expect.any(Function));
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("executes unmockRoute step after mockRoute", async () => {
    const page = createMockPage();
    page.route = vi.fn(async () => undefined);
    page.unroute = vi.fn(async () => undefined);
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps = [
      {
        mockRoute: {
          url: "**/api/users",
          response: { status: 200, body: '{"users": []}' }
        }
      },
      { unmockRoute: { url: "**/api/users" } }
    ] as Step[];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    expect(result.results[1].type).toBe("unmockRoute");
    expect(page.unroute).toHaveBeenCalledWith("**/api/users");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("fails unmockRoute when no active mock exists", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps = [
      { unmockRoute: { url: "**/api/users" } }
    ] as Step[];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].error).toContain("No active mock");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("executes unmockRoute string shorthand after mockRoute", async () => {
    const page = createMockPage();
    page.route = vi.fn(async () => undefined);
    page.unroute = vi.fn(async () => undefined);
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps = [
      {
        mockRoute: {
          url: "**/api/users",
          response: { status: 200, body: '{"users": []}' }
        }
      },
      { unmockRoute: "**/api/users" }
    ] as Step[];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    expect(result.results[1].type).toBe("unmockRoute");
    expect(page.unroute).toHaveBeenCalledWith("**/api/users");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("assert visible accepts CSS selectors", async () => {
    const page = createMockPage({
      locatorCounts: { "img[alt='Logo']": 1 }
    });
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps: Step[] = [{ assert: { visible: "img[alt='Logo']" } }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    expect(result.results[0].type).toBe("assert");
    expect(page.locator).toHaveBeenCalledWith("img[alt='Logo']");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("assert notVisible accepts CSS selectors", async () => {
    const page = createMockPage({
      locatorCounts: { ".error-banner": 0 }
    });
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps: Step[] = [{ assert: { notVisible: ".error-banner" } }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    expect(result.results[0].type).toBe("assert");
    expect(page.locator).toHaveBeenCalledWith(".error-banner");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("mockRoute reads file-based response from configDir", async () => {
    const page = createMockPage();
    page.route = vi.fn(async () => undefined);
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-mock-file-"));
    const runDir = path.join(configDir, "runs", "test");
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "fixtures.json"), '{"data": true}');

    const steps = [
      {
        mockRoute: {
          url: "**/api/data",
          response: { status: 200, file: "fixtures.json" }
        }
      }
    ] as Step[];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir
    });

    expect(result.failed).toBe(false);
    expect(page.route).toHaveBeenCalledWith("**/api/data", expect.any(Function));
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it("fails mockRoute when file path traverses outside configDir", async () => {
    const page = createMockPage();
    page.route = vi.fn(async () => undefined);
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-mock-traversal-"));
    const configDir = path.join(baseDir, "config");
    fs.mkdirSync(configDir, { recursive: true });
    const runDir = path.join(configDir, "runs", "test");
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(baseDir, "outside.json"), '{"data": true}');

    const steps = [
      {
        mockRoute: {
          url: "**/api/data",
          response: { status: 200, file: "../outside.json" }
        }
      }
    ] as Step[];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].error).toContain("must resolve within config directory");
    expect(page.route).not.toHaveBeenCalled();
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  it("fails mockRoute when absolute file path is outside configDir", async () => {
    const page = createMockPage();
    page.route = vi.fn(async () => undefined);
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-mock-abs-"));
    const configDir = path.join(baseDir, "config");
    fs.mkdirSync(configDir, { recursive: true });
    const runDir = path.join(configDir, "runs", "test");
    fs.mkdirSync(runDir, { recursive: true });
    const outsidePath = path.join(baseDir, "outside.json");
    fs.writeFileSync(outsidePath, '{"data": true}');

    const steps = [
      {
        mockRoute: {
          url: "**/api/data",
          response: { status: 200, file: outsidePath }
        }
      }
    ] as Step[];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].error).toContain("must resolve within config directory");
    expect(page.route).not.toHaveBeenCalled();
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  it("fails mockRoute with clear error when response body and file are both missing", async () => {
    const page = createMockPage();
    page.route = vi.fn(async () => undefined);
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-mock-missing-response-"));
    const steps = [
      {
        mockRoute: {
          url: "**/api/data",
          response: { status: 200 }
        }
      }
    ] as Step[];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].error).toContain("mock.response must include either body or file");
    expect(page.route).not.toHaveBeenCalled();
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("executes evalScript shorthand expression", async () => {
    const page = createMockPage();
    page.evaluate.mockResolvedValueOnce("My Page Title");
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps: Step[] = [{ evalScript: "document.title" }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    expect(result.results[0].type).toBe("evalScript");
    expect(result.results[0].value).toBe("My Page Title");
    expect(page.evaluate).toHaveBeenCalledWith("document.title");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("executes evalScript with as and stores runtime var", async () => {
    const page = createMockPage();
    page.evaluate.mockResolvedValueOnce(42);
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps: Step[] = [
      { evalScript: { expression: "document.querySelectorAll('tr').length", as: "ROW_COUNT" } }
    ];

    const context = {
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure" as const,
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set<string>(),
      configDir: runDir
    };

    const result = await executeSteps(context);

    expect(result.failed).toBe(false);
    expect(result.results[0].type).toBe("evalScript");
    expect(result.results[0].value).toBe("42");
    expect(context.runtimeVars?.get("ROW_COUNT")).toBe("42");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("runtime vars substitute in subsequent steps", async () => {
    const page = createMockPage();
    page.evaluate.mockResolvedValueOnce("Dashboard");
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps: Step[] = [
      { evalScript: { expression: "document.title", as: "TITLE" } },
      { assert: { visible: "{{TITLE}}" } }
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
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    expect(result.results[0].type).toBe("evalScript");
    expect(result.results[1].type).toBe("assert");
    // The assert step should have used "Dashboard" as the visible text (substring match)
    expect(page.locator).toHaveBeenCalledWith("text=Dashboard");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("executes runScript step by reading and evaluating file", async () => {
    const page = createMockPage();
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-runscript-"));
    const runDir = path.join(configDir, "runs", "test");
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "setup.js"), "window.testSetup = true;");

    const steps: Step[] = [{ runScript: { file: "setup.js" } }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir
    });

    expect(result.failed).toBe(false);
    expect(result.results[0].type).toBe("runScript");
    expect(result.results[0].value).toBe("setup.js");
    expect(page.evaluate).toHaveBeenCalledWith("window.testSetup = true;");
    fs.rmSync(configDir, { recursive: true, force: true });
  });


  it("fails runHunt when sub-hunt exceeds maxSteps", async () => {
    const page = createMockPage();
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-runhunt-maxsteps-"));
    const huntsDir = path.join(configDir, "hunts");
    fs.mkdirSync(huntsDir, { recursive: true });
    const runDir = path.join(configDir, "runs", "test");
    fs.mkdirSync(runDir, { recursive: true });

    const subHunt = {
      steps: [{ navigate: "/one" }, { navigate: "/two" }]
    };
    fs.writeFileSync(path.join(huntsDir, "oversized.yml"), yaml.stringify(subHunt));

    const result = await executeSteps({
      page: page as unknown as Page,
      steps: [{ runHunt: "oversized" }],
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 1,
      redactedFillSteps: new Set(),
      configDir,
      huntStack: ["parent"]
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].error).toContain("Max allowed is 1");
    fs.rmSync(configDir, { recursive: true, force: true });
  });
});

describe("copyText step", () => {
  it("extracts text and stores as runtime variable", async () => {
    const page = createMockPage({
      textContents: { "[data-testid=heading]": "Hello World" }
    });
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps: Step[] = [
      { copyText: { selector: "[data-testid=heading]", as: "HEADING" } }
    ];

    const context = {
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure" as const,
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set<string>(),
      configDir: runDir
    };

    const result = await executeSteps(context);

    expect(result.failed).toBe(false);
    expect(result.results[0].type).toBe("copyText");
    expect(result.results[0].selector).toBe("[data-testid=heading]");
    expect(result.results[0].value).toBe("[REDACTED]");
    expect(context.runtimeVars?.get("HEADING")).toBe("Hello World");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("fails when element has null text content", async () => {
    const page = createMockPage({
      textContents: { "[data-testid=empty]": null }
    });
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps: Step[] = [
      { copyText: { selector: "[data-testid=empty]", as: "EMPTY" } }
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
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].error).toContain("No text content found");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("fails on forbidden selector", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps: Step[] = [
      { copyText: { selector: "[data-danger]", as: "VAR" } }
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
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].error).toContain("Forbidden selector");
    fs.rmSync(runDir, { recursive: true, force: true });
  });
});

describe("waitForDownload step", () => {
  it("reuses the same listener across runHunt followed by waitForDownload", async () => {
    const mockDownload = {
      suggestedFilename: () => "report.pdf",
      saveAs: vi.fn(async () => undefined)
    };
    const page = createMockPage({ waitForEventResult: mockDownload });
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-runhunt-download-"));
    const huntsDir = path.join(configDir, "hunts");
    fs.mkdirSync(huntsDir, { recursive: true });
    const runDir = path.join(configDir, "runs", "test");
    fs.mkdirSync(runDir, { recursive: true });

    const subHunt = { steps: [{ click: { selector: "#download" } }] };
    fs.writeFileSync(path.join(huntsDir, "login.yml"), yaml.stringify(subHunt));

    const steps: Step[] = [
      { runHunt: "login" },
      { waitForDownload: { timeout: 5000 } }
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
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir,
      huntStack: ["parent"]
    });

    expect(result.failed).toBe(false);
    expect(page.waitForEvent).toHaveBeenCalledTimes(1);
    expect(page.waitForEvent).toHaveBeenCalledWith("download", { timeout: 5000 });
    expect(mockDownload.saveAs).toHaveBeenCalledTimes(1);
    expect(mockDownload.saveAs).toHaveBeenCalledWith(path.join(runDir, "report.pdf"));
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it("arms the download listener before the triggering step runs", async () => {
    const mockDownload = {
      suggestedFilename: () => "report.pdf",
      saveAs: vi.fn(async () => undefined)
    };
    const page = createMockPage({ waitForEventResult: mockDownload });
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps: Step[] = [
      { click: { selector: "#download" } },
      { waitForDownload: { timeout: 5000 } }
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
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    const clickLocator = (page as typeof page & {
      __locators: Map<string, { click: ReturnType<typeof vi.fn> }>;
    }).__locators.get("#download");

    expect(result.failed).toBe(false);
    expect(page.waitForEvent).toHaveBeenCalledTimes(1);
    expect(page.waitForEvent).toHaveBeenCalledWith("download", { timeout: 5000 });
    expect(clickLocator).toBeDefined();
    expect(page.waitForEvent.mock.invocationCallOrder[0]).toBeLessThan(
      clickLocator!.click.mock.invocationCallOrder[0]
    );
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("captures download and returns suggested filename", async () => {
    const mockDownload = {
      suggestedFilename: () => "report.pdf",
      saveAs: vi.fn(async () => undefined)
    };
    const page = createMockPage({ waitForEventResult: mockDownload });
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps: Step[] = [{ waitForDownload: null }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    expect(result.results[0].type).toBe("waitForDownload");
    expect(result.results[0].value).toBe("report.pdf");
    expect(page.waitForEvent).toHaveBeenCalledWith("download", { timeout: 30000 });
    expect(mockDownload.saveAs).toHaveBeenCalledWith(path.join(runDir, "report.pdf"));
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("captures download with filename assertion pass", async () => {
    const mockDownload = {
      suggestedFilename: () => "data.csv",
      saveAs: vi.fn(async () => undefined)
    };
    const page = createMockPage({ waitForEventResult: mockDownload });
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps: Step[] = [{ waitForDownload: { filename: "data.csv" } }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    expect(result.results[0].value).toBe("data.csv");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("fails when filename does not match", async () => {
    const mockDownload = {
      suggestedFilename: () => "wrong.pdf",
      saveAs: vi.fn(async () => undefined)
    };
    const page = createMockPage({ waitForEventResult: mockDownload });
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps: Step[] = [{ waitForDownload: { filename: "expected.pdf" } }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].error).toContain("Download filename mismatch");
    expect(result.results[0].error).toContain("expected.pdf");
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("uses custom timeout", async () => {
    const mockDownload = {
      suggestedFilename: () => "file.zip",
      saveAs: vi.fn(async () => undefined)
    };
    const page = createMockPage({ waitForEventResult: mockDownload });
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps: Step[] = [{ waitForDownload: { timeout: 60000 } }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(false);
    expect(page.waitForEvent).toHaveBeenCalledWith("download", { timeout: 60000 });
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("fails when the suggested filename is unsafe", async () => {
    const mockDownload = {
      suggestedFilename: () => "../escape.txt",
      saveAs: vi.fn(async () => undefined)
    };
    const page = createMockPage({ waitForEventResult: mockDownload });
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-steps-"));
    const steps: Step[] = [{ waitForDownload: null }];

    const result = await executeSteps({
      page: page as unknown as Page,
      steps,
      targetUrl: "http://localhost",
      runDir,
      screenshotsMode: "on-failure",
      forbiddenSelectors: [],
      allowedDomains: ["localhost"],
      maxTotalTimeMs: 30000,
      maxSteps: 50,
      redactedFillSteps: new Set(),
      configDir: runDir
    });

    expect(result.failed).toBe(true);
    expect(result.results[0].error).toContain('Invalid download filename: "../escape.txt"');
    expect(mockDownload.saveAs).not.toHaveBeenCalled();
    fs.rmSync(runDir, { recursive: true, force: true });
  });
});
