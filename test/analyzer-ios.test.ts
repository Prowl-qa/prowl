import { describe, expect, it } from "vitest";
import {
  analyzeIosApp,
  rankIosSelectors,
  parseIosHierarchy,
  isIosInteractive,
  shortIosType,
  matchIosSelector,
  type IosUiSource
} from "../src/analyzer/ios.js";

/** A representative WDA `/source` dump for Settings: a window with a few controls. */
const PREFERENCES_SOURCE =
  `<?xml version="1.0" encoding="UTF-8"?>` +
  `<XCUIElementTypeApplication type="XCUIElementTypeApplication" name="Settings" label="Settings" enabled="true" visible="true">` +
  `<XCUIElementTypeWindow type="XCUIElementTypeWindow" enabled="true" visible="true">` +
  `<XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="Settings" label="Settings" value="" enabled="true" visible="true"/>` +
  `<XCUIElementTypeButton type="XCUIElementTypeButton" name="general_button" label="General" enabled="true" visible="true"/>` +
  `<XCUIElementTypeCell type="XCUIElementTypeCell" name="Wi-Fi" label="Wi-Fi" value="Not Connected" enabled="true" visible="true"/>` +
  `<XCUIElementTypeSwitch type="XCUIElementTypeSwitch" name="Airplane Mode" label="Airplane Mode" value="0" enabled="false" visible="true"/>` +
  `</XCUIElementTypeWindow>` +
  `</XCUIElementTypeApplication>`;

class FakeIosSource implements IosUiSource {
  calls = 0;
  constructor(private readonly xml: string) {}
  async source(): Promise<string> {
    this.calls += 1;
    return this.xml;
  }
}

describe("shortIosType", () => {
  it("strips the XCUIElementType prefix and passes shorthand through", () => {
    expect(shortIosType("XCUIElementTypeButton")).toBe("Button");
    expect(shortIosType("Button")).toBe("Button");
  });
});

describe("rankIosSelectors", () => {
  it("ranks id > label > role[name] > text when name is a distinct accessibility id", () => {
    expect(
      rankIosSelectors({
        type: "XCUIElementTypeButton",
        name: "general_button",
        label: "General",
        children: []
      })
    ).toEqual([
      "id=general_button",
      'label="General"',
      'role=Button[name="General"]',
      'text="General"'
    ]);
  });

  it("skips id= when name equals label (no distinct accessibility identifier)", () => {
    expect(
      rankIosSelectors({ type: "XCUIElementTypeCell", name: "Wi-Fi", label: "Wi-Fi", children: [] })
    ).toEqual(['label="Wi-Fi"', 'role=Cell[name="Wi-Fi"]', 'text="Wi-Fi"']);
  });

  it("uses value for role name / text when there is no label", () => {
    expect(
      rankIosSelectors({ type: "XCUIElementTypeStaticText", value: "typed", children: [] })
    ).toEqual(['role=StaticText[name="typed"]', 'text="typed"']);
  });

  it("falls back to a bare role selector when nothing else addresses the element", () => {
    expect(rankIosSelectors({ type: "XCUIElementTypeButton", children: [] })).toEqual(["role=Button"]);
  });

  it("returns nothing for a node with neither a type nor a name", () => {
    expect(rankIosSelectors({ children: [] })).toEqual([]);
  });
});

describe("isIosInteractive", () => {
  it("treats known control types as interactive and static text as not", () => {
    expect(isIosInteractive({ type: "XCUIElementTypeButton", children: [] })).toBe(true);
    expect(isIosInteractive({ type: "XCUIElementTypeCell", children: [] })).toBe(true);
    expect(isIosInteractive({ type: "XCUIElementTypeStaticText", children: [] })).toBe(false);
  });
});

describe("parseIosHierarchy", () => {
  it("prefers the type attribute and reads name/label/value/enabled/visible", () => {
    const root = parseIosHierarchy(PREFERENCES_SOURCE);
    expect(root?.type).toBe("XCUIElementTypeApplication");
    const window = root?.children[0];
    expect(window?.type).toBe("XCUIElementTypeWindow");
    const airplane = window?.children[3];
    expect(airplane?.label).toBe("Airplane Mode");
    expect(airplane?.enabled).toBe(false);
    expect(airplane?.visible).toBe(true);
  });
});

describe("analyzeIosApp", () => {
  it("collects interactive elements and windows with ranked selectors, skipping static text", async () => {
    const client = new FakeIosSource(PREFERENCES_SOURCE);
    const result = await analyzeIosApp(client, { app: "com.apple.Preferences" });

    expect(result.app).toBe("com.apple.Preferences");
    expect(result.elements.map((e) => e.type)).toEqual([
      "XCUIElementTypeButton",
      "XCUIElementTypeCell",
      "XCUIElementTypeSwitch"
    ]);

    const general = result.elements[0];
    expect(general.selectors[0]).toBe("id=general_button");

    const airplane = result.elements[2];
    expect(airplane.enabled).toBe(false);
    expect(airplane.selectors[0]).toBe('label="Airplane Mode"');

    expect(result.windows).toHaveLength(1);
    expect(result.windows[0].selector).toBe("role=Window");
  });

  it("reads the hierarchy exactly once and is read-only (only source())", async () => {
    const client = new FakeIosSource(PREFERENCES_SOURCE);
    await analyzeIosApp(client, { app: "com.apple.Preferences" });
    expect(client.calls).toBe(1);
  });

  it("degrades to empty elements/windows on an empty hierarchy", async () => {
    const client = new FakeIosSource("");
    const result = await analyzeIosApp(client, { app: "com.example.App" });
    expect(result.elements).toEqual([]);
    expect(result.windows).toEqual([]);
  });
});

describe("matchIosSelector (host-side snapshot-then-match, PROWL-060)", () => {
  it("matches id= only when the name is a real accessibility id (differs from label)", () => {
    const matches = matchIosSelector(PREFERENCES_SOURCE, "id=general_button");
    expect(matches).toHaveLength(1);
    expect(matches[0].label).toBe("General");
    // Wi-Fi's name equals its label, so it is NOT addressable by id= (the WDA
    // name/label conflation trap) — matching mirrors that.
    expect(matchIosSelector(PREFERENCES_SOURCE, "id=Wi-Fi")).toEqual([]);
  });

  it("normalizes a role shorthand and matches by element type", () => {
    const matches = matchIosSelector(PREFERENCES_SOURCE, "role=Button");
    expect(matches.map((n) => n.name)).toEqual(["general_button"]);
    expect(matchIosSelector(PREFERENCES_SOURCE, "role=XCUIElementTypeButton").map((n) => n.name)).toEqual([
      "general_button"
    ]);
  });

  it("matches label= exactly and text= across label OR value substrings", () => {
    expect(matchIosSelector(PREFERENCES_SOURCE, "label=Wi-Fi").map((n) => n.value)).toEqual(["Not Connected"]);
    expect(matchIosSelector(PREFERENCES_SOURCE, "text=Connected").map((n) => n.label)).toEqual(["Wi-Fi"]);
  });

  it("returns an empty array for an empty snapshot", () => {
    expect(matchIosSelector("", "id=anything")).toEqual([]);
  });
});
