import { describe, expect, it } from "vitest";
import {
  analyzeMacApp,
  rankMacSelectors,
  DEFAULT_ANALYZE_TREE_DEPTH
} from "../src/analyzer/mac.js";
import type { MacHelperClient } from "../src/browser/mac-driver.js";

class FakeClient implements MacHelperClient {
  calls: { cmd: string; params: Record<string, unknown> }[] = [];
  closed = false;
  constructor(
    private readonly responder: (
      cmd: string,
      params: Record<string, unknown>
    ) => Record<string, unknown> = () => ({})
  ) {}
  async request(cmd: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    this.calls.push({ cmd, params });
    return this.responder(cmd, params);
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

/** A representative app: one window, a mix of interactive + non-interactive nodes, a status menu. */
function fullResponder(cmd: string): Record<string, unknown> {
  switch (cmd) {
    case "tree":
      return {
        tree: {
          role: "AXApplication",
          children: [
            {
              role: "AXWindow",
              title: "Main",
              children: [
                { role: "AXButton", title: "Save", identifier: "saveBtn", enabled: true },
                { role: "AXTextField", description: "Email" },
                { role: "AXStaticText", value: "just noise" },
                {
                  role: "AXGroup",
                  children: [{ role: "AXCheckBox", title: "Remember me", enabled: false }]
                }
              ]
            }
          ]
        }
      };
    case "windows":
      return { windows: [{ role: "AXWindow", title: "Main", identifier: "mainWin" }] };
    case "statusItems":
      return { items: [{ role: "AXMenuBarItem", title: "Prowl" }] };
    case "openMenu":
      return {
        items: [
          { role: "AXMenuItem", title: "Preferences…", identifier: "prefs" },
          { role: "AXMenuItem" }, // separator — no title/id/description
          { role: "AXMenuItem", title: "Quit" }
        ]
      };
    case "closeMenu":
      return { closed: true };
    default:
      return {};
  }
}

describe("rankMacSelectors", () => {
  it("ranks id > label > role[name] > text", () => {
    expect(
      rankMacSelectors({ role: "AXButton", title: "Save", identifier: "saveBtn" })
    ).toEqual(["id=saveBtn", 'label="Save"', 'role=AXButton[name="Save"]', 'text="Save"']);
  });

  it("uses description as the exact label when there is no title", () => {
    expect(rankMacSelectors({ role: "AXTextField", description: "Email" })).toEqual([
      'label="Email"',
      'role=AXTextField[name="Email"]',
      'text="Email"'
    ]);
  });

  it("falls back to value for the role name / text but not the exact label", () => {
    expect(rankMacSelectors({ role: "AXTextField", value: "typed text" })).toEqual([
      'role=AXTextField[name="typed text"]',
      'text="typed text"'
    ]);
  });

  it("falls back to a bare role selector when nothing else addresses the element", () => {
    expect(rankMacSelectors({ role: "AXButton" })).toEqual(["role=AXButton"]);
  });

  it("returns nothing for a node with neither a role nor a name", () => {
    expect(rankMacSelectors({})).toEqual([]);
  });
});

describe("analyzeMacApp", () => {
  it("collects interactive elements from the tree with ranked selectors, skipping non-interactive roles", async () => {
    const client = new FakeClient(fullResponder);
    const result = await analyzeMacApp(client, { app: "com.example.App" });

    expect(result.app).toBe("com.example.App");
    // AXStaticText and AXGroup are skipped; the nested AXCheckBox is found.
    expect(result.elements.map((e) => e.role)).toEqual(["AXButton", "AXTextField", "AXCheckBox"]);

    const save = result.elements[0];
    expect(save.selectors[0]).toBe("id=saveBtn");
    expect(save.title).toBe("Save");
    expect(save.enabled).toBe(true);

    const email = result.elements[1];
    expect(email.selectors).toEqual(['label="Email"', 'role=AXTextField[name="Email"]', 'text="Email"']);

    const remember = result.elements[2];
    expect(remember.enabled).toBe(false);
    expect(remember.selectors[0]).toBe('label="Remember me"');
  });

  it("requests the tree at the analyzer's default depth", async () => {
    const client = new FakeClient(fullResponder);
    await analyzeMacApp(client, { app: "com.example.App" });
    const tree = client.calls.find((c) => c.cmd === "tree");
    expect(tree?.params).toEqual({ depth: DEFAULT_ANALYZE_TREE_DEPTH });
  });

  it("lists windows as navigable surfaces with their best selector", async () => {
    const client = new FakeClient(fullResponder);
    const result = await analyzeMacApp(client, { app: "com.example.App" });
    expect(result.windows).toEqual([{ title: "Main", identifier: "mainWin", selector: "id=mainWin" }]);
  });

  it("opens the status menu, reads its items (dropping separators), then closes it", async () => {
    const client = new FakeClient(fullResponder);
    const result = await analyzeMacApp(client, { app: "com.example.App" });

    expect(result.menuItems.map((e) => e.selectors[0])).toEqual(["id=prefs", 'label="Quit"']);
    expect(result.menuItems.every((e) => e.source === "menu")).toBe(true);

    const order = client.calls.map((c) => c.cmd);
    expect(order).toContain("openMenu");
    expect(order).toContain("closeMenu");
    expect(order.indexOf("openMenu")).toBeLessThan(order.indexOf("closeMenu"));
  });

  it("is read-only: never clicks, fills, presses, or quits", async () => {
    const client = new FakeClient(fullResponder);
    await analyzeMacApp(client, { app: "com.example.App" });
    const mutating = client.calls.filter((c) =>
      ["click", "fill", "press", "hover", "scrollTo", "clickMenu", "quit"].includes(c.cmd)
    );
    expect(mutating).toEqual([]);
  });

  it("skips the status menu entirely when the app has no status item", async () => {
    const client = new FakeClient((cmd) => {
      if (cmd === "statusItems") return { items: [] };
      return fullResponder(cmd);
    });
    const result = await analyzeMacApp(client, { app: "com.example.App" });
    expect(result.menuItems).toEqual([]);
    expect(client.calls.some((c) => c.cmd === "openMenu")).toBe(false);
  });

  it("degrades to an empty menu (and still closes it) when opening the menu fails", async () => {
    const client = new FakeClient((cmd) => {
      if (cmd === "openMenu") throw new Error("status-item menu did not open");
      return fullResponder(cmd);
    });
    const result = await analyzeMacApp(client, { app: "com.example.App" });
    expect(result.menuItems).toEqual([]);
    // The window-tree analysis still succeeded.
    expect(result.elements.length).toBeGreaterThan(0);
    expect(client.calls.some((c) => c.cmd === "closeMenu")).toBe(true);
  });

  it("tolerates a missing tree payload without throwing", async () => {
    const client = new FakeClient((cmd) => {
      if (cmd === "tree") return {};
      if (cmd === "windows") return {};
      if (cmd === "statusItems") return { items: [] };
      return {};
    });
    const result = await analyzeMacApp(client, { app: "com.example.App" });
    expect(result.elements).toEqual([]);
    expect(result.windows).toEqual([]);
    expect(result.menuItems).toEqual([]);
  });
});
