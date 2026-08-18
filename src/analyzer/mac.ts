/**
 * PROWL-055 / ARCH-007 — macOS analyzer.
 *
 * The native analog of {@link analyzePage}: dumps a macOS app's interactive
 * elements with ranked selector candidates so hunt authors don't have to guess
 * accessibility identifiers. It talks to the same `prowl-macdriver` helper the
 * runner uses ({@link MacHelperClient}) — reading the AX tree, the window list,
 * and (read-only) the status-item menu — and shapes the result to mirror the web
 * analyzer's feel.
 *
 * Selector ranking (best → last resort), matching the driver's selector dialect
 * so the emitted selectors are directly usable in hunts:
 *   id=<AXIdentifier>              (best — the native `data-testid`)
 *   label="<exact title/desc>"     (exact accessibility label)
 *   role=<role>[name="<name>"]     (role + accessible name)
 *   text="<substring>"             (last resort — substring match)
 *
 * Read-only: the ONLY state-changing interaction is opening the status-item menu
 * to read its items (their identifiers are gold) and immediately closing it.
 */
import type { MacHelperClient } from "../browser/mac-driver.js";

/**
 * The interactive AX roles the analyzer surfaces from the window tree. Menu
 * items are collected separately via the status-item menu; windows are listed
 * as navigable surfaces. Tuned from the roles the helper's `tree`/`openMenu`
 * payloads actually expose for controls.
 */
export const INTERACTIVE_ROLES: ReadonlySet<string> = new Set<string>([
  "AXButton",
  "AXTextField",
  "AXSecureTextField",
  "AXTextArea",
  "AXCheckBox",
  "AXRadioButton",
  "AXPopUpButton",
  "AXMenuButton",
  "AXLink",
  "AXMenuItem",
  "AXComboBox",
  "AXSlider",
  "AXDisclosureTriangle"
]);

/** Default AX-tree depth requested from the helper (deeper than the run default). */
export const DEFAULT_ANALYZE_TREE_DEPTH = 20;

/** A single element the `axInfo` snapshot describes (tree / menu / window node). */
export type MacAxNode = {
  role?: string;
  title?: string;
  description?: string;
  value?: string;
  identifier?: string;
  enabled?: boolean;
  children?: MacAxNode[];
};

/** An interactive element with ranked selector candidates (best first). */
export type MacAnalysisElement = {
  role: string;
  title?: string;
  description?: string;
  value?: string;
  identifier?: string;
  enabled?: boolean;
  /** Where the element was discovered: the app's window tree or the status menu. */
  source: "window" | "menu";
  /** Ranked selector candidates, best first. Always at least one entry. */
  selectors: string[];
};

/** A top-level window, exposed as a navigable surface with its best selector. */
export type MacAnalysisWindow = {
  title?: string;
  identifier?: string;
  /** Best selector candidate for the window. */
  selector: string;
};

export type MacAnalysisResult = {
  /** Bundle id (or the app reference) of the analyzed app. */
  app: string;
  elements: MacAnalysisElement[];
  windows: MacAnalysisWindow[];
  menuItems: MacAnalysisElement[];
};

function str(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Coerce a raw helper payload node into a typed {@link MacAxNode}. */
function toNode(raw: unknown): MacAxNode {
  const node = (raw ?? {}) as Record<string, unknown>;
  const children = Array.isArray(node.children) ? node.children.map(toNode) : undefined;
  return {
    role: str(node.role),
    title: str(node.title),
    description: str(node.description),
    value: str(node.value),
    identifier: str(node.identifier),
    enabled: typeof node.enabled === "boolean" ? node.enabled : undefined,
    ...(children ? { children } : {})
  };
}

/** Quote a selector value; the dialect strips surrounding quotes on parse. */
function quote(value: string): string {
  return `"${value}"`;
}

/**
 * Ranked selector candidates for an element, best first. Mirrors the driver's
 * selector dialect (`id=` > `label=` > `role=…[name="…"]` > `text=`). Falls back
 * to a bare `role=<role>` so every element with a role is at least addressable.
 */
export function rankMacSelectors(node: MacAxNode): string[] {
  const selectors: string[] = [];
  const identifier = node.identifier;
  const exactLabel = node.title ?? node.description;
  const name = node.title ?? node.description ?? node.value;

  if (identifier) {
    selectors.push(`id=${identifier}`);
  }
  if (exactLabel) {
    selectors.push(`label=${quote(exactLabel)}`);
  }
  if (node.role && name) {
    selectors.push(`role=${node.role}[name=${quote(name)}]`);
  }
  if (name) {
    selectors.push(`text=${quote(name)}`);
  }
  if (selectors.length === 0 && node.role) {
    selectors.push(`role=${node.role}`);
  }
  return selectors;
}

function toElement(node: MacAxNode, source: "window" | "menu"): MacAnalysisElement {
  return {
    role: node.role ?? "?",
    ...(node.title ? { title: node.title } : {}),
    ...(node.description ? { description: node.description } : {}),
    ...(node.value ? { value: node.value } : {}),
    ...(node.identifier ? { identifier: node.identifier } : {}),
    ...(node.enabled !== undefined ? { enabled: node.enabled } : {}),
    source,
    selectors: rankMacSelectors(node)
  };
}

/** Depth-first walk of the AX tree, collecting nodes with an interactive role. */
function collectInteractive(root: MacAxNode): MacAnalysisElement[] {
  const out: MacAnalysisElement[] = [];
  const visit = (node: MacAxNode): void => {
    if (node.role && INTERACTIVE_ROLES.has(node.role)) {
      out.push(toElement(node, "window"));
    }
    for (const child of node.children ?? []) {
      visit(child);
    }
  };
  visit(root);
  return out;
}

function toWindow(node: MacAxNode): MacAnalysisWindow {
  const [best] = rankMacSelectors(node);
  return {
    ...(node.title ? { title: node.title } : {}),
    ...(node.identifier ? { identifier: node.identifier } : {}),
    selector: best ?? "role=AXWindow"
  };
}

export type AnalyzeMacOptions = {
  /** Bundle id / app label to report in the result. */
  app: string;
  /** AX-tree depth to request from the helper. */
  treeDepth?: number;
  /** Timeout (seconds) for opening the status-item menu. */
  menuTimeoutSeconds?: number;
};

/**
 * Analyze an already-launched macOS app through `client`, returning its
 * interactive elements, windows, and status-menu items with ranked selectors.
 *
 * The caller owns the session lifecycle (launch + guardrails + teardown); this
 * function is read-only apart from opening and immediately closing the
 * status-item menu to read its contents.
 */
export async function analyzeMacApp(
  client: MacHelperClient,
  options: AnalyzeMacOptions
): Promise<MacAnalysisResult> {
  const depth = options.treeDepth ?? DEFAULT_ANALYZE_TREE_DEPTH;

  const treeResult = await client.request("tree", { depth });
  const elements = collectInteractive(toNode(treeResult.tree));

  const windowsResult = await client.request("windows");
  const rawWindows = Array.isArray(windowsResult.windows) ? windowsResult.windows : [];
  const windows = rawWindows.map((raw) => toWindow(toNode(raw)));

  const menuItems = await readStatusMenu(client, options.menuTimeoutSeconds);

  return { app: options.app, elements, windows, menuItems };
}

/**
 * Read the status-item menu contents (read-only): only when a status item
 * exists, open it, snapshot its items, then always close it. Any failure
 * degrades to an empty menu list rather than aborting the whole analysis.
 */
async function readStatusMenu(
  client: MacHelperClient,
  menuTimeoutSeconds?: number
): Promise<MacAnalysisElement[]> {
  let statusItems: unknown[];
  try {
    const status = await client.request("statusItems");
    statusItems = Array.isArray(status.items) ? status.items : [];
  } catch {
    return [];
  }
  if (statusItems.length === 0) {
    return [];
  }

  const params = menuTimeoutSeconds !== undefined ? { timeout: menuTimeoutSeconds } : {};
  try {
    const menu = await client.request("openMenu", params);
    const rawItems = Array.isArray(menu.items) ? menu.items : [];
    return rawItems
      .map((raw) => toNode(raw))
      .filter((node) => node.role !== "AXMenuItem" || node.title || node.identifier || node.description)
      .map((node) => toElement(node, "menu"));
  } catch {
    return [];
  } finally {
    await client.request("closeMenu").catch(() => undefined);
  }
}
