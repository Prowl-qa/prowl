import { SUPPORTED_BROWSER_ENGINES, type BrowserEngine } from "../types/index.js";

export function formatSupportedBrowserEngines(): string {
  return SUPPORTED_BROWSER_ENGINES.join(", ");
}

export function parseBrowserEngine(value: string | undefined, fallback: BrowserEngine = "chromium"): BrowserEngine {
  if (value === undefined || value.length === 0) {
    return fallback;
  }
  if ((SUPPORTED_BROWSER_ENGINES as readonly string[]).includes(value)) {
    return value as BrowserEngine;
  }
  throw new Error(`Unsupported browser engine "${value}". Use ${formatSupportedBrowserEngines()}.`);
}
