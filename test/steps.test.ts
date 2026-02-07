import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { executeSteps } from "../src/runner/steps.js";
import type { Page } from "playwright";
import type { Step } from "../src/types/index.js";

function createMockPage() {
  let currentUrl = "http://localhost";
  const locator = () => ({
    click: vi.fn(async () => undefined),
    fill: vi.fn(async () => undefined),
    press: vi.fn(async () => undefined),
    setInputFiles: vi.fn(async () => undefined)
  });

  return {
    goto: vi.fn(async (url: string) => {
      currentUrl = url;
    }),
    url: () => currentUrl,
    locator: vi.fn(() => locator()),
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

  it("executes setInputFiles step", async () => {
    const page = createMockPage();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-steps-"));
    const steps: Step[] = [
      { setInputFiles: { selector: "input[type=file]", files: "fixtures/avatar.png" } }
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
    expect(result.results[0].selector).toBe("input[type=file]");
    expect(page.locator).toHaveBeenCalledWith("input[type=file]");
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
