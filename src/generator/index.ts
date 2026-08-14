import yaml from "yaml";
import { launchBrowser, closeBrowser, createPlaywrightDriver } from "../browser/controller.js";
import type { AnalysisResult } from "../analyzer/index.js";
import { analyzePage } from "../analyzer/index.js";
import { buildGenerationPrompt, extractYamlFromResponse } from "./prompt.js";
import { generateWithAi, resolveAiConfig } from "./ai.js";
import type { AiConfig } from "./ai.js";
import { huntSchema } from "../config/schema.js";

export type GenerateOptions = {
  url?: string;
  analysis?: AnalysisResult;
  intent: string;
  browser?: string;
  viewport?: string;
  aiConfig?: AiConfig;
};

export async function generateHunt(options: GenerateOptions): Promise<string> {
  let analysis = options.analysis;

  if (!analysis && options.url) {
    const session = await launchBrowser({
      headless: true,
      slowMo: 0,
      timeout: 30000,
      trace: false,
      recordHar: false,
      runDir: process.cwd()
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
