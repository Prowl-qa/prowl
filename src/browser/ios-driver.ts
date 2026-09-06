/**
 * PROWL-059 / ARCH-010 — iOS simulator implementation of {@link SessionDriver}.
 *
 * `IosDriver` drives a native iOS app through a prebuilt WebDriverAgent (WDA)
 * runner over its W3C-shaped HTTP/JSON API ({@link IosAgentClient}). Like the
 * macOS and Android drivers it implements only the portable subset of the driver
 * surface — its `capabilities` set is honest: `query`, `interact`, `wait`,
 * `screenshot`. Web-only verbs (navigation, network, dialogs, files, downloads,
 * script evaluation) are unsupported stubs; the runner never reaches them because
 * both the target step-compatibility check and the runtime capability gate reject
 * web-only steps for native targets.
 *
 * Screenshots are captured via `simctl` (injected as `captureScreenshot`), not
 * WDA, so artifacts still work even if the agent wedges.
 *
 * Selector dialect (parsed by the shared native selector engine
 * `../selector/native.ts` (PROWL-060) — the single source of truth for the
 * grammar and attribute mapping — then mapped here to an {@link IosQuery} the
 * agent matches on the simulator). Semantics mirror the macOS/Android drivers so
 * `id=`/`label=`/`text=`/`role=` mean the same thing across native targets:
 *   id=save                    → accessibility id (accessibilityIdentifier / name)
 *   label="Submit"             → predicate `label == "Submit"` (exact)
 *   role=XCUIElementTypeButton → element class (shorthand `Button` is accepted too)
 *   role=Button[name="Save"]   → class + visible text (label/value substring)
 *   text="Save" | Save         → label/value substring
 *   :focus                     → predicate `hasKeyboardFocus == 1`
 */
import {
  normalizeXcuiClassName,
  parseNativeSelector,
  unwrapNativeTextSelector,
  type NativeSelector
} from "../selector/native.js";
import {
  buildDirectionalSwipe,
  MAX_SCROLL_TO_SWIPES,
  type PointerActionSequence,
  type ScreenSize,
  type SwipeDirection
} from "./touch-gestures.js";
import type {
  DialogAction,
  DriverCapability,
  DriverDownload,
  DriverResponse,
  DriverRoute,
  NavigateOptions,
  SessionDriver
} from "./driver.js";

// Re-export the role-normalization rule from the shared native selector engine
// (PROWL-060), its single source of truth, so existing importers of
// `normalizeXcuiClassName` from this module keep working.
export { normalizeXcuiClassName } from "../selector/native.js";

/** A structured query the {@link IosAgentClient} resolves against the simulator. */
export type IosQuery =
  | { by: "accessibilityId"; value: string }
  | { by: "label"; value: string }
  | { by: "role"; role: string; name?: string }
  | { by: "text"; value: string }
  | { by: "focused" };

/** A WDA locator strategy ({@code using}) + its value, as the agent expects. */
export type IosLocator = { using: string; value: string };

/**
 * The semantic transport `IosDriver` talks to: element lookups return opaque
 * element ids, and interactions take those ids. The HTTP/WDA implementation lives
 * in {@link ./ios-agent.js}; tests fake this interface.
 */
export interface IosAgentClient {
  /** Resolve the first element matching `query`, or null when none match. */
  findElement(query: IosQuery): Promise<string | null>;
  /** Resolve every element id matching `query` (empty when none match). */
  findElements(query: IosQuery): Promise<string[]>;
  click(elementId: string): Promise<void>;
  /** Replace an element's text (W3C `element/value`). */
  setValue(elementId: string, text: string): Promise<void>;
  getText(elementId: string): Promise<string | null>;
  /** Send raw key sequences to the focused element (WDA `/wda/keys`). */
  sendKeys(keys: string[]): Promise<void>;
  /** Return to the springboard home screen (WDA `/wda/homescreen`). */
  homescreen(): Promise<void>;
  /** Current screen size in points (WDA `/window/size`), for gesture geometry. */
  windowSize(): Promise<ScreenSize>;
  /** Perform a W3C pointer action sequence (WDA `POST /session/:id/actions`). */
  performActions(actions: PointerActionSequence): Promise<void>;
  /**
   * Return the current UI hierarchy as WebDriverAgent `/source` XML. Present on
   * live clients and consumed by the analyzer (PROWL-061); optional so lighter
   * fakes that only drive/query need not implement it.
   */
  source?(): Promise<string>;
  close(): Promise<void>;
}

export type IosDriverOptions = {
  /** Bundle id, used only for the informational `currentUrl()` value. */
  appLabel?: string;
  /** Capture a PNG screenshot to `path` (injected simctl capture). */
  captureScreenshot: (path: string) => Promise<void>;
};

const IOS_CAPABILITIES: ReadonlySet<DriverCapability> = new Set<DriverCapability>([
  "query",
  "interact",
  "wait",
  "screenshot"
]);

/** Poll interval while waiting for a selector to appear. */
const WAIT_POLL_INTERVAL_MS = 250;
/** Default wait deadline when a step does not specify one. */
const DEFAULT_WAIT_TIMEOUT_MS = 5000;

/**
 * Key names the `press` step supports on iOS, sorted for error messages. `enter`/
 * `return` send a newline, `delete`/`backspace` send a backspace (both via WDA's
 * key endpoint), and `home` returns to the springboard.
 */
export const IOS_PRESS_KEYS: readonly string[] = ["backspace", "del", "delete", "enter", "home", "return"];

/** Escape a string for embedding inside a double-quoted NSPredicate string literal. */
export function escapePredicateArg(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Map a neutral {@link NativeSelector} (parsed by the shared engine) onto this
 * driver's WDA query shape. iOS's `id=` targets the accessibility id and `label=`
 * the accessibility label; everything else maps one-to-one.
 */
function toIosQuery(selector: NativeSelector): IosQuery {
  switch (selector.kind) {
    case "focused":
      return { by: "focused" };
    case "id":
      return { by: "accessibilityId", value: selector.value };
    case "role":
      return selector.name !== undefined
        ? { by: "role", role: selector.role, name: selector.name }
        : { by: "role", role: selector.role };
    case "label":
      return { by: "label", value: selector.value };
    case "text":
      return { by: "text", value: selector.value };
  }
}

/**
 * Parse a Prowl selector string into an {@link IosQuery}. Bare text matches by
 * text. The grammar (and its `label=`-in-assertions trap) is defined once in the
 * shared native selector engine ({@link parseNativeSelector}, PROWL-060); this
 * only maps the neutral result onto iOS's WDA query.
 */
export function parseIosSelector(selector: string): IosQuery {
  return toIosQuery(parseNativeSelector(selector));
}

/**
 * Translate an {@link IosQuery} into a WDA locator strategy. `id` uses the native
 * `accessibility id` strategy and bare roles use `class name`; everything else
 * composes an NSPredicate string (WDA's `predicate string` strategy).
 */
export function iosQueryToLocator(query: IosQuery): IosLocator {
  switch (query.by) {
    case "accessibilityId":
      return { using: "accessibility id", value: query.value };
    case "label":
      // Exact accessibilityLabel match (mirrors Android content-desc exactness).
      return { using: "predicate string", value: `label == "${escapePredicateArg(query.value)}"` };
    case "text": {
      // Visible text (label/value) substring — mirrors macOS/Android text= semantics.
      const escaped = escapePredicateArg(query.value);
      return {
        using: "predicate string",
        value: `label CONTAINS "${escaped}" OR value CONTAINS "${escaped}"`
      };
    }
    case "focused":
      return { using: "predicate string", value: "hasKeyboardFocus == 1" };
    case "role": {
      const className = normalizeXcuiClassName(query.role);
      if (query.name === undefined || query.name.length === 0) {
        return { using: "class name", value: className };
      }
      const escapedClass = escapePredicateArg(className);
      const escapedName = escapePredicateArg(query.name);
      // Class + visible-text (substring) name, mirroring Android role+name.
      return {
        using: "predicate string",
        value:
          `type == "${escapedClass}" AND ` +
          `(label CONTAINS "${escapedName}" OR value CONTAINS "${escapedName}")`
      };
    }
  }
}

/** The literal text a `text=` selector matches, else null (mirrors the web driver). */
export function unwrapIosTextSelector(selector: string): string | null {
  return unwrapNativeTextSelector(selector);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Wrap a live {@link IosAgentClient} as a {@link SessionDriver}. */
export function createIosDriver(client: IosAgentClient, options: IosDriverOptions): SessionDriver {
  const unsupported = (verb: string): Error => new Error(`${verb} is not supported by the iOS target`);
  const rejectUnsupported = (verb: string): Promise<never> => Promise.reject(unsupported(verb));

  async function resolveOne(selector: string): Promise<string> {
    const id = await client.findElement(parseIosSelector(selector));
    if (id === null) {
      throw new Error(`No element matched selector: ${selector}`);
    }
    return id;
  }

  async function clickSelector(selector: string): Promise<void> {
    await client.click(await resolveOne(selector));
  }

  async function fillSelector(selector: string, value: string): Promise<void> {
    await client.setValue(await resolveOne(selector), value);
  }

  async function swipe(direction: SwipeDirection, amount?: number): Promise<void> {
    const size = await client.windowSize();
    const { actions } = buildDirectionalSwipe(direction, size, amount);
    await client.performActions(actions);
  }

  async function pressKey(key: string): Promise<void> {
    const name = key.trim().toLowerCase();
    if (name === "enter" || name === "return") {
      await client.sendKeys(["\n"]);
      return;
    }
    if (name === "delete" || name === "backspace" || name === "del") {
      await client.sendKeys(["\b"]);
      return;
    }
    if (name === "home") {
      await client.homescreen();
      return;
    }
    throw new Error(
      `Unsupported key "${key}" for the iOS target. Supported keys: ${IOS_PRESS_KEYS.join(", ")}.`
    );
  }

  return {
    capabilities: IOS_CAPABILITIES,

    // navigation -----------------------------------------------------------
    goto(_url: string, _options?: NavigateOptions): Promise<void> {
      return rejectUnsupported("navigate");
    },
    currentUrl(): string {
      return `ios:${options.appLabel ?? ""}`;
    },

    // queries --------------------------------------------------------------
    async count(selector: string): Promise<number> {
      return (await client.findElements(parseIosSelector(selector))).length;
    },
    async textContent(selector: string): Promise<string | null> {
      const id = await client.findElement(parseIosSelector(selector));
      if (id === null) {
        return null;
      }
      return client.getText(id);
    },

    // interactions ---------------------------------------------------------
    click: clickSelector,
    clickFirst: clickSelector,
    fill: fillSelector,
    fillFirst: fillSelector,
    async press(_selector: string, key: string): Promise<void> {
      // WDA keys dispatch to the focused element, so the selector is advisory;
      // callers should focus the field first (e.g. click / fill).
      await pressKey(key);
    },
    selectOption(): Promise<void> {
      return rejectUnsupported("select");
    },
    selectOptionFirst(): Promise<void> {
      return rejectUnsupported("select");
    },
    hover(): Promise<void> {
      // No hover concept on touch devices.
      return rejectUnsupported("hover");
    },
    // Screen-centred swipe via the W3C actions endpoint (PROWL-080). Direction
    // semantics match the web step: scrolling "down" reveals lower content, so
    // the finger drags up. See ./touch-gestures.ts.
    async scroll(direction: "up" | "down" | "left" | "right", amount?: number): Promise<void> {
      await swipe(direction, amount);
    },
    // Resolve the element, short-circuiting if it is already present in the
    // hierarchy; otherwise swipe down and re-probe, up to MAX_SCROLL_TO_SWIPES
    // times, before failing with a message naming the selector and attempts.
    async scrollIntoView(selector: string): Promise<void> {
      const query = parseIosSelector(selector);
      if ((await client.findElements(query)).length > 0) {
        return;
      }
      for (let attempt = 1; attempt <= MAX_SCROLL_TO_SWIPES; attempt += 1) {
        await swipe("down");
        if ((await client.findElements(query)).length > 0) {
          return;
        }
      }
      throw new Error(
        `scrollTo: element "${selector}" not visible after ${MAX_SCROLL_TO_SWIPES} scroll attempts on the iOS target`
      );
    },
    setInputFiles(): Promise<void> {
      return rejectUnsupported("setInputFiles");
    },

    // semantic locators ----------------------------------------------------
    async countByRole(role: string, name: string): Promise<number> {
      return (await client.findElements({ by: "role", role, name })).length;
    },
    async clickFirstByRole(role: string, name: string): Promise<void> {
      const id = await client.findElement({ by: "role", role, name });
      if (id === null) {
        throw new Error(`No element matched role=${role}[name="${name}"]`);
      }
      await client.click(id);
    },
    async countByLabel(label: string): Promise<number> {
      return (await client.findElements({ by: "label", value: label })).length;
    },
    async fillFirstByLabel(label: string, value: string): Promise<void> {
      const id = await client.findElement({ by: "label", value: label });
      if (id === null) {
        throw new Error(`No element matched label="${label}"`);
      }
      await client.setValue(id, value);
    },
    selectOptionFirstByLabel(): Promise<void> {
      return rejectUnsupported("select");
    },

    // waiting --------------------------------------------------------------
    async waitForSelector(selector: string, waitOptions?: { timeout?: number }): Promise<void> {
      const query = parseIosSelector(selector);
      const timeoutMs = waitOptions?.timeout ?? DEFAULT_WAIT_TIMEOUT_MS;
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if ((await client.findElements(query)).length > 0) {
          return;
        }
        if (Date.now() >= deadline) {
          throw new Error(`Timed out after ${timeoutMs}ms waiting for selector: ${selector}`);
        }
        await delay(Math.min(WAIT_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
      }
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
      // A simulator screenshot is always the whole screen; `fullPage` has no
      // analogue and is intentionally ignored.
      await options.captureScreenshot(screenshotOptions.path);
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
      return unwrapIosTextSelector(selector);
    }
  };
}
