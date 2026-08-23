import { describe, expect, it } from "vitest";
import {
  analyzeAndroidApp,
  rankAndroidSelectors,
  parseAndroidHierarchy,
  isAndroidInteractive,
  matchAndroidSelector,
  type AndroidUiSource
} from "../src/analyzer/android.js";

/** A representative uiautomator2 `/source` dump: a mix of interactive + noise nodes. */
const SETTINGS_SOURCE =
  `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>` +
  `<hierarchy rotation="0">` +
  `<node index="0" class="android.widget.FrameLayout" package="com.android.settings" clickable="false" enabled="true">` +
  `<node index="0" text="Settings" class="android.widget.TextView" resource-id="android:id/title" clickable="false" enabled="true"/>` +
  `<node index="1" text="Search settings" resource-id="com.android.settings:id/search_action_bar_title" class="android.widget.TextView" content-desc="Search settings" clickable="true" enabled="true"/>` +
  `<node index="2" class="androidx.recyclerview.widget.RecyclerView" resource-id="com.android.settings:id/recycler_view" scrollable="true" clickable="false" enabled="true">` +
  `<node index="0" text="Network &amp; internet" class="android.widget.LinearLayout" clickable="true" enabled="true"/>` +
  `<node index="1" text="" class="android.widget.Switch" resource-id="com.android.settings:id/switch_widget" checkable="true" checked="false" clickable="true" enabled="false"/>` +
  `</node>` +
  `</node>` +
  `</hierarchy>`;

class FakeAndroidSource implements AndroidUiSource {
  calls = 0;
  constructor(private readonly xml: string) {}
  async source(): Promise<string> {
    this.calls += 1;
    return this.xml;
  }
}

describe("rankAndroidSelectors", () => {
  it("ranks id > label > role[name] > text", () => {
    expect(
      rankAndroidSelectors({
        className: "android.widget.Button",
        resourceId: "com.example:id/save",
        contentDesc: "Save",
        text: "Save",
        children: []
      })
    ).toEqual([
      "id=com.example:id/save",
      'label="Save"',
      'role=android.widget.Button[name="Save"]',
      'text="Save"'
    ]);
  });

  it("emits the package-qualified resource-id verbatim (already qualified in the dump)", () => {
    expect(
      rankAndroidSelectors({ resourceId: "com.android.settings:id/foo", children: [] })[0]
    ).toBe("id=com.android.settings:id/foo");
  });

  it("uses content-desc for label and text for role name / text", () => {
    expect(
      rankAndroidSelectors({
        className: "android.widget.LinearLayout",
        contentDesc: "Wi-Fi",
        text: "Network",
        children: []
      })
    ).toEqual([
      'label="Wi-Fi"',
      'role=android.widget.LinearLayout[name="Network"]',
      'text="Network"'
    ]);
  });

  it("falls back to a bare role selector when nothing else addresses the node", () => {
    expect(rankAndroidSelectors({ className: "android.widget.Button", children: [] })).toEqual([
      "role=android.widget.Button"
    ]);
  });

  it("returns nothing for a node with neither a class nor any name", () => {
    expect(rankAndroidSelectors({ children: [] })).toEqual([]);
  });
});

describe("isAndroidInteractive", () => {
  it("treats clickable / checkable / scrollable / long-clickable nodes as interactive", () => {
    expect(isAndroidInteractive({ clickable: true, children: [] })).toBe(true);
    expect(isAndroidInteractive({ checkable: true, children: [] })).toBe(true);
    expect(isAndroidInteractive({ scrollable: true, children: [] })).toBe(true);
    expect(isAndroidInteractive({ longClickable: true, children: [] })).toBe(true);
  });

  it("treats known input/control classes as interactive even without a flag", () => {
    expect(isAndroidInteractive({ className: "android.widget.EditText", children: [] })).toBe(true);
    expect(isAndroidInteractive({ className: "android.widget.TextView", children: [] })).toBe(false);
  });
});

describe("parseAndroidHierarchy", () => {
  it("maps node attributes (class, resource-id, content-desc, booleans) into typed nodes", () => {
    const root = parseAndroidHierarchy(SETTINGS_SOURCE);
    expect(root?.className).toBeUndefined(); // <hierarchy> has no class
    const frame = root?.children[0];
    expect(frame?.className).toBe("android.widget.FrameLayout");
    expect(frame?.package).toBe("com.android.settings");
    const recycler = frame?.children[2];
    expect(recycler?.scrollable).toBe(true);
    expect(recycler?.children[1].checkable).toBe(true);
    expect(recycler?.children[1].enabled).toBe(false);
  });
});

describe("analyzeAndroidApp", () => {
  it("collects interactive elements with ranked selectors, skipping non-interactive noise", async () => {
    const client = new FakeAndroidSource(SETTINGS_SOURCE);
    const result = await analyzeAndroidApp(client, { app: "com.android.settings" });

    expect(result.app).toBe("com.android.settings");
    // The static "Settings" TextView is skipped; everything clickable/scrollable/checkable is kept.
    expect(result.elements.map((e) => e.className)).toEqual([
      "android.widget.TextView", // "Search settings" (clickable)
      "androidx.recyclerview.widget.RecyclerView", // scrollable
      "android.widget.LinearLayout", // "Network & internet" (clickable)
      "android.widget.Switch" // checkable
    ]);

    const search = result.elements[0];
    expect(search.selectors[0]).toBe("id=com.android.settings:id/search_action_bar_title");
    expect(search.contentDesc).toBe("Search settings");

    const network = result.elements[2];
    expect(network.text).toBe("Network & internet");
    expect(network.selectors).toContain('text="Network & internet"');

    const toggle = result.elements[3];
    expect(toggle.enabled).toBe(false);
    expect(toggle.selectors[0]).toBe("id=com.android.settings:id/switch_widget");
  });

  it("reads the hierarchy exactly once and is read-only (only source())", async () => {
    const client = new FakeAndroidSource(SETTINGS_SOURCE);
    await analyzeAndroidApp(client, { app: "com.android.settings" });
    expect(client.calls).toBe(1);
  });

  it("degrades to an empty element list on an empty/unsourceable hierarchy", async () => {
    const client = new FakeAndroidSource("");
    const result = await analyzeAndroidApp(client, { app: "com.example" });
    expect(result.elements).toEqual([]);
  });
});

describe("matchAndroidSelector (host-side snapshot-then-match, PROWL-060)", () => {
  it("matches a fully-qualified id= to exactly the resource-id node", () => {
    const matches = matchAndroidSelector(SETTINGS_SOURCE, "id=com.android.settings:id/switch_widget");
    expect(matches).toHaveLength(1);
    expect(matches[0].className).toBe("android.widget.Switch");
  });

  it("package-qualifies a bare id= using appPackage before matching", () => {
    const matches = matchAndroidSelector(SETTINGS_SOURCE, "id=switch_widget", {
      appPackage: "com.android.settings"
    });
    expect(matches).toHaveLength(1);
    expect(matches[0].resourceId).toBe("com.android.settings:id/switch_widget");
    // Without the package, a bare id cannot match the qualified resource-id.
    expect(matchAndroidSelector(SETTINGS_SOURCE, "id=switch_widget")).toEqual([]);
  });

  it("matches label= exactly against content-desc", () => {
    const matches = matchAndroidSelector(SETTINGS_SOURCE, "label=Search settings");
    expect(matches).toHaveLength(1);
    expect(matches[0].contentDesc).toBe("Search settings");
  });

  it("matches text= as a substring over visible text (entities decoded)", () => {
    const matches = matchAndroidSelector(SETTINGS_SOURCE, "text=Network");
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toBe("Network & internet");
  });

  it("returns an empty array for an empty snapshot", () => {
    expect(matchAndroidSelector("", "id=anything")).toEqual([]);
  });

  it("rejects malformed selectors before parsing the snapshot", () => {
    expect(() => matchAndroidSelector("", "label=")).toThrow('Invalid native selector "label="');
  });
});
