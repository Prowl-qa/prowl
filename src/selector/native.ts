/**
 * PROWL-060 / ARCH-011 — Unified native selector engine (snapshot-then-match).
 *
 * This module is the single source of truth for what Prowl's Android/iOS native
 * selector dialect (`id=` / `label=` / `text=` / `role=`, plus `:focus`) means.
 * It also carries the macOS compatibility mapping for the deferred macdriver
 * migration. Before this module the mobile dialect was defined three times over
 * — once in each mobile driver's locator translation (`androidQueryToLocator` /
 * `iosQueryToLocator`) and once in each mobile analyzer's selector ranking
 * (`rankAndroidSelectors` / `rankIosSelectors`). Consolidating the grammar, the
 * per-platform attribute mapping tables, the ranking order, and the host-side
 * matching semantics here means the mobile dialect (and its documentation,
 * including the `label=`-in-assertions trap) lives in exactly one place.
 *
 * It has three surfaces:
 *   1. {@link parseNativeSelector} — the ONE grammar that turns a Prowl selector
 *      string into a neutral `{ kind, value, roleName? }`. Both mobile drivers
 *      parse through it (then map the neutral kind onto their own wire query),
 *      so the accepted syntax can never drift between platforms.
 *   2. {@link rankNativeSelectors} + {@link NATIVE_ATTRIBUTE_MAP} — the ranking
 *      order and per-platform attribute mapping tables that the mobile
 *      analyzers' selector ranking derives from.
 *   3. {@link nodeMatchesSelector} / {@link matchNativeTree} — a dependency-free,
 *      host-side "snapshot-then-match" engine: given a parsed selector and a
 *      hierarchy node (projected from an agent's `/source` dump via
 *      {@link parseXml}), decide what matches, using each platform's real
 *      attribute + match-mode semantics. The analyzers expose this host-side (it
 *      is read-only and unit-verifiable); the runners keep their on-device
 *      matching for now (see the migration note at the foot of this file).
 *
 * =====================================================================
 * Selector compatibility matrix — web / macOS / Android / iOS
 * =====================================================================
 * How each selector kind resolves on every target. Android and iOS consume this
 * shared grammar/mapping/matcher today; macOS still uses its existing driver and
 * analyzer implementation, with migration deferred, but follows the same
 * documented selector shape. The web target speaks Playwright's own selector
 * engines and is included for contrast.
 *
 *  Kind      Web (Playwright)          macOS (AX)              Android (uiautomator2)         iOS (WebDriverAgent)
 *  --------  ------------------------  ----------------------  -----------------------------  ------------------------------
 *  id=       (use CSS `#id` /          AXIdentifier            resource-id, EXACT             accessibility id (name),
 *            `[data-testid]`)          (exact)                 (bare names are package-        EXACT
 *                                                              qualified: `save` →
 *                                                              `<pkg>:id/save`)
 *  label=    (no native kind; the      title ?? description,   content-desc, EXACT            accessibilityLabel, EXACT
 *            analyzer surfaces the      EXACT                                                  (`label == "…"`)
 *            associated <label> text)
 *  text=     Playwright text engine,   title/description/      visible text, SUBSTRING        label OR value, SUBSTRING
 *            substring, trimmed,       value, SUBSTRING        (`textContains`)               (`label CONTAINS … OR
 *            case-insensitive                                                                 value CONTAINS …`)
 *  role=     Playwright role engine    AX role (e.g.           widget class name              element type (`XCUIElementType…`;
 *            (ARIA roles)              `AXButton`)             (e.g. `android.widget.Button`) shorthand `Button` accepted)
 *  role=X    role + accessible name    role + name             class + visible-text           type + (label OR value)
 *   [name=Y] (substring)              (substring)              substring                      substring
 *  :focus    (n/a)                     focused element         `UiSelector().focused(true)`   `hasKeyboardFocus == 1`
 *
 * THE `label=`-IN-ASSERTIONS TRAP
 * -------------------------------
 * On every native target `label=` is an EXACT match on the accessibility label
 * (content-desc on Android, accessibilityLabel on iOS, title/description on
 * macOS) — unlike `text=`, which is a SUBSTRING match, and unlike the web, where
 * text-ish matching is forgiving. So a hunt author who writes an assertion like
 * `assert: selectorExists: label="Save"` expecting substring/partial behavior
 * gets nothing when the real label is "Save changes": the assertion silently
 * fails to match rather than partially matching. Reach for `text=` when you want
 * substring behavior in an assertion, and keep `label=` for the exact
 * accessibility label. On iOS there is a second, related trap: WDA's `/source`
 * exposes a single `name` attribute that is the `accessibilityIdentifier` when
 * one is set and otherwise the label. The analyzer only ranks `id=` when `name`
 * differs from `label`, so it does not recommend label-shaped ids, but matching
 * still follows WDA and resolves `id=` against `name`.
 */
import { parseXml } from "../analyzer/xml.js";

/* ===================================================================== *
 * 1. The neutral parsed selector + shared grammar
 * ===================================================================== */

/** The selector kinds the native dialect understands. */
export type NativeSelectorKind = "id" | "label" | "text" | "role" | "focused";

/**
 * A Prowl native selector parsed into a neutral, platform-independent shape.
 * `role` optionally carries a `name` (the `role=Type[name="…"]` form); `name` is
 * present only when the bracket was supplied and non-empty.
 */
export type NativeSelector =
  | { kind: "id"; value: string }
  | { kind: "label"; value: string }
  | { kind: "text"; value: string }
  | { kind: "role"; role: string; name?: string }
  | { kind: "focused" };

/**
 * Strip one layer of matching single/double quotes from a selector value. Mirrors
 * the historical per-driver `unquote`, kept here so every native target unquotes
 * identically.
 */
export function unquoteSelectorValue(value: string): string {
  const trimmed = value.trim();
  const first = trimmed[0];
  if ((first === '"' || first === "'") && trimmed.endsWith(first) && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Wrap a selector value in double quotes (the ranker's canonical emitted form). */
export function quoteSelectorValue(value: string): string {
  return `"${value}"`;
}

const ROLE_SELECTOR_RE = /^role=([A-Za-z][\w.$-]*)(?:\[name=(.+)\])?$/s;
const NATIVE_SELECTOR_PREFIX_RE = /^(id|label|text|role)=/;

function invalidSelectorMessage(selector: string, reason: string): string {
  return `Invalid native selector ${JSON.stringify(selector)}: ${reason}.`;
}

/**
 * Parse a Prowl selector string into a neutral {@link NativeSelector}. This is
 * the single grammar shared by both mobile drivers (which then map the neutral
 * kind onto their own wire query). Precedence — `:focus`, then `id=`, `role=`,
 * `label=`, `text=`, and finally a bare string treated as `text=` — matches the
 * behavior the per-driver parsers had before consolidation.
 */
export function parseNativeSelector(selector: string): NativeSelector {
  const trimmed = selector.trim();

  if (trimmed.length === 0) {
    throw new Error(
      invalidSelectorMessage(
        selector,
        "selector is empty; use id=, label=, text=, role=, :focus, or a bare text value"
      )
    );
  }

  if (trimmed === ":focus") {
    return { kind: "focused" };
  }

  const idMatch = /^id=(.+)$/s.exec(trimmed);
  if (idMatch) {
    return { kind: "id", value: unquoteSelectorValue(idMatch[1]) };
  }

  const roleMatch = ROLE_SELECTOR_RE.exec(trimmed);
  if (roleMatch) {
    const name = roleMatch[2] !== undefined ? unquoteSelectorValue(roleMatch[2]) : undefined;
    return name !== undefined && name.length > 0
      ? { kind: "role", role: roleMatch[1], name }
      : { kind: "role", role: roleMatch[1] };
  }

  const labelMatch = /^label=(.+)$/s.exec(trimmed);
  if (labelMatch) {
    return { kind: "label", value: unquoteSelectorValue(labelMatch[1]) };
  }

  const textMatch = /^text=(.+)$/s.exec(trimmed);
  if (textMatch) {
    return { kind: "text", value: unquoteSelectorValue(textMatch[1]) };
  }

  const prefix = NATIVE_SELECTOR_PREFIX_RE.exec(trimmed);
  if (prefix) {
    throw new Error(
      invalidSelectorMessage(
        selector,
        `malformed ${prefix[1]}= selector; expected id=<value>, label=<value>, text=<value>, or role=<Type>[name=<value>]`
      )
    );
  }

  return { kind: "text", value: trimmed };
}

/**
 * The literal a `text=` selector matches, or null when `selector` is not an
 * explicit `text=` form (a bare string is intentionally excluded — it mirrors the
 * web driver's `parseTextSelector`, which `forbiddenSelectors` relies on). Shared
 * so Android and iOS unwrap text selectors identically.
 */
export function unwrapNativeTextSelector(selector: string): string | null {
  const trimmed = selector.trim();
  if (!trimmed.startsWith("text=")) {
    return null;
  }
  return unquoteSelectorValue(trimmed.slice("text=".length));
}

/* ===================================================================== *
 * 2. Per-platform id/role normalization (part of the dialect)
 * ===================================================================== */

/**
 * Qualify a bare Android `resource-id` with the app's package. The raw
 * uiautomator2 server matches resource-ids exactly (bare names return no
 * elements), so `id=save` becomes `<appPackage>:id/save`. Values that already
 * contain a `:` (e.g. `android:id/title`) — or calls without a package — pass
 * through untouched. Both the Android driver's locator translation and the
 * host-side matcher qualify through this one function.
 */
export function qualifyResourceId(value: string, appPackage?: string): string {
  if (value.includes(":") || !appPackage) {
    return value;
  }
  return `${appPackage}:id/${value}`;
}

/** Prefix `XCUIElementType` onto an iOS role shorthand (e.g. `Button`) when missing. */
export function normalizeXcuiClassName(role: string): string {
  return role.startsWith("XCUIElementType") ? role : `XCUIElementType${role}`;
}

/** Strip the `XCUIElementType` prefix for a friendlier `role=` shorthand. */
export function shortIosType(type: string): string {
  return type.startsWith("XCUIElementType") ? type.slice("XCUIElementType".length) : type;
}

/* ===================================================================== *
 * 3. Ranking — the analyzers' single source of truth
 * ===================================================================== */

/**
 * The per-node ingredients the ranker needs, already projected out of a
 * platform's own node shape:
 *   - `id`    the native identifier (Android resource-id, iOS accessibility id,
 *             macOS AXIdentifier) → emitted as `id=`.
 *   - `label` the exact accessibility label (Android content-desc, iOS label,
 *             macOS title/description) → emitted as `label="…"`.
 *   - `role`  the class/type/role string to emit verbatim (already shortened for
 *             iOS) → emitted as `role=` and in `role=…[name="…"]`.
 *   - `name`  the representative visible-text name used for `role=…[name]` and
 *             the `text=` fallback.
 */
export type NativeRankFields = {
  id?: string;
  label?: string;
  role?: string;
  name?: string;
};

/**
 * Ranked selector candidates for a node, best → last resort:
 *   `id=` > `label="…"` > `role=…[name="…"]` > `text="…"`, with a bare `role=`
 * fallback so any node carrying a role stays addressable. This is the one ranking
 * algorithm every native analyzer emits through, so a change to selector priority
 * happens in exactly one place. Returns an empty array when a node exposes nothing
 * addressable.
 */
export function rankNativeSelectors(fields: NativeRankFields): string[] {
  const selectors: string[] = [];
  if (fields.id) {
    selectors.push(`id=${fields.id}`);
  }
  if (fields.label) {
    selectors.push(`label=${quoteSelectorValue(fields.label)}`);
  }
  if (fields.role && fields.name) {
    selectors.push(`role=${fields.role}[name=${quoteSelectorValue(fields.name)}]`);
  }
  if (fields.name) {
    selectors.push(`text=${quoteSelectorValue(fields.name)}`);
  }
  if (selectors.length === 0 && fields.role) {
    selectors.push(`role=${fields.role}`);
  }
  return selectors;
}

/* ===================================================================== *
 * 4. Per-platform attribute mapping tables (documentation-as-data)
 * ===================================================================== */

/** The native targets whose selector dialect this module defines. */
export type NativePlatform = "android" | "ios" | "macos";

/** How a selector kind resolves on one platform (mirrors the matrix above). */
export type SelectorKindMapping = {
  /** The native attribute(s) the kind targets. */
  attribute: string;
  /** The comparison mode against that attribute. */
  match: "exact" | "exact (package-qualified)" | "substring";
};

/**
 * The per-platform attribute mapping tables — the machine-readable form of the
 * compatibility matrix, so the mapping is documented once and can be asserted in
 * tests. Keyed by platform, then by the four addressable selector kinds. (`role`
 * describes the bare `role=` form; the `role=…[name]` composite pairs an exact
 * role with a substring name, per the matrix.)
 */
export const NATIVE_ATTRIBUTE_MAP: Readonly<
  Record<NativePlatform, Readonly<Record<"id" | "label" | "text" | "role", SelectorKindMapping>>>
> = {
  android: {
    id: { attribute: "resource-id", match: "exact (package-qualified)" },
    label: { attribute: "content-desc", match: "exact" },
    text: { attribute: "text", match: "substring" },
    role: { attribute: "class", match: "exact" }
  },
  ios: {
    id: { attribute: "accessibility id (name)", match: "exact" },
    label: { attribute: "label", match: "exact" },
    text: { attribute: "label | value", match: "substring" },
    role: { attribute: "type (XCUIElementType…)", match: "exact" }
  },
  macos: {
    id: { attribute: "AXIdentifier", match: "exact" },
    label: { attribute: "title | description", match: "exact" },
    text: { attribute: "title | description | value", match: "substring" },
    role: { attribute: "AXRole", match: "exact" }
  }
} as const;

/* ===================================================================== *
 * 5. Host-side snapshot-then-match engine
 * ===================================================================== */

/**
 * A hierarchy node projected into the neutral attributes the matcher compares
 * against. Platform code (analyzers, and later the runners/macdriver) projects
 * its own node shape into this:
 *   - `id`         native identifier for exact `id=` matching.
 *   - `label`      exact accessibility label for exact `label=` matching.
 *   - `role`       class/type/role in the platform's canonical (full) form; the
 *                  dialect's {@link NativeMatchDialect.normalizeRole} reconciles a
 *                  shorthand selector (`Button`) with a full node type.
 *   - `textValues` every string a `text=` / `[name]` substring should test
 *                  (Android: `[text]`; iOS: `[label, value]`; macOS:
 *                  `[title, description, value]`).
 *   - `focused`    whether the node currently holds keyboard focus (`:focus`).
 */
export type NativeNode = {
  id?: string;
  label?: string;
  role?: string;
  textValues: string[];
  focused?: boolean;
};

/** Options threaded into matching (currently only Android id package-qualification). */
export type NativeMatchOptions = {
  /** App package used to qualify a bare Android `id=` before an exact compare. */
  appPackage?: string;
};

/**
 * The platform-specific part of matching: how to normalize a role/type string for
 * comparison, and how to normalize an `id=` value before an exact id compare.
 * Everything else (exact id/label, substring text, focus) is platform-independent.
 */
export type NativeMatchDialect = {
  platform: NativePlatform;
  /** Canonicalize a role/type string so a shorthand selector matches a full node type. */
  normalizeRole: (role: string) => string;
  /** Canonicalize an `id=` value (Android package-qualifies bare ids; others identity). */
  normalizeId: (value: string, options: NativeMatchOptions) => string;
};

/** Android matching dialect: identity role compare, package-qualified ids. */
export const ANDROID_MATCH_DIALECT: NativeMatchDialect = {
  platform: "android",
  normalizeRole: (role) => role,
  normalizeId: (value, options) => qualifyResourceId(value, options.appPackage)
};

/** iOS matching dialect: `XCUIElementType…`-normalized role compare, identity ids. */
export const IOS_MATCH_DIALECT: NativeMatchDialect = {
  platform: "ios",
  normalizeRole: (role) => normalizeXcuiClassName(role),
  normalizeId: (value) => value
};

/** macOS matching dialect (exposed for the future macdriver migration). */
export const MACOS_MATCH_DIALECT: NativeMatchDialect = {
  platform: "macos",
  normalizeRole: (role) => role,
  normalizeId: (value) => value
};

/**
 * Decide whether a single projected {@link NativeNode} satisfies a parsed
 * {@link NativeSelector}, using the platform's attribute + match-mode semantics:
 *   - `id`      exact match on `node.id` (Android value package-qualified first).
 *   - `label`   exact match on `node.label`.
 *   - `text`    substring match against any of `node.textValues`.
 *   - `role`    exact (normalized) role match; with `name`, additionally a
 *               substring match against any of `node.textValues`.
 *   - `focused` node currently holds keyboard focus.
 */
export function nodeMatchesSelector(
  dialect: NativeMatchDialect,
  selector: NativeSelector,
  node: NativeNode,
  options: NativeMatchOptions = {}
): boolean {
  switch (selector.kind) {
    case "id":
      return node.id !== undefined && node.id === dialect.normalizeId(selector.value, options);
    case "label":
      return node.label !== undefined && node.label === selector.value;
    case "text":
      return node.textValues.some((t) => t.includes(selector.value));
    case "focused":
      return node.focused === true;
    case "role": {
      if (node.role === undefined) {
        return false;
      }
      if (dialect.normalizeRole(node.role) !== dialect.normalizeRole(selector.role)) {
        return false;
      }
      if (selector.name === undefined || selector.name.length === 0) {
        return true;
      }
      const name = selector.name;
      return node.textValues.some((t) => t.includes(name));
    }
  }
}

/**
 * Walk a hierarchy of platform nodes depth-first and collect every node matching
 * `selector`, in document order. Generic over the caller's own node type so the
 * analyzers get their original, fully-typed nodes back: pass a `project` that maps
 * a node to its {@link NativeNode} attributes and a `children` accessor.
 */
export function matchNativeTree<T>(
  dialect: NativeMatchDialect,
  selector: NativeSelector,
  root: T,
  project: (node: T) => NativeNode,
  children: (node: T) => readonly T[],
  options: NativeMatchOptions = {}
): T[] {
  const out: T[] = [];
  const visit = (node: T): void => {
    if (nodeMatchesSelector(dialect, selector, project(node), options)) {
      out.push(node);
    }
    for (const child of children(node)) {
      visit(child);
    }
  };
  visit(root);
  return out;
}

/**
 * Parse a raw agent `/source` XML dump into an element tree (best-effort, via the
 * dependency-free {@link parseXml}) so a caller can match against a snapshot
 * without a device. Returns null when the payload holds no element.
 */
export function parseSnapshot(xml: string) {
  return parseXml(xml);
}

/*
 * MIGRATION NOTE (macdriver + runners) — PROWL-060 deliberately consolidates the
 * *dialect definition* (grammar, attribute tables, ranking, and this host-side
 * matcher) without changing any observable runtime behavior. The mobile runners
 * still match on-device through their agents (uiautomator2 / WDA), which this
 * branch does not touch; and the macOS driver's own matching (`src/analyzer/
 * mac.ts` + the Swift helper) is left entirely alone. The extension points for a
 * later migration are in place: {@link MACOS_MATCH_DIALECT} plus this module's
 * matcher mean a future branch can move macdriver — or the runners' host-side
 * matching — onto this one engine and delete the remaining per-platform matching,
 * once that change can be device-verified.
 */
