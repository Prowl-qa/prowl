import { describe, expect, it } from "vitest";
import {
  ANDROID_MATCH_DIALECT,
  IOS_MATCH_DIALECT,
  MACOS_MATCH_DIALECT,
  NATIVE_ATTRIBUTE_MAP,
  matchNativeTree,
  nodeMatchesSelector,
  normalizeXcuiClassName,
  parseNativeSelector,
  parseSnapshot,
  qualifyResourceId,
  quoteSelectorValue,
  rankNativeSelectors,
  shortIosType,
  unquoteSelectorValue,
  unwrapNativeTextSelector,
  type NativeNode,
  type NativeSelector
} from "../src/selector/native.js";

describe("parseNativeSelector (shared grammar, PROWL-060)", () => {
  it("parses :focus", () => {
    expect(parseNativeSelector(":focus")).toEqual({ kind: "focused" });
    expect(parseNativeSelector("  :focus  ")).toEqual({ kind: "focused" });
  });

  it("parses id= with and without quotes", () => {
    expect(parseNativeSelector("id=save")).toEqual({ kind: "id", value: "save" });
    expect(parseNativeSelector('id="save"')).toEqual({ kind: "id", value: "save" });
    expect(parseNativeSelector("id=com.example:id/save")).toEqual({
      kind: "id",
      value: "com.example:id/save"
    });
  });

  it("parses label= as an exact value", () => {
    expect(parseNativeSelector('label="Submit"')).toEqual({ kind: "label", value: "Submit" });
    expect(parseNativeSelector("label=Submit")).toEqual({ kind: "label", value: "Submit" });
  });

  it("parses text= and treats a bare string as text", () => {
    expect(parseNativeSelector('text="Save"')).toEqual({ kind: "text", value: "Save" });
    expect(parseNativeSelector("text=Welcome")).toEqual({ kind: "text", value: "Welcome" });
    expect(parseNativeSelector("Just some label")).toEqual({ kind: "text", value: "Just some label" });
  });

  it("parses role= bare and role=…[name=…], dropping an empty name bracket", () => {
    expect(parseNativeSelector("role=android.widget.Button")).toEqual({
      kind: "role",
      role: "android.widget.Button"
    });
    expect(parseNativeSelector('role=Button[name="Save"]')).toEqual({
      kind: "role",
      role: "Button",
      name: "Save"
    });
    // An empty name bracket collapses to a bare role (no `name` key).
    expect(parseNativeSelector('role=Button[name=""]')).toEqual({ kind: "role", role: "Button" });
  });

  it("rejects empty selectors and malformed recognized prefixes", () => {
    const expectedEmpty =
      'Invalid native selector "   ": selector is empty; ' +
      "use id=, label=, text=, role=, :focus, or a bare text value.";
    const expectedMalformed = (selector: string, prefix: string): string =>
      `Invalid native selector ${JSON.stringify(selector)}: malformed ${prefix}= selector; ` +
      "expected id=<value>, label=<value>, text=<value>, or role=<Type>[name=<value>].";

    expect(() => parseNativeSelector("   ")).toThrow(expectedEmpty);
    expect(() => parseNativeSelector("id=")).toThrow(expectedMalformed("id=", "id"));
    expect(() => parseNativeSelector("label=")).toThrow(expectedMalformed("label=", "label"));
    expect(() => parseNativeSelector("text=")).toThrow(expectedMalformed("text=", "text"));
    expect(() => parseNativeSelector('role=Button[nme="Save"]')).toThrow(
      expectedMalformed('role=Button[nme="Save"]', "role")
    );
  });
});

describe("quote/unquote helpers", () => {
  it("unquotes matching single or double quotes only", () => {
    expect(unquoteSelectorValue('"Save"')).toBe("Save");
    expect(unquoteSelectorValue("'Save'")).toBe("Save");
    expect(unquoteSelectorValue("Save")).toBe("Save");
    expect(unquoteSelectorValue('"mismatched')).toBe('"mismatched');
  });

  it("quotes with double quotes", () => {
    expect(quoteSelectorValue("Save")).toBe('"Save"');
  });

  it("unwrapNativeTextSelector unwraps only explicit text= (not a bare string)", () => {
    expect(unwrapNativeTextSelector('text="Save"')).toBe("Save");
    expect(unwrapNativeTextSelector("text=Save")).toBe("Save");
    expect(unwrapNativeTextSelector("Save")).toBeNull();
    expect(unwrapNativeTextSelector("id=save")).toBeNull();
  });
});

describe("id/role normalization", () => {
  it("qualifyResourceId package-qualifies bare ids only", () => {
    expect(qualifyResourceId("save", "com.app")).toBe("com.app:id/save");
    expect(qualifyResourceId("android:id/title", "com.app")).toBe("android:id/title");
    expect(qualifyResourceId("save")).toBe("save");
  });

  it("normalizeXcuiClassName / shortIosType round-trip the type prefix", () => {
    expect(normalizeXcuiClassName("Button")).toBe("XCUIElementTypeButton");
    expect(normalizeXcuiClassName("XCUIElementTypeSwitch")).toBe("XCUIElementTypeSwitch");
    expect(shortIosType("XCUIElementTypeButton")).toBe("Button");
    expect(shortIosType("Button")).toBe("Button");
  });
});

describe("rankNativeSelectors (shared ranking)", () => {
  it("ranks id > label > role[name] > text", () => {
    expect(
      rankNativeSelectors({ id: "com.example:id/save", label: "Save", role: "android.widget.Button", name: "Save" })
    ).toEqual([
      "id=com.example:id/save",
      'label="Save"',
      'role=android.widget.Button[name="Save"]',
      'text="Save"'
    ]);
  });

  it("falls back to a bare role only when nothing else addresses the node", () => {
    expect(rankNativeSelectors({ role: "Button" })).toEqual(["role=Button"]);
    expect(rankNativeSelectors({ role: "Button", name: "Go" })).toEqual([
      'role=Button[name="Go"]',
      'text="Go"'
    ]);
  });

  it("returns nothing for a node exposing no addressable attribute", () => {
    expect(rankNativeSelectors({})).toEqual([]);
  });
});

describe("NATIVE_ATTRIBUTE_MAP (documentation-as-data)", () => {
  it("records the match mode for each kind per platform", () => {
    expect(NATIVE_ATTRIBUTE_MAP.android.id).toEqual({
      attribute: "resource-id",
      match: "exact (package-qualified)"
    });
    expect(NATIVE_ATTRIBUTE_MAP.android.text.match).toBe("substring");
    expect(NATIVE_ATTRIBUTE_MAP.ios.id.attribute).toBe("accessibility id (name)");
    expect(NATIVE_ATTRIBUTE_MAP.ios.label.match).toBe("exact");
    expect(NATIVE_ATTRIBUTE_MAP.ios.text).toEqual({ attribute: "label | value", match: "substring" });
    expect(NATIVE_ATTRIBUTE_MAP.macos.role.attribute).toBe("AXRole");
  });
});

describe("nodeMatchesSelector — Android dialect", () => {
  const node: NativeNode = {
    id: "com.app:id/save",
    label: "Save",
    role: "android.widget.Button",
    textValues: ["Save changes"]
  };

  it("matches id= exactly, package-qualifying a bare selector id", () => {
    expect(
      nodeMatchesSelector(ANDROID_MATCH_DIALECT, parseNativeSelector("id=save"), node, {
        appPackage: "com.app"
      })
    ).toBe(true);
    expect(
      nodeMatchesSelector(ANDROID_MATCH_DIALECT, parseNativeSelector("id=save"), node)
    ).toBe(false); // no package → bare "save" ≠ "com.app:id/save"
  });

  it("matches label= exactly (not as a substring)", () => {
    expect(nodeMatchesSelector(ANDROID_MATCH_DIALECT, parseNativeSelector("label=Save"), node)).toBe(true);
    // The label= trap: an exact label match, so "Save changes" is NOT matched by label="Save".
    const changes: NativeNode = { ...node, label: "Save changes" };
    expect(nodeMatchesSelector(ANDROID_MATCH_DIALECT, parseNativeSelector("label=Save"), changes)).toBe(false);
  });

  it("matches text= as a substring over textValues", () => {
    expect(nodeMatchesSelector(ANDROID_MATCH_DIALECT, parseNativeSelector("text=changes"), node)).toBe(true);
    expect(nodeMatchesSelector(ANDROID_MATCH_DIALECT, parseNativeSelector("text=nope"), node)).toBe(false);
  });

  it("matches role= exactly and role=…[name] as class + substring", () => {
    expect(
      nodeMatchesSelector(ANDROID_MATCH_DIALECT, parseNativeSelector("role=android.widget.Button"), node)
    ).toBe(true);
    expect(
      nodeMatchesSelector(ANDROID_MATCH_DIALECT, parseNativeSelector('role=android.widget.Button[name="changes"]'), node)
    ).toBe(true);
    expect(
      nodeMatchesSelector(ANDROID_MATCH_DIALECT, parseNativeSelector('role=android.widget.Button[name="nope"]'), node)
    ).toBe(false);
    expect(nodeMatchesSelector(ANDROID_MATCH_DIALECT, parseNativeSelector("role=android.widget.TextView"), node)).toBe(
      false
    );
  });

  it("matches :focus only when the node holds focus", () => {
    expect(nodeMatchesSelector(ANDROID_MATCH_DIALECT, parseNativeSelector(":focus"), node)).toBe(false);
    expect(
      nodeMatchesSelector(ANDROID_MATCH_DIALECT, parseNativeSelector(":focus"), { ...node, focused: true })
    ).toBe(true);
  });
});

describe("nodeMatchesSelector — iOS dialect", () => {
  const node: NativeNode = {
    id: "save_button",
    label: "Save",
    role: "XCUIElementTypeButton",
    textValues: ["Save", "current"]
  };

  it("normalizes a role shorthand against the full element type", () => {
    expect(nodeMatchesSelector(IOS_MATCH_DIALECT, parseNativeSelector("role=Button"), node)).toBe(true);
    expect(
      nodeMatchesSelector(IOS_MATCH_DIALECT, parseNativeSelector("role=XCUIElementTypeButton"), node)
    ).toBe(true);
    expect(nodeMatchesSelector(IOS_MATCH_DIALECT, parseNativeSelector("role=Cell"), node)).toBe(false);
  });

  it("matches text= across both label and value substrings; id= is not qualified", () => {
    expect(nodeMatchesSelector(IOS_MATCH_DIALECT, parseNativeSelector("text=curr"), node)).toBe(true);
    expect(nodeMatchesSelector(IOS_MATCH_DIALECT, parseNativeSelector("id=save_button"), node)).toBe(true);
    expect(nodeMatchesSelector(IOS_MATCH_DIALECT, parseNativeSelector("id=save"), node)).toBe(false);
  });
});

describe("matchNativeTree", () => {
  type T = NativeNode & { children: T[] };
  const tree: T = {
    role: "root",
    textValues: [],
    children: [
      { id: "a", role: "android.widget.Button", textValues: ["First"], children: [] },
      {
        role: "group",
        textValues: [],
        children: [{ id: "a", role: "android.widget.Button", textValues: ["Second"], children: [] }]
      }
    ]
  };

  it("collects every matching node in document order", () => {
    const matches = matchNativeTree(
      ANDROID_MATCH_DIALECT,
      parseNativeSelector("id=a"),
      tree,
      (n) => n,
      (n) => n.children
    );
    expect(matches.map((n) => n.textValues[0])).toEqual(["First", "Second"]);
  });

  it("returns an empty array when nothing matches", () => {
    const matches = matchNativeTree(
      ANDROID_MATCH_DIALECT,
      parseNativeSelector("id=missing"),
      tree,
      (n) => n,
      (n) => n.children
    );
    expect(matches).toEqual([]);
  });
});

describe("parseSnapshot + MACOS_MATCH_DIALECT", () => {
  it("parseSnapshot returns the root element (or null on empty input)", () => {
    const root = parseSnapshot('<hierarchy><node class="X"/></hierarchy>');
    expect(root?.tag).toBe("hierarchy");
    expect(parseSnapshot("")).toBeNull();
  });

  it("exposes a macOS matching dialect for the future migration", () => {
    const node: NativeNode = { role: "AXButton", label: "OK", textValues: ["OK"] };
    expect(nodeMatchesSelector(MACOS_MATCH_DIALECT, parseNativeSelector("role=AXButton"), node)).toBe(true);
    expect(nodeMatchesSelector(MACOS_MATCH_DIALECT, parseNativeSelector("label=OK"), node)).toBe(true);
  });
});

describe("parse → shape sanity", () => {
  it("every selector kind round-trips to a discriminated union member", () => {
    const kinds = ["id=x", "label=x", "text=x", "role=X", ":focus"].map(parseNativeSelector);
    const asKinds = kinds.map((s: NativeSelector) => s.kind);
    expect(asKinds).toEqual(["id", "label", "text", "role", "focused"]);
  });
});
