/**
 * PROWL-047 / ARCH-001 — Session driver abstraction.
 *
 * `SessionDriver` is the narrow, engine-agnostic surface the step runner drives.
 * Today the only implementation is the Playwright driver (`playwright-driver.ts`),
 * but factoring the runner against this interface is the prerequisite for
 * non-browser execution targets (macOS native, Electron, mobile — see PROWL-048).
 *
 * The interface intentionally covers only the verbs `src/runner/steps.ts`
 * actually uses. Selector strings are the driver's own dialect: the driver
 * supplies `parseTextSelector` so the guardrail policy can reason about them
 * without knowing the engine.
 */

/** Coarse capability groups a step handler can require of a driver. */
export type DriverCapability =
  | "navigate"
  | "query"
  | "interact"
  | "wait"
  | "screenshot"
  | "evaluate"
  | "response"
  | "route"
  | "dialog"
  | "files"
  | "download";

/** How a dialog opened by the page should be answered. */
export type DialogAction = "accept" | "dismiss";

/** Options accepted when navigating; mirrors the subset of Playwright's `goto`. */
export type NavigateOptions = {
  waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
};

/** A network response as the driver exposes it (engine-neutral). */
export type DriverResponse = {
  url(): string;
  status(): number;
  /** Header names MUST be lowercased by the driver; consumers look up lowercase keys. */
  headers(): Record<string, string>;
};

/** A route intercepted via `route()`; the handler fulfills it with a canned response. */
export type DriverRoute = {
  fulfill(response: { status: number; contentType?: string; body?: string }): Promise<void>;
};

/** A file download surfaced by `waitForDownloadEvent()`. */
export type DriverDownload = {
  suggestedFilename(): string;
  saveAs(path: string): Promise<void>;
};

/**
 * The operations the step runner performs against a live session. Each method
 * corresponds to one Playwright Page/Locator call in the legacy runner, so the
 * Playwright implementation is a faithful pass-through and behaviour is
 * unchanged.
 */
export interface SessionDriver {
  /** Capabilities this driver supports; handlers declare what they need. */
  readonly capabilities: ReadonlySet<DriverCapability>;

  // navigation --------------------------------------------------------------
  goto(url: string, options?: NavigateOptions): Promise<void>;
  currentUrl(): string;

  // queries -----------------------------------------------------------------
  count(selector: string): Promise<number>;
  textContent(selector: string): Promise<string | null>;

  // element interactions (explicit selector) --------------------------------
  click(selector: string): Promise<void>;
  clickFirst(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  fillFirst(selector: string, value: string): Promise<void>;
  press(selector: string, key: string): Promise<void>;
  selectOption(selector: string, value: string): Promise<void>;
  selectOptionFirst(selector: string, value: string): Promise<void>;
  hover(selector: string): Promise<void>;
  scrollIntoView(selector: string): Promise<void>;
  setInputFiles(selector: string, files: string | string[]): Promise<void>;

  // semantic locators (role / label shorthand resolution) -------------------
  countByRole(role: string, name: string): Promise<number>;
  clickFirstByRole(role: string, name: string): Promise<void>;
  countByLabel(label: string): Promise<number>;
  fillFirstByLabel(label: string, value: string): Promise<void>;
  selectOptionFirstByLabel(label: string, value: string): Promise<void>;

  // waiting -----------------------------------------------------------------
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<void>;
  waitForUrl(predicate: (url: string) => boolean, options?: { timeout?: number }): Promise<void>;
  waitForNetworkIdle(options?: { timeout?: number }): Promise<void>;

  // scripting & artifacts ---------------------------------------------------
  evaluate<R = unknown, A = unknown>(
    pageFunction: string | ((arg: A) => R | Promise<R>),
    arg?: A
  ): Promise<R>;
  screenshot(options: { path: string; fullPage?: boolean }): Promise<void>;

  // network observation -----------------------------------------------------
  onResponse(handler: (response: DriverResponse) => void): void;

  // network mocking ---------------------------------------------------------
  route(url: string, handler: (route: DriverRoute) => void | Promise<void>): Promise<void>;
  unroute(url: string): Promise<void>;

  // dialogs & downloads -----------------------------------------------------
  onDialog(action: DialogAction): void;
  waitForDownloadEvent(options?: { timeout?: number }): Promise<DriverDownload>;

  /**
   * Driver-supplied selector parser: returns the literal text a text-engine
   * selector matches (e.g. `text="Delete"` → `Delete`), or null for any other
   * selector. The guardrail policy uses this to interpret forbidden patterns
   * without hard-coding the engine's selector dialect.
   */
  parseTextSelector(selector: string): string | null;
}
