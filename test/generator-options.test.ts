import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AnalysisResult } from "../src/analyzer/index.js";

const mockLaunchBrowser = vi.fn();
const mockCloseBrowser = vi.fn();
const mockCreatePlaywrightDriver = vi.fn();
const mockAnalyzePage = vi.fn();
const mockGenerateWithAi = vi.fn();
const mockResolveAiConfig = vi.fn();

vi.mock("../src/browser/controller.js", () => ({
  launchBrowser: (...args: unknown[]) => mockLaunchBrowser(...args),
  closeBrowser: (...args: unknown[]) => mockCloseBrowser(...args),
  createPlaywrightDriver: (...args: unknown[]) => mockCreatePlaywrightDriver(...args)
}));

vi.mock("../src/analyzer/index.js", () => ({
  analyzePage: (...args: unknown[]) => mockAnalyzePage(...args)
}));

vi.mock("../src/generator/ai.js", () => ({
  generateWithAi: (...args: unknown[]) => mockGenerateWithAi(...args),
  resolveAiConfig: (...args: unknown[]) => mockResolveAiConfig(...args)
}));

import { generateHunt } from "../src/generator/index.js";

const analysis: AnalysisResult = {
  url: "https://example.com/login",
  title: "Example",
  elements: [],
  forms: [],
  links: []
};

const aiConfig = {
  provider: "openai" as const,
  model: "gpt-4o",
  apiKey: "test-key"
};

describe("generateHunt launch options", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const driver = { goto: vi.fn(async () => undefined) };
    mockLaunchBrowser.mockResolvedValue({ page: {}, browser: {}, context: {} });
    mockCreatePlaywrightDriver.mockReturnValue(driver);
    mockAnalyzePage.mockResolvedValue(analysis);
    mockGenerateWithAi.mockResolvedValue("steps:\n  - navigate: /\n");
  });

  it("forwards browser and viewport options when analyzing a URL", async () => {
    await generateHunt({
      url: "https://example.com/login",
      intent: "check login",
      browser: "firefox",
      viewport: "375x812",
      aiConfig
    });

    expect(mockLaunchBrowser).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: "firefox",
        viewport: { width: 375, height: 812 }
      })
    );
    const driver = mockCreatePlaywrightDriver.mock.results[0].value;
    expect(driver.goto).toHaveBeenCalledWith("https://example.com/login", { waitUntil: "networkidle" });
    expect(mockCloseBrowser).toHaveBeenCalled();
  });

  it("rejects unsupported browser options before launch", async () => {
    await expect(
      generateHunt({
        url: "https://example.com/login",
        intent: "check login",
        browser: "safari",
        aiConfig
      })
    ).rejects.toThrow('Unsupported browser engine "safari". Use chromium, firefox, webkit.');

    expect(mockLaunchBrowser).not.toHaveBeenCalled();
  });
});
