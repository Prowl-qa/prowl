/**
 * PROWL-048 / ARCH-002 — macOS native implementation of {@link SessionDriver}.
 *
 * `MacDriver` drives a native macOS app through the `prowl-macdriver` Swift
 * helper (Accessibility / AXUIElement) over a long-lived JSON-over-stdio
 * transport ({@link MacHelperClient}). It implements only the portable subset of
 * the driver surface — its `capabilities` set is honest: `query`, `interact`,
 * `wait`, `screenshot`. Web-only verbs (navigation, network, dialogs, files,
 * downloads, script evaluation) are unsupported stubs; the runner never reaches
 * them because both the target step-compatibility check and the runtime
 * capability gate reject web-only steps for the macOS target.
 *
 * Selector dialect (parsed here, so the Swift helper only matches attributes):
 *   id=openSettings              → accessibility identifier
 *   role=button[name="Save"]     → AX role + accessible name
 *   label="Email"                → exact accessibility label
 *   text="Save" | Save           → title/description/value substring
 *   statusItem                   → open the app's menu bar status-item menu
 *   menu=Preferences…            → open the status-item menu and click an item
 */
import type {
  DialogAction,
  DriverCapability,
  DriverDownload,
  DriverResponse,
  DriverRoute,
  NavigateOptions,
  SessionDriver
} from "./driver.js";

/** A structured accessibility query understood by the Swift helper. */
export type MacQuery =
  | { by: "id"; value: string }
  | { by: "role"; role: string; name?: string }
  | { by: "text"; value: string }
  | { by: "label"; value: string }
  | { by: "focused" };

/** The transport MacDriver talks to: one request → one response, matched by id. */
export interface MacHelperClient {
  /** Send a command; resolve with its `result` payload or reject with its error. */
  request(cmd: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Shut the helper down. */
  close(): Promise<void>;
}

export type MacDriverOptions = {
  /** Bundle id / app label, used only for the informational `currentUrl()` value. */
  appLabel?: string;
};

const MAC_CAPABILITIES: ReadonlySet<DriverCapability> = new Set<DriverCapability>([
  "query",
  "interact",
  "wait",
  "screenshot"
]);

const STATUS_ITEM_SELECTOR = "statusitem";
const MENU_PREFIX = "menu=";

function unquote(value: string): string {
  const trimmed = value.trim();
  const first = trimmed[0];
  if ((first === '"' || first === "'") && trimmed.endsWith(first) && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Parse a Prowl selector string into a {@link MacQuery}. Bare text matches by text. */
export function parseMacSelector(selector: string): MacQuery {
  const trimmed = selector.trim();

  const idMatch = /^id=(.+)$/s.exec(trimmed);
  if (idMatch) {
    return { by: "id", value: unquote(idMatch[1]) };
  }

  const roleMatch = /^role=([A-Za-z][\w-]*)(?:\[name=(.+)\])?$/s.exec(trimmed);
  if (roleMatch) {
    const name = roleMatch[2] !== undefined ? unquote(roleMatch[2]) : undefined;
    return name !== undefined && name.length > 0
      ? { by: "role", role: roleMatch[1], name }
      : { by: "role", role: roleMatch[1] };
  }

  const labelMatch = /^label=(.+)$/s.exec(trimmed);
  if (labelMatch) {
    return { by: "label", value: unquote(labelMatch[1]) };
  }

  const textMatch = /^text=(.+)$/s.exec(trimmed);
  if (textMatch) {
    return { by: "text", value: unquote(textMatch[1]) };
  }

  return { by: "text", value: trimmed };
}

/** The literal text a `text=` selector matches, else null (mirrors the web driver). */
export function unwrapMacTextSelector(selector: string): string | null {
  const trimmed = selector.trim();
  if (!trimmed.startsWith("text=")) {
    return null;
  }
  return unquote(trimmed.slice(5));
}

function num(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

/** Wrap a live {@link MacHelperClient} as a {@link SessionDriver}. */
export function createMacDriver(client: MacHelperClient, options: MacDriverOptions = {}): SessionDriver {
  const unsupported = (verb: string): Error => new Error(`${verb} is not supported by the macOS target`);
  const rejectUnsupported = (verb: string): Promise<never> => Promise.reject(unsupported(verb));

  async function query(cmd: string, selector: string, extra?: Record<string, unknown>): Promise<Record<string, unknown>> {
    return client.request(cmd, { query: parseMacSelector(selector), ...extra });
  }

  async function clickSelector(selector: string): Promise<void> {
    const trimmed = selector.trim();
    if (trimmed.toLowerCase() === STATUS_ITEM_SELECTOR) {
      await client.request("openMenu");
      return;
    }
    if (trimmed.toLowerCase().startsWith(MENU_PREFIX)) {
      await client.request("clickMenu", { title: trimmed.slice(MENU_PREFIX.length).trim() });
      return;
    }
    await query("click", selector);
  }

  async function fillSelector(selector: string, value: string): Promise<void> {
    if (selector.trim() === ":focus") {
      await client.request("fill", { query: { by: "focused" } as MacQuery, value });
      return;
    }
    await query("fill", selector, { value });
  }

  return {
    capabilities: MAC_CAPABILITIES,

    // navigation -----------------------------------------------------------
    goto(_url: string, _options?: NavigateOptions): Promise<void> {
      return rejectUnsupported("navigate");
    },
    currentUrl(): string {
      return `macos:${options.appLabel ?? ""}`;
    },

    // queries --------------------------------------------------------------
    async count(selector: string): Promise<number> {
      const result = await query("count", selector);
      return num(result.count);
    },
    async textContent(selector: string): Promise<string | null> {
      const result = await query("text", selector);
      return result.text === undefined || result.text === null ? null : String(result.text);
    },

    // interactions ---------------------------------------------------------
    click: clickSelector,
    clickFirst: clickSelector,
    fill: fillSelector,
    fillFirst: fillSelector,
    async press(selector: string, key: string): Promise<void> {
      await query("press", selector, { key });
    },
    selectOption(): Promise<void> {
      return rejectUnsupported("select");
    },
    selectOptionFirst(): Promise<void> {
      return rejectUnsupported("select");
    },
    async hover(selector: string): Promise<void> {
      await query("hover", selector);
    },
    async scrollIntoView(selector: string): Promise<void> {
      await query("scrollTo", selector);
    },
    setInputFiles(): Promise<void> {
      return rejectUnsupported("setInputFiles");
    },

    // semantic locators ----------------------------------------------------
    async countByRole(role: string, name: string): Promise<number> {
      const result = await client.request("count", { query: { by: "role", role, name } });
      return num(result.count);
    },
    async clickFirstByRole(role: string, name: string): Promise<void> {
      await client.request("click", { query: { by: "role", role, name } });
    },
    async countByLabel(label: string): Promise<number> {
      const result = await client.request("count", { query: { by: "label", value: label } });
      return num(result.count);
    },
    async fillFirstByLabel(label: string, value: string): Promise<void> {
      await client.request("fill", { query: { by: "label", value: label }, value });
    },
    selectOptionFirstByLabel(): Promise<void> {
      return rejectUnsupported("select");
    },

    // waiting --------------------------------------------------------------
    async waitForSelector(selector: string, waitOptions?: { timeout?: number }): Promise<void> {
      const extra = waitOptions?.timeout !== undefined ? { timeout: waitOptions.timeout / 1000 } : undefined;
      await query("waitFor", selector, extra);
    },
    waitForUrl(): Promise<void> {
      return rejectUnsupported("waitForUrl");
    },
    waitForNetworkIdle(): Promise<void> {
      return rejectUnsupported("waitForNetworkIdle");
    },

    // scripting & artifacts ------------------------------------------------
    evaluate<R = unknown>(): Promise<R> {
      return rejectUnsupported("evalScript") as Promise<R>;
    },
    async screenshot(screenshotOptions: { path: string; fullPage?: boolean }): Promise<void> {
      // The helper captures the app's frontmost window (window-scoped baselines);
      // `fullPage` has no analogue on a native window and is intentionally ignored.
      // When it can't find a capturable window it falls back to a full-screen grab
      // and reports a `warning` — surface it rather than swallowing it, so a flaky
      // full-screen baseline isn't produced silently.
      const result = await client.request("screenshot", { path: screenshotOptions.path });
      const warning = result.warning;
      if (typeof warning === "string" && warning.length > 0) {
        console.warn(`macOS screenshot fell back to full screen: ${warning}`);
      }
    },

    // network / dialogs / downloads (all web-only) -------------------------
    onResponse(_handler: (response: DriverResponse) => void): void {
      throw unsupported("onResponse");
    },
    route(_url: string, _handler: (route: DriverRoute) => void | Promise<void>): Promise<void> {
      return rejectUnsupported("mockRoute");
    },
    unroute(): Promise<void> {
      return rejectUnsupported("unmockRoute");
    },
    onDialog(_action: DialogAction): void {
      throw unsupported("onDialog");
    },
    waitForDownloadEvent(): Promise<DriverDownload> {
      return rejectUnsupported("waitForDownload") as Promise<DriverDownload>;
    },

    parseTextSelector(selector: string): string | null {
      return unwrapMacTextSelector(selector);
    }
  };
}
