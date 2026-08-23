/**
 * PROWL-061 — Android analyzer.
 *
 * The Android analog of {@link analyzeMacApp}: dumps a running Android app's
 * interactive elements with ranked selector candidates so hunt authors don't have
 * to guess resource-ids. It reads the on-device UI hierarchy through the same
 * uiautomator2 agent the runner uses (`GET /source`, the standard `uiautomator
 * dump` XML) and shapes the result to mirror the macOS analyzer's feel.
 *
 * Selector ranking (best → last resort), matching the Android driver's selector
 * dialect so the emitted selectors are directly usable in hunts:
 *   id=<resource-id>             (best — the native `data-testid`; already
 *                                 package-qualified in the dump, e.g.
 *                                 `com.android.settings:id/title`)
 *   label="<content-desc>"       (exact content-description)
 *   role=<class>[name="<text>"]  (widget class + visible text, substring)
 *   text="<text>"                (last resort — visible-text substring)
 *
 * Read-only: this never taps, types, or otherwise mutates the app — it only reads
 * the page source.
 */
import { parseXml, type XmlElement } from "./xml.js";

/**
 * Widget classes treated as interactive on their own (in addition to any node
 * flagged clickable / long-clickable / checkable / scrollable). Tuned to the
 * common `android.widget` / AndroidX input and control classes; text/containers
 * without an interactive flag are surfaced only when clickable.
 */
export const ANDROID_INTERACTIVE_CLASSES: ReadonlySet<string> = new Set<string>([
  "android.widget.Button",
  "android.widget.ImageButton",
  "android.widget.EditText",
  "android.widget.CheckBox",
  "android.widget.RadioButton",
  "android.widget.Switch",
  "android.widget.ToggleButton",
  "android.widget.Spinner",
  "android.widget.SeekBar",
  "android.widget.RatingBar",
  "android.widget.CompoundButton",
  "android.widget.AutoCompleteTextView",
  "android.widget.MultiAutoCompleteTextView",
  "android.widget.CheckedTextView",
  "androidx.appcompat.widget.SwitchCompat",
  "androidx.appcompat.widget.AppCompatButton",
  "androidx.appcompat.widget.AppCompatEditText"
]);

/** A single node in the uiautomator hierarchy (`<node>` element attributes). */
export type AndroidUiNode = {
  className?: string;
  resourceId?: string;
  contentDesc?: string;
  text?: string;
  package?: string;
  clickable?: boolean;
  longClickable?: boolean;
  checkable?: boolean;
  checked?: boolean;
  scrollable?: boolean;
  focusable?: boolean;
  enabled?: boolean;
  children: AndroidUiNode[];
};

/** An interactive element with ranked selector candidates (best first). */
export type AndroidAnalysisElement = {
  className: string;
  resourceId?: string;
  contentDesc?: string;
  text?: string;
  clickable?: boolean;
  checkable?: boolean;
  scrollable?: boolean;
  enabled?: boolean;
  /** Ranked selector candidates, best first. Always at least one entry. */
  selectors: string[];
};

export type AndroidAnalysisResult = {
  /** Package name of the analyzed app. */
  app: string;
  elements: AndroidAnalysisElement[];
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
  return value === "true";
}

/** Coerce a raw `<node>` {@link XmlElement} into a typed {@link AndroidUiNode}. */
function toAndroidNode(element: XmlElement): AndroidUiNode {
  const a = element.attrs;
  return {
    className: str(a["class"]),
    resourceId: str(a["resource-id"]),
    contentDesc: str(a["content-desc"]),
    text: str(a.text),
    package: str(a.package),
    clickable: bool(a.clickable),
    longClickable: bool(a["long-clickable"]),
    checkable: bool(a.checkable),
    checked: bool(a.checked),
    scrollable: bool(a.scrollable),
    focusable: bool(a.focusable),
    enabled: bool(a.enabled),
    children: element.children.map(toAndroidNode)
  };
}

/** Parse a uiautomator2 `/source` XML dump into a tree of {@link AndroidUiNode}. */
export function parseAndroidHierarchy(xml: string): AndroidUiNode | null {
  const root = parseXml(xml);
  return root ? toAndroidNode(root) : null;
}

/** Quote a selector value; the dialect strips surrounding quotes on parse. */
function quote(value: string): string {
  return `"${value}"`;
}

/** Whether a node is worth surfacing as an interactive element. */
export function isAndroidInteractive(node: AndroidUiNode): boolean {
  if (node.clickable || node.longClickable || node.checkable || node.scrollable) {
    return true;
  }
  return node.className !== undefined && ANDROID_INTERACTIVE_CLASSES.has(node.className);
}

/**
 * Ranked selector candidates for a node, best first. Mirrors the Android driver's
 * selector dialect (`id=` > `label=` > `role=…[name="…"]` > `text=`). The dump's
 * `resource-id` is already package-qualified, so `id=` is emitted verbatim. Falls
 * back to a bare `role=<class>` so every node with a class stays addressable.
 */
export function rankAndroidSelectors(node: AndroidUiNode): string[] {
  const selectors: string[] = [];
  if (node.resourceId) {
    selectors.push(`id=${node.resourceId}`);
  }
  if (node.contentDesc) {
    selectors.push(`label=${quote(node.contentDesc)}`);
  }
  if (node.className && node.text) {
    selectors.push(`role=${node.className}[name=${quote(node.text)}]`);
  }
  if (node.text) {
    selectors.push(`text=${quote(node.text)}`);
  }
  if (selectors.length === 0 && node.className) {
    selectors.push(`role=${node.className}`);
  }
  return selectors;
}

function toElement(node: AndroidUiNode): AndroidAnalysisElement {
  return {
    className: node.className ?? "?",
    ...(node.resourceId ? { resourceId: node.resourceId } : {}),
    ...(node.contentDesc ? { contentDesc: node.contentDesc } : {}),
    ...(node.text ? { text: node.text } : {}),
    ...(node.clickable !== undefined ? { clickable: node.clickable } : {}),
    ...(node.checkable !== undefined ? { checkable: node.checkable } : {}),
    ...(node.scrollable !== undefined ? { scrollable: node.scrollable } : {}),
    ...(node.enabled !== undefined ? { enabled: node.enabled } : {}),
    selectors: rankAndroidSelectors(node)
  };
}

/** Depth-first walk of the hierarchy, collecting interactive nodes in tree order. */
function collectInteractive(root: AndroidUiNode): AndroidAnalysisElement[] {
  const out: AndroidAnalysisElement[] = [];
  const visit = (node: AndroidUiNode): void => {
    if (isAndroidInteractive(node)) {
      out.push(toElement(node));
    }
    for (const child of node.children) {
      visit(child);
    }
  };
  visit(root);
  return out;
}

/** The minimal transport the Android analyzer needs: read the UI hierarchy XML. */
export interface AndroidUiSource {
  /** Return the current UI hierarchy as uiautomator2 `/source` XML. */
  source(): Promise<string>;
}

export type AnalyzeAndroidOptions = {
  /** Package name to report in the result. */
  app: string;
};

/**
 * Analyze an already-launched Android app through `client`, returning its
 * interactive elements with ranked selectors.
 *
 * The caller owns the session lifecycle (launch + guardrails + teardown); this
 * function is strictly read-only — it only reads the page source.
 */
export async function analyzeAndroidApp(
  client: AndroidUiSource,
  options: AnalyzeAndroidOptions
): Promise<AndroidAnalysisResult> {
  const xml = await client.source();
  const root = parseAndroidHierarchy(xml);
  const elements = root ? collectInteractive(root) : [];
  return { app: options.app, elements };
}
