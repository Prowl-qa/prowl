/**
 * PROWL-047 / ARCH-001 — Playwright implementation of {@link SessionDriver}.
 *
 * This is the ONLY module in the codebase that imports Playwright at runtime;
 * everything else drives the session through the engine-neutral `SessionDriver`
 * interface. Browser launch/teardown lives here too (re-exported by
 * `controller.ts` to keep the public import path stable), so the Playwright
 * dependency is confined to this file.
 *
 * Every driver method is a faithful pass-through to the exact Playwright
 * Page/Locator call the legacy runner made — this refactor changes structure,
 * not behaviour.
 */
import fs from "node:fs";
import path from "node:path";
import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type Page
} from "playwright";
import type { BrowserChannel, BrowserEngine, Viewport } from "../types/index.js";
import type {
  DialogAction,
  DriverCapability,
  DriverDownload,
  DriverRoute,
  NavigateOptions,
  SessionDriver
} from "./driver.js";

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
  channel?: BrowserChannel;
  viewport?: Viewport;
};

export async function launchBrowser(options: BrowserOptions): Promise<BrowserSession> {
  const engine = ENGINES[options.engine ?? "chromium"];
  const browser = await engine.launch({
    headless: options.headless,
    slowMo: options.slowMo,
    channel: options.channel
  });

  const contextOptions: Parameters<typeof browser.newContext>[0] = {};

  if (options.viewport) {
    contextOptions.viewport = options.viewport;
  }

  if (options.storageStatePath) {
    if (fs.existsSync(options.storageStatePath)) {
      contextOptions.storageState = options.storageStatePath;
    } else {
      console.warn(`Auth state file not found: ${options.storageStatePath}. Run "prowl login" to create it.`);
    }
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

/** Persist the session's storage state (cookies + localStorage) to disk. */
export async function saveStorageState(session: BrowserSession, storageStatePath: string): Promise<void> {
  await session.context.storageState({ path: storageStatePath });
}

const ALL_CAPABILITIES: ReadonlySet<DriverCapability> = new Set<DriverCapability>([
  "navigate",
  "query",
  "interact",
  "wait",
  "screenshot",
  "evaluate",
  "route",
  "dialog",
  "files",
  "download"
]);

type PlaywrightRole = Parameters<Page["getByRole"]>[0];

function unwrapTextSelector(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.startsWith('text="') && trimmed.endsWith('"')) {
    return trimmed.slice(6, -1);
  }
  if (trimmed.startsWith("text='") && trimmed.endsWith("'")) {
    return trimmed.slice(6, -1);
  }
  if (trimmed.startsWith("text=")) {
    return trimmed.slice(5);
  }
  return null;
}

/**
 * Wrap a live Playwright {@link Page} as a {@link SessionDriver}. Each method
 * delegates to the same Page/Locator call the runner previously made inline.
 */
export function createPlaywrightDriver(page: Page): SessionDriver {
  return {
    capabilities: ALL_CAPABILITIES,

    async goto(url: string, options?: NavigateOptions): Promise<void> {
      if (options?.waitUntil !== undefined) {
        await page.goto(url, { waitUntil: options.waitUntil });
      } else {
        await page.goto(url);
      }
    },

    currentUrl(): string {
      return page.url();
    },

    count(selector: string): Promise<number> {
      return page.locator(selector).count();
    },

    textContent(selector: string): Promise<string | null> {
      return page.locator(selector).textContent();
    },

    async click(selector: string): Promise<void> {
      await page.locator(selector).click();
    },

    async clickFirst(selector: string): Promise<void> {
      await page.locator(selector).first().click();
    },

    async fill(selector: string, value: string): Promise<void> {
      await page.locator(selector).fill(value);
    },

    async fillFirst(selector: string, value: string): Promise<void> {
      await page.locator(selector).first().fill(value);
    },

    async press(selector: string, key: string): Promise<void> {
      await page.locator(selector).press(key);
    },

    async selectOption(selector: string, value: string): Promise<void> {
      await page.locator(selector).selectOption(value);
    },

    async selectOptionFirst(selector: string, value: string): Promise<void> {
      await page.locator(selector).first().selectOption(value);
    },

    async hover(selector: string): Promise<void> {
      await page.locator(selector).hover();
    },

    async scrollIntoView(selector: string): Promise<void> {
      await page.locator(selector).scrollIntoViewIfNeeded();
    },

    async setInputFiles(selector: string, files: string | string[]): Promise<void> {
      await page.locator(selector).setInputFiles(files);
    },

    countByRole(role: string, name: string): Promise<number> {
      return page.getByRole(role as PlaywrightRole, { name }).count();
    },

    async clickFirstByRole(role: string, name: string): Promise<void> {
      await page.getByRole(role as PlaywrightRole, { name }).first().click();
    },

    countByLabel(label: string): Promise<number> {
      return page.getByLabel(label, { exact: true }).count();
    },

    async fillFirstByLabel(label: string, value: string): Promise<void> {
      await page.getByLabel(label, { exact: true }).first().fill(value);
    },

    async selectOptionFirstByLabel(label: string, value: string): Promise<void> {
      await page.getByLabel(label, { exact: true }).first().selectOption(value);
    },

    async waitForSelector(selector: string, options?: { timeout?: number }): Promise<void> {
      await page.waitForSelector(selector, { timeout: options?.timeout });
    },

    async waitForUrl(predicate: (url: string) => boolean, options?: { timeout?: number }): Promise<void> {
      await page.waitForURL((url) => predicate(url.toString()), { timeout: options?.timeout });
    },

    async waitForNetworkIdle(options?: { timeout?: number }): Promise<void> {
      await page.waitForLoadState("networkidle", { timeout: options?.timeout });
    },

    evaluate<R = unknown, A = unknown>(
      pageFunction: string | ((arg: A) => R | Promise<R>),
      arg?: A
    ): Promise<R> {
      const raw = page.evaluate as unknown as (fn: unknown, a?: unknown) => Promise<unknown>;
      const result = arg === undefined
        ? raw.call(page, pageFunction)
        : raw.call(page, pageFunction, arg);
      return result as Promise<R>;
    },

    async screenshot(options: { path: string; fullPage?: boolean }): Promise<void> {
      await page.screenshot({ path: options.path, fullPage: options.fullPage });
    },

    async route(url: string, handler: (route: DriverRoute) => void | Promise<void>): Promise<void> {
      await page.route(url, (pwRoute) => {
        void handler({
          fulfill: (response) => pwRoute.fulfill(response)
        });
      });
    },

    async unroute(url: string): Promise<void> {
      await page.unroute(url);
    },

    onDialog(action: DialogAction): void {
      page.once("dialog", async (dialog) => {
        if (action === "accept") {
          await dialog.accept();
        } else {
          await dialog.dismiss();
        }
      });
    },

    waitForDownloadEvent(options?: { timeout?: number }): Promise<DriverDownload> {
      return page.waitForEvent("download", { timeout: options?.timeout });
    },

    parseTextSelector(selector: string): string | null {
      return unwrapTextSelector(selector);
    }
  };
}
