/**
 * PROWL-058 / ARCH-009 — Android native implementation of {@link SessionDriver}.
 *
 * `AndroidDriver` drives a native Android app through the on-device
 * `appium-uiautomator2-server` agent over its W3C-shaped HTTP/JSON API
 * ({@link AndroidAgentClient}). Like the macOS driver it implements only the
 * portable subset of the driver surface — its `capabilities` set is honest:
 * `query`, `interact`, `wait`, `screenshot`. Web-only verbs (navigation,
 * network, dialogs, files, downloads, script evaluation) are unsupported stubs;
 * the runner never reaches them because both the target step-compatibility check
 * and the runtime capability gate reject web-only steps for native targets.
 *
 * Selector dialect (parsed by the shared native selector engine
 * `../selector/native.ts` (PROWL-060) — the single source of truth for the
 * grammar and attribute mapping — then mapped here to an {@link AndroidQuery} the
 * agent matches on the device). Semantics mirror the macOS/iOS drivers so
 * `id=`/`label=`/`text=`/`role=` mean the same thing across native targets:
 *   id=save                      → resource-id (bare name or full `pkg:id/name`)
 *   label="Submit"               → content-desc (exact)
 *   role=android.widget.Button   → widget class name
 *   role=X[name="Save"]          → widget class + visible text (substring)
 *   text="Save" | Save           → visible text (substring)
 *
 * Compose caveat: Jetpack Compose nodes only expose a `resource-id` when the app
 * sets `Modifier.testTag(...)` together with `testTagsAsResourceId = true`;
 * otherwise prefer `text=`/`label=`.
 */
import fs from "node:fs";
import {
  parseNativeSelector,
  qualifyResourceId,
  unwrapNativeTextSelector,
  type NativeSelector
} from "../selector/native.js";
import {
  buildDirectionalSwipe,
  MAX_SCROLL_TO_SWIPES,
  probeScrollIntoView,
  scrollToProbeDistanceFor,
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

// Re-export the id-qualification rule from the shared native selector engine
// (PROWL-060), which is its single source of truth, so existing importers of
// `qualifyResourceId` from this module keep working.
export { qualifyResourceId } from "../selector/native.js";

/** A structured query the {@link AndroidAgentClient} resolves against the device. */
export type AndroidQuery =
  | { by: "id"; value: string }
  | { by: "accessibilityId"; value: string }
  | { by: "role"; role: string; name?: string }
  | { by: "text"; value: string }
  | { by: "focused" };

/**
 * A locator in the uiautomator2 server's native wire shape. The raw on-device
 * server does NOT accept W3C `{using, value}` — that translation normally lives
 * in Appium's driver layer, which we bypass — it requires `{strategy, selector}`
 * (plus a `context` field, empty for a root-scoped search). Device-verified
 * against appium-uiautomator2-server 10.6.2 (2026-08-19).
 */
export type AndroidLocator = { strategy: string; selector: string; context: string };

/**
 * The semantic transport `AndroidDriver` talks to: element lookups return opaque
 * element ids, and interactions take those ids. The HTTP/UiAutomator2
 * implementation lives in {@link ./android-agent.js}; tests fake this interface.
 */
export interface AndroidAgentClient {
  /** Resolve the first element matching `query`, or null when none match. */
  findElement(query: AndroidQuery): Promise<string | null>;
  /** Resolve every element id matching `query` (empty when none match). */
  findElements(query: AndroidQuery): Promise<string[]>;
  click(elementId: string): Promise<void>;
  /** Replace an element's text (unicode-safe; W3C `element/value`). */
  setValue(elementId: string, text: string): Promise<void>;
  getText(elementId: string): Promise<string | null>;
  /** Dispatch a global key event by Android key code (goes to the focused view). */
  pressKeyCode(keyCode: number): Promise<void>;
  /** Current screen size in pixels (uiautomator2 `/window/current/size`), for gestures. */
  windowSize(): Promise<ScreenSize>;
  /** Perform a W3C pointer action sequence (`POST /session/:id/actions`). */
  performActions(actions: PointerActionSequence): Promise<void>;
  /** Capture the current screen as PNG bytes. */
  screenshotPng(): Promise<Buffer>;
  /**
   * Return the current UI hierarchy as uiautomator2 `/source` XML. Present on
   * live clients and consumed by the analyzer (PROWL-061); optional so lighter
   * fakes that only drive/query need not implement it.
   */
  source?(): Promise<string>;
  close(): Promise<void>;
}

export type AndroidDriverOptions = {
  /** Package name, used only for the informational `currentUrl()` value. */
  appLabel?: string;
};

const ANDROID_CAPABILITIES: ReadonlySet<DriverCapability> = new Set<DriverCapability>([
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
 * Android key names accepted by the `press` step, mapped to KeyEvent key codes.
 * Names are matched case-insensitively.
 */
export const ANDROID_KEYCODES: Readonly<Record<string, number>> = {
  enter: 66,
  return: 66,
  tab: 61,
  space: 62,
  backspace: 67,
  delete: 67,
  del: 67,
  escape: 111,
  esc: 111,
  back: 4,
  home: 3,
  menu: 82,
  search: 84,
  up: 19,
  arrowup: 19,
  down: 20,
  arrowdown: 20,
  left: 21,
  arrowleft: 21,
  right: 22,
  arrowright: 22,
  pageup: 92,
  pagedown: 93
};

/** Escape a string for embedding inside a `new UiSelector()...("...")` argument. */
export function escapeUiSelectorArg(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Map a neutral {@link NativeSelector} (parsed by the shared engine) onto this
 * driver's on-device query shape. Android's `label=` targets the content-desc
 * (`accessibility id` strategy); everything else maps one-to-one.
 */
function toAndroidQuery(selector: NativeSelector): AndroidQuery {
  switch (selector.kind) {
    case "focused":
      return { by: "focused" };
    case "id":
      return { by: "id", value: selector.value };
    case "role":
      return selector.name !== undefined
        ? { by: "role", role: selector.role, name: selector.name }
        : { by: "role", role: selector.role };
    case "label":
      return { by: "accessibilityId", value: selector.value };
    case "text":
      return { by: "text", value: selector.value };
  }
}

/**
 * Parse a Prowl selector string into an {@link AndroidQuery}. Bare text matches by
 * text. The grammar (and its `label=`-in-assertions trap) is defined once in the
 * shared native selector engine ({@link parseNativeSelector}, PROWL-060); this
 * only maps the neutral result onto Android's on-device query.
 */
export function parseAndroidSelector(selector: string): AndroidQuery {
  return toAndroidQuery(parseNativeSelector(selector));
}

function locator(strategy: string, selector: string): AndroidLocator {
  return { strategy, selector, context: "" };
}

/**
 * Translate an {@link AndroidQuery} into the uiautomator2 server's native
 * locator shape. `id`/`accessibility id` are native strategies;
 * text/role(+name)/focused compose a `-android uiautomator` `UiSelector`.
 * `appPackage` qualifies bare `id=` names ({@link qualifyResourceId}).
 */
export function androidQueryToLocator(
  query: AndroidQuery,
  options: { appPackage?: string } = {}
): AndroidLocator {
  switch (query.by) {
    case "id":
      return locator("id", qualifyResourceId(query.value, options.appPackage));
    case "accessibilityId":
      // content-desc, exact match.
      return locator("accessibility id", query.value);
    case "text":
      // Visible text, substring match — mirrors the macOS `text=` semantics.
      return locator(
        "-android uiautomator",
        `new UiSelector().textContains("${escapeUiSelectorArg(query.value)}")`
      );
    case "focused":
      return locator("-android uiautomator", "new UiSelector().focused(true)");
    case "role": {
      const className = escapeUiSelectorArg(query.role);
      if (query.name === undefined || query.name.length === 0) {
        return locator("class name", query.role);
      }
      // Widget class + visible-text (substring) name. Content-desc-only names are
      // not covered by this composed form — use `label=` for those (see the
      // shared dialect's compatibility matrix in ../selector/native.ts).
      return locator(
        "-android uiautomator",
        `new UiSelector().className("${className}").textContains("${escapeUiSelectorArg(query.name)}")`
      );
    }
  }
}

/** The literal text a `text=` selector matches, else null (mirrors the web driver). */
export function unwrapAndroidTextSelector(selector: string): string | null {
  return unwrapNativeTextSelector(selector);
}

function keyCodeFor(key: string): number {
  const code = ANDROID_KEYCODES[key.trim().toLowerCase()];
  if (code === undefined) {
    throw new Error(
      `Unsupported key "${key}" for the Android target. Supported keys: ${Object.keys(ANDROID_KEYCODES)
        .sort()
        .join(", ")}.`
    );
  }
  return code;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Wrap a live {@link AndroidAgentClient} as a {@link SessionDriver}. */
export function createAndroidDriver(
  client: AndroidAgentClient,
  options: AndroidDriverOptions = {}
): SessionDriver {
  const unsupported = (verb: string): Error => new Error(`${verb} is not supported by the Android target`);
  const rejectUnsupported = (verb: string): Promise<never> => Promise.reject(unsupported(verb));

  async function resolveOne(selector: string): Promise<string> {
    const id = await client.findElement(parseAndroidSelector(selector));
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

  async function swipe(direction: SwipeDirection, amount?: number, size?: ScreenSize): Promise<void> {
    const actualSize = size ?? (await client.windowSize());
    const { actions } = buildDirectionalSwipe(direction, actualSize, amount);
    await client.performActions(actions);
  }

  return {
    capabilities: ANDROID_CAPABILITIES,

    // navigation -----------------------------------------------------------
    goto(_url: string, _options?: NavigateOptions): Promise<void> {
      return rejectUnsupported("navigate");
    },
    currentUrl(): string {
      return `android:${options.appLabel ?? ""}`;
    },

    // queries --------------------------------------------------------------
    async count(selector: string): Promise<number> {
      return (await client.findElements(parseAndroidSelector(selector))).length;
    },
    async textContent(selector: string): Promise<string | null> {
      const id = await client.findElement(parseAndroidSelector(selector));
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
      // Android key events dispatch to the focused view, so the selector is
      // advisory; callers should focus the field first (e.g. click / fill).
      await client.pressKeyCode(keyCodeFor(key));
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
    // hierarchy; otherwise use the shared bounded down/up mobile probe before
    // failing with a message naming the selector and attempts.
    async scrollIntoView(selector: string): Promise<void> {
      const query = parseAndroidSelector(selector);
      let probeSize: ScreenSize | undefined;
      const found = await probeScrollIntoView({
        isVisible: async () => (await client.findElements(query)).length > 0,
        swipe: async (direction) => {
          probeSize ??= await client.windowSize();
          await swipe(direction, scrollToProbeDistanceFor(direction, probeSize), probeSize);
        }
      });
      if (found) {
        return;
      }
      throw new Error(
        `scrollTo: element "${selector}" not visible after ${MAX_SCROLL_TO_SWIPES} scroll attempts on the Android target`
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
      return (await client.findElements({ by: "accessibilityId", value: label })).length;
    },
    async fillFirstByLabel(label: string, value: string): Promise<void> {
      const id = await client.findElement({ by: "accessibilityId", value: label });
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
      const query = parseAndroidSelector(selector);
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
      // A device screenshot is always the whole screen; `fullPage` has no
      // analogue and is intentionally ignored.
      const png = await client.screenshotPng();
      fs.writeFileSync(screenshotOptions.path, png);
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
      return unwrapAndroidTextSelector(selector);
    }
  };
}
