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
 * Selector dialect (parsed here into an {@link AndroidQuery}; the agent then
 * matches on the device). Semantics mirror the macOS driver so `id=`/`label=`/
 * `text=`/`role=` mean the same thing on both native targets (PROWL-060 will
 * unify the engines later):
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
import type {
  DialogAction,
  DriverCapability,
  DriverDownload,
  DriverResponse,
  DriverRoute,
  NavigateOptions,
  SessionDriver
} from "./driver.js";

/** A structured query the {@link AndroidAgentClient} resolves against the device. */
export type AndroidQuery =
  | { by: "id"; value: string }
  | { by: "accessibilityId"; value: string }
  | { by: "role"; role: string; name?: string }
  | { by: "text"; value: string }
  | { by: "focused" };

/** A W3C locator strategy ({@code using}) + its value, as the agent expects. */
export type AndroidLocator = { using: string; value: string };

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
  /** Capture the current screen as PNG bytes. */
  screenshotPng(): Promise<Buffer>;
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

function unquote(value: string): string {
  const trimmed = value.trim();
  const first = trimmed[0];
  if ((first === '"' || first === "'") && trimmed.endsWith(first) && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Escape a string for embedding inside a `new UiSelector()...("...")` argument. */
export function escapeUiSelectorArg(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Parse a Prowl selector string into an {@link AndroidQuery}. Bare text matches by text. */
export function parseAndroidSelector(selector: string): AndroidQuery {
  const trimmed = selector.trim();

  if (trimmed === ":focus") {
    return { by: "focused" };
  }

  const idMatch = /^id=(.+)$/s.exec(trimmed);
  if (idMatch) {
    return { by: "id", value: unquote(idMatch[1]) };
  }

  const roleMatch = /^role=([A-Za-z][\w.$-]*)(?:\[name=(.+)\])?$/s.exec(trimmed);
  if (roleMatch) {
    const name = roleMatch[2] !== undefined ? unquote(roleMatch[2]) : undefined;
    return name !== undefined && name.length > 0
      ? { by: "role", role: roleMatch[1], name }
      : { by: "role", role: roleMatch[1] };
  }

  const labelMatch = /^label=(.+)$/s.exec(trimmed);
  if (labelMatch) {
    return { by: "accessibilityId", value: unquote(labelMatch[1]) };
  }

  const textMatch = /^text=(.+)$/s.exec(trimmed);
  if (textMatch) {
    return { by: "text", value: unquote(textMatch[1]) };
  }

  return { by: "text", value: trimmed };
}

/**
 * Translate an {@link AndroidQuery} into a W3C locator strategy the
 * uiautomator2 agent accepts. `id`/`accessibility id` are native strategies;
 * text/role(+name)/focused compose a `-android uiautomator` `UiSelector`.
 */
export function androidQueryToLocator(query: AndroidQuery): AndroidLocator {
  switch (query.by) {
    case "id":
      // The agent's `id` strategy matches either a bare id name or a fully
      // qualified `pkg:id/name` resource-id.
      return { using: "id", value: query.value };
    case "accessibilityId":
      // content-desc, exact match.
      return { using: "accessibility id", value: query.value };
    case "text":
      // Visible text, substring match — mirrors the macOS `text=` semantics.
      return {
        using: "-android uiautomator",
        value: `new UiSelector().textContains("${escapeUiSelectorArg(query.value)}")`
      };
    case "focused":
      return { using: "-android uiautomator", value: "new UiSelector().focused(true)" };
    case "role": {
      const className = escapeUiSelectorArg(query.role);
      if (query.name === undefined || query.name.length === 0) {
        return { using: "class name", value: query.role };
      }
      // Widget class + visible-text (substring) name. Content-desc-only names are
      // not covered by this composed form — use `label=` for those. PROWL-060.
      return {
        using: "-android uiautomator",
        value: `new UiSelector().className("${className}").textContains("${escapeUiSelectorArg(query.name)}")`
      };
    }
  }
}

/** The literal text a `text=` selector matches, else null (mirrors the web driver). */
export function unwrapAndroidTextSelector(selector: string): string | null {
  const trimmed = selector.trim();
  if (!trimmed.startsWith("text=")) {
    return null;
  }
  return unquote(trimmed.slice(5));
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
    scrollIntoView(): Promise<void> {
      // Scroll gestures are a follow-up (PROWL-061); reject clearly for now.
      return rejectUnsupported("scrollTo");
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
