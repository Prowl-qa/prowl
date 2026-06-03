import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { executeSteps } from "../src/runner/steps.js";
import type { Page } from "playwright";
import type { Step } from "../src/types/index.js";

// PROWL-023: end-to-end wiring of self-healing into the explicit-selector actions.

function mockPage(locatorCounts: Record<string, number>) {
  const createLocator = (count: number) => {
    const locator = {
      count: vi.fn(async () => count),
      first: vi.fn(() => locator),
      click: vi.fn(async () => undefined),
      fill: vi.fn(async () => undefined),
      press: vi.fn(async () => undefined),
      selectOption: vi.fn(async () => undefined),
      setInputFiles: vi.fn(async () => undefined),
      hover: vi.fn(async () => undefined),
      scrollIntoViewIfNeeded: vi.fn(async () => undefined)
    };
    return locator;
  };
  return {
    url: () => "http://localhost",
    screenshot: vi.fn(async () => Buffer.from("")),
    locator: vi.fn((selector: string) => createLocator(locatorCounts[selector] ?? 1))
  };
}

function baseContext(page: unknown, steps: Step[], runDir: string, overrides?: Record<string, unknown>) {
  return {
    page: page as Page,
    steps,
    targetUrl: "http://localhost",
    runDir,
    screenshotsMode: "on-failure" as const,
    forbiddenSelectors: [],
    allowedDomains: ["localhost"],
    maxSteps: 50,
    maxTotalTimeMs: 60000,
    redactedFillSteps: new Set<string>(),
    configDir: runDir,
    onStep: undefined,
    ...overrides
  };
}

describe("self-healing wiring", () => {
  let runDir: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-heal-wire-"));
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("heals a failed click selector when selfHealing is on", async () => {
    // #sign-in matches nothing; the healed text=sign in matches exactly one.
    const page = mockPage({ "#sign-in": 0, "text=sign in": 1 });
    const steps: Step[] = [{ click: { selector: "#sign-in" } }];

    const result = await executeSteps(baseContext(page, steps, runDir, { selfHealing: true }));

    expect(result.failed).toBe(false);
    expect(result.results[0]).toMatchObject({
      type: "click",
      status: "pass",
      selector: "text=sign in",
      healedFrom: "#sign-in"
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Self-healed selector"));
  });

  it("does NOT heal when selfHealing is off (selector is used as-is)", async () => {
    const page = mockPage({ "#sign-in": 0, "text=sign in": 1 });
    const steps: Step[] = [{ click: { selector: "#sign-in" } }];

    const result = await executeSteps(baseContext(page, steps, runDir, { selfHealing: false }));

    // No heal: the action runs against the original selector, result has no healedFrom.
    expect(result.results[0]).toMatchObject({ type: "click", selector: "#sign-in" });
    expect(result.results[0].healedFrom).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not heal when the original selector already matches", async () => {
    const page = mockPage({ "#sign-in": 1 });
    const steps: Step[] = [{ click: { selector: "#sign-in" } }];

    const result = await executeSteps(baseContext(page, steps, runDir, { selfHealing: true }));

    expect(result.results[0]).toMatchObject({ selector: "#sign-in" });
    expect(result.results[0].healedFrom).toBeUndefined();
  });

  it("heals a hover selector too", async () => {
    const page = mockPage({ "#menu-toggle": 0, "text=menu toggle": 1 });
    const steps: Step[] = [{ hover: { selector: "#menu-toggle" } }];

    const result = await executeSteps(baseContext(page, steps, runDir, { selfHealing: true }));

    expect(result.results[0]).toMatchObject({
      type: "hover",
      status: "pass",
      selector: "text=menu toggle",
      healedFrom: "#menu-toggle"
    });
  });

  it("heals a press selector", async () => {
    const page = mockPage({ "#search-box": 0, "text=search box": 1 });
    const steps: Step[] = [{ press: { selector: "#search-box", key: "Enter" } }];

    const result = await executeSteps(baseContext(page, steps, runDir, { selfHealing: true }));

    expect(result.results[0]).toMatchObject({
      type: "press",
      status: "pass",
      selector: "text=search box",
      healedFrom: "#search-box"
    });
  });

  it("heals a scrollTo selector", async () => {
    const page = mockPage({ "#footer-cta": 0, "text=footer cta": 1 });
    const steps: Step[] = [{ scrollTo: { selector: "#footer-cta" } }];

    const result = await executeSteps(baseContext(page, steps, runDir, { selfHealing: true }));

    expect(result.results[0]).toMatchObject({
      type: "scrollTo",
      status: "pass",
      selector: "text=footer cta",
      healedFrom: "#footer-cta"
    });
  });

  it("heals a fill selector and keeps redacted value in the result", async () => {
    const page = mockPage({ "#email-field": 0, "text=email field": 1 });
    const steps: Step[] = [{ fill: { selector: "#email-field", value: "secret.test" } }];

    const result = await executeSteps(
      baseContext(page, steps, runDir, {
        selfHealing: true,
        redactedFillSteps: new Set(["0"])
      })
    );

    expect(result.failed).toBe(false);
    expect(result.results[0]).toMatchObject({
      type: "fill",
      status: "pass",
      selector: "text=email field",
      value: "[REDACTED]",
      healedFrom: "#email-field"
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Self-healed selector"));
  });

  it("heals a selectOption selector", async () => {
    const page = mockPage({ "#plan-select": 0, "text=plan select": 1 });
    const steps: Step[] = [{ selectOption: { selector: "#plan-select", value: "pro" } }];

    const result = await executeSteps(baseContext(page, steps, runDir, { selfHealing: true }));

    expect(result.failed).toBe(false);
    expect(result.results[0]).toMatchObject({
      type: "selectOption",
      status: "pass",
      selector: "text=plan select",
      value: "pro",
      healedFrom: "#plan-select"
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Self-healed selector"));
  });

  it("heals a setInputFiles selector", async () => {
    const page = mockPage({ "#resume-upload": 0, "text=resume upload": 1 });
    const steps: Step[] = [{ setInputFiles: { selector: "#resume-upload", files: "resume.pdf" } }];

    const result = await executeSteps(baseContext(page, steps, runDir, { selfHealing: true }));

    expect(result.failed).toBe(false);
    expect(result.results[0]).toMatchObject({
      type: "setInputFiles",
      status: "pass",
      selector: "text=resume upload",
      value: "resume.pdf",
      healedFrom: "#resume-upload"
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Self-healed selector"));
  });
});
