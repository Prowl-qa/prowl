/**
 * PROWL-061 — iOS analyzer.
 *
 * The iOS analog of {@link analyzeMacApp}: dumps a running iOS app's interactive
 * elements (and its windows) with ranked selector candidates so hunt authors
 * don't have to guess accessibility identifiers. It reads the on-simulator UI
 * hierarchy through the same WebDriverAgent the runner uses (`GET /source`, WDA's
 * XML page source of `<XCUIElementType…>` elements) and shapes the result to
 * mirror the macOS analyzer's feel.
 *
 * Selector ranking (best → last resort), matching the iOS driver's selector
 * dialect so the emitted selectors are directly usable in hunts:
 *   id=<accessibility id>        (best — the native `data-testid`)
 *   label="<label>"              (exact accessibility label)
 *   role=<Type>[name="<text>"]   (element type + visible text, substring)
 *   text="<text>"                (last resort — label/value substring)
 *
 * Identifier caveat: WDA's page source exposes a single `name` attribute that is
 * the element's `accessibilityIdentifier` when one is set, otherwise its label.
 * We therefore rank `id=` only when `name` differs from `label`, so the analyzer
 * does not recommend label-shaped ids. Host-side matching still follows WDA's
 * `accessibility id` strategy and resolves `id=` against `name`.
 *
 * Read-only: this never taps, types, or otherwise mutates the app — it only reads
 * the page source.
 */
import {
  IOS_MATCH_DIALECT,
  matchNativeTree,
  parseNativeSelector,
  rankNativeSelectors,
  shortIosType,
  type NativeNode
} from "../selector/native.js";
import { parseXml, type XmlElement } from "./xml.js";

// Re-export the iOS type-shorthand helper from the shared native selector engine
// (PROWL-060), its single source of truth, so existing importers of
// `shortIosType` from this module keep working.
export { shortIosType } from "../selector/native.js";

/**
 * Element types treated as interactive. Tuned to the common `XCUIElementType…`
 * controls; static text and layout containers are intentionally excluded.
 */
export const IOS_INTERACTIVE_TYPES: ReadonlySet<string> = new Set<string>([
  "XCUIElementTypeButton",
  "XCUIElementTypeCell",
  "XCUIElementTypeTextField",
  "XCUIElementTypeSecureTextField",
  "XCUIElementTypeSearchField",
  "XCUIElementTypeSwitch",
  "XCUIElementTypeToggle",
  "XCUIElementTypeLink",
  "XCUIElementTypeMenuItem",
  "XCUIElementTypeSlider",
  "XCUIElementTypeStepper",
  "XCUIElementTypeTextView",
  "XCUIElementTypePickerWheel",
  "XCUIElementTypeTab",
  "XCUIElementTypeSegmentedControl",
  "XCUIElementTypeCheckBox",
  "XCUIElementTypeRadioButton",
  "XCUIElementTypeKey"
]);

/** The element type that represents a navigable window/screen surface. */
export const IOS_WINDOW_TYPE = "XCUIElementTypeWindow";

/** A single node in the WDA hierarchy (`<XCUIElementType…>` element attributes). */
export type IosUiNode = {
  type?: string;
  name?: string;
  label?: string;
  value?: string;
  enabled?: boolean;
  visible?: boolean;
  children: IosUiNode[];
};

/** An interactive element with ranked selector candidates (best first). */
export type IosAnalysisElement = {
  type: string;
  name?: string;
  label?: string;
  value?: string;
  enabled?: boolean;
  visible?: boolean;
  /** Ranked selector candidates, best first. Always at least one entry. */
  selectors: string[];
};

/** A top-level window, exposed as a navigable surface with its best selector. */
export type IosAnalysisWindow = {
  name?: string;
  label?: string;
  /** Best selector candidate for the window. */
  selector: string;
};

export type IosAnalysisResult = {
  /** Bundle id of the analyzed app. */
  app: string;
  elements: IosAnalysisElement[];
  windows: IosAnalysisWindow[];
};

function str(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function bool(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value === "true" || value === "1";
}

/** Coerce a raw {@link XmlElement} into a typed {@link IosUiNode}. */
function toIosNode(element: XmlElement): IosUiNode {
  const a = element.attrs;
  // WDA carries the element type both as the tag name and a `type` attribute;
  // prefer the attribute and fall back to the tag.
  return {
    type: str(a.type) ?? str(element.tag),
    name: str(a.name),
    label: str(a.label),
    value: str(a.value),
    enabled: bool(a.enabled),
    visible: bool(a.visible),
    children: element.children.map(toIosNode)
  };
}

/** Parse a WDA `/source` XML dump into a tree of {@link IosUiNode}. */
export function parseIosHierarchy(xml: string): IosUiNode | null {
  const root = parseXml(xml);
  return root ? toIosNode(root) : null;
}

/** Whether `name` looks like a distinct accessibility identifier (not the label). */
function hasAccessibilityId(node: IosUiNode): boolean {
  return node.name !== undefined && node.name !== node.label;
}

/**
 * Ranked selector candidates for a node, best first, via the shared native
 * selector engine (PROWL-060). The iOS attribute mapping is applied here — `id=`←
 * accessibility id (the `name` attribute, but only when it differs from the label;
 * see the caveat above), `label=`←label, `role=`←the short element type, name←
 * `label ?? value` — then {@link rankNativeSelectors} imposes the shared `id=` >
 * `label=` > `role=…[name]` > `text=` order (with a bare `role=` fallback).
 */
export function rankIosSelectors(node: IosUiNode): string[] {
  return rankNativeSelectors({
    id: hasAccessibilityId(node) ? node.name : undefined,
    label: node.label,
    role: node.type ? shortIosType(node.type) : undefined,
    name: node.label ?? node.value
  });
}

/**
 * Project an {@link IosUiNode} into the neutral {@link NativeNode} the shared
 * matcher compares against: `id`←name (matching WDA's `accessibility id`
 * strategy even when it equals the label), `label`←label, `role`←the full
 * element type (the dialect normalizes a `Button` shorthand against it), and both
 * label and value as `text=` substring sources.
 */
export function iosNodeToNative(node: IosUiNode): NativeNode {
  const textValues: string[] = [];
  if (node.label !== undefined) {
    textValues.push(node.label);
  }
  if (node.value !== undefined) {
    textValues.push(node.value);
  }
  return {
    ...(node.name !== undefined ? { id: node.name } : {}),
    ...(node.label !== undefined ? { label: node.label } : {}),
    ...(node.type !== undefined ? { role: node.type } : {}),
    textValues
  };
}

/**
 * Host-side "snapshot-then-match": parse a WebDriverAgent `/source` dump and
 * return every node the Prowl `selector` resolves to, in document order, using
 * iOS's shared dialect semantics. Read-only and device-free. Exposed for tooling
 * and a future runner/macdriver migration; the runner still matches on-device.
 */
export function matchIosSelector(xml: string, selector: string): IosUiNode[] {
  const parsedSelector = parseNativeSelector(selector);
  const root = parseIosHierarchy(xml);
  if (!root) {
    return [];
  }
  return matchNativeTree(
    IOS_MATCH_DIALECT,
    parsedSelector,
    root,
    iosNodeToNative,
    (node) => node.children
  );
}

function toElement(node: IosUiNode): IosAnalysisElement {
  return {
    type: node.type ?? "?",
    ...(node.name ? { name: node.name } : {}),
    ...(node.label ? { label: node.label } : {}),
    ...(node.value ? { value: node.value } : {}),
    ...(node.enabled !== undefined ? { enabled: node.enabled } : {}),
    ...(node.visible !== undefined ? { visible: node.visible } : {}),
    selectors: rankIosSelectors(node)
  };
}

function toWindow(node: IosUiNode): IosAnalysisWindow {
  const [best] = rankIosSelectors(node);
  return {
    ...(node.name ? { name: node.name } : {}),
    ...(node.label ? { label: node.label } : {}),
    selector: best ?? `role=${shortIosType(IOS_WINDOW_TYPE)}`
  };
}

/** Whether a node is worth surfacing as an interactive element. */
export function isIosInteractive(node: IosUiNode): boolean {
  return node.type !== undefined && IOS_INTERACTIVE_TYPES.has(node.type);
}

/** Depth-first walk collecting interactive elements and windows in tree order. */
function collect(root: IosUiNode): { elements: IosAnalysisElement[]; windows: IosAnalysisWindow[] } {
  const elements: IosAnalysisElement[] = [];
  const windows: IosAnalysisWindow[] = [];
  const visit = (node: IosUiNode): void => {
    if (node.type === IOS_WINDOW_TYPE) {
      windows.push(toWindow(node));
    }
    if (isIosInteractive(node)) {
      elements.push(toElement(node));
    }
    for (const child of node.children) {
      visit(child);
    }
  };
  visit(root);
  return { elements, windows };
}

/** The minimal transport the iOS analyzer needs: read the UI hierarchy XML. */
export interface IosUiSource {
  /** Return the current UI hierarchy as WebDriverAgent `/source` XML. */
  source(): Promise<string>;
}

export type AnalyzeIosOptions = {
  /** Bundle id to report in the result. */
  app: string;
};

/**
 * Analyze an already-launched iOS app through `client`, returning its interactive
 * elements and windows with ranked selectors.
 *
 * The caller owns the session lifecycle (launch + guardrails + teardown); this
 * function is strictly read-only — it only reads the page source.
 */
export async function analyzeIosApp(
  client: IosUiSource,
  options: AnalyzeIosOptions
): Promise<IosAnalysisResult> {
  const xml = await client.source();
  const root = parseIosHierarchy(xml);
  if (!root) {
    return { app: options.app, elements: [], windows: [] };
  }
  const { elements, windows } = collect(root);
  return { app: options.app, elements, windows };
}
