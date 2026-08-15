/**
 * PROWL-047 / ARCH-001 — Browser launch entrypoint.
 *
 * Launch/teardown and the Playwright driver now live in `playwright-driver.ts`
 * (the single Playwright importer). This module re-exports them so existing
 * import paths (`../browser/controller.js`) keep working unchanged.
 */
export {
  launchBrowser,
  closeBrowser,
  saveStorageState,
  createPlaywrightDriver,
  type BrowserSession,
  type BrowserOptions
} from "./playwright-driver.js";
