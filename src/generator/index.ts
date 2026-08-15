import yaml from "yaml";
import { launchBrowser, closeBrowser, createPlaywrightDriver } from "../browser/controller.js";
import { parseBrowserEngine } from "../browser/engines.js";
import type { AnalysisResult } from "../analyzer/index.js";
import { analyzePage } from "../analyzer/index.js";
import { buildGenerationPrompt, extractYamlFromResponse } from "./prompt.js";
import { generateWithAi, resolveAiConfig } from "./ai.js";
import type { AiConfig } from "./ai.js";
import { resolveViewport } from "../config/loader.js";
import { huntSchema } from "../config/schema.js";

export type GenerateOptions = {
  url?: string;
  analysis?: AnalysisResult;
  intent: string;
  browser?: string;
  viewport?: string;
  aiConfig?: AiConfig;
};

function parseViewportFlag(value: string): string | { width: number; height: number } {
  const match = /^(\d+)x(\d+)$/i.exec(value);
  if (match) {
    return { width: Number(match[1]), height: Number(match[2]) };
  }
  return value;
}

export async function generateHunt(options: GenerateOptions): Promise<string> {
  let analysis = options.analysis;

  if (!analysis && options.url) {
    const engine = parseBrowserEngine(options.browser);
    const viewport = options.viewport
      ? resolveViewport(parseViewportFlag(options.viewport))
      : resolveViewport(undefined);
    const session = await launchBrowser({
      headless: true,
      slowMo: 0,
      timeout: 30000,
      trace: false,
      recordHar: false,
      runDir: process.cwd(),
      engine,
      viewport
    });
    const driver = createPlaywrightDriver(session.page);
    try {
      await driver.goto(options.url, { waitUntil: "networkidle" });
      analysis = await analyzePage(driver);
    } finally {
      await closeBrowser(session);
    }
  }

  if (!analysis) {
    throw new Error("Either --url or piped analysis JSON is required");
  }

  const config = options.aiConfig ?? resolveAiConfig();
  const prompt = buildGenerationPrompt(analysis, options.intent);
  const response = await generateWithAi(prompt, config);
  const yamlStr = extractYamlFromResponse(response);

  // Validate generated YAML
  const parsed = yaml.parse(yamlStr);
  huntSchema.parse(parsed);

  return yamlStr;
}
