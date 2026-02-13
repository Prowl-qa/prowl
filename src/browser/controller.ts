import fs from "node:fs";
import path from "node:path";
import { chromium, firefox, webkit, type Browser, type BrowserContext, type Page } from "playwright";
import type { BrowserEngine, Viewport } from "../types/index.js";

const ENGINES = { chromium, firefox, webkit } as const;

export type BrowserSession = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  tracePath?: string;
};

export type BrowserOptions = {
  headless: boolean;
  slowMo: number;
  timeout: number;
  storageStatePath?: string;
  trace: boolean;
  recordHar: boolean;
  runDir: string;
  engine?: BrowserEngine;
  viewport?: Viewport;
};

export async function launchBrowser(options: BrowserOptions): Promise<BrowserSession> {
  const engine = ENGINES[options.engine ?? "chromium"];
  const browser = await engine.launch({ headless: options.headless, slowMo: options.slowMo });

  const contextOptions: Parameters<typeof browser.newContext>[0] = {};

  if (options.viewport) {
    contextOptions.viewport = options.viewport;
  }

  if (options.storageStatePath && fs.existsSync(options.storageStatePath)) {
    contextOptions.storageState = options.storageStatePath;
  }

  if (options.recordHar) {
    contextOptions.recordHar = { path: path.join(options.runDir, "network.har") };
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.setDefaultTimeout(options.timeout);
  page.setDefaultNavigationTimeout(options.timeout);

  let tracePath: string | undefined;
  if (options.trace) {
    tracePath = path.join(options.runDir, "trace.zip");
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  }

  return { browser, context, page, tracePath };
}

export async function closeBrowser(session: BrowserSession): Promise<void> {
  if (session.tracePath) {
    await session.context.tracing.stop({ path: session.tracePath });
  }
  await session.context.close();
  await session.browser.close();
}
