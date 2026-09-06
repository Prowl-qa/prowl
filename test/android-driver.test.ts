import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  androidQueryToLocator,
  createAndroidDriver,
  escapeUiSelectorArg,
  parseAndroidSelector,
  unwrapAndroidTextSelector,
  type AndroidAgentClient,
  type AndroidQuery
} from "../src/browser/android-driver.js";
import {
  MAX_SCROLL_TO_SWIPES,
  type PointerActionSequence,
  type ScreenSize
} from "../src/browser/touch-gestures.js";

class FakeAgent implements AndroidAgentClient {
  findElementQueries: AndroidQuery[] = [];
  findElementsQueries: AndroidQuery[] = [];
  clicks: string[] = [];
  setValues: { id: string; text: string }[] = [];
  keyCodes: number[] = [];
  closed = false;
  elementId: string | null = "el-1";
  elements: string[] = ["el-1"];
  text: string | null = "hello";
  png: Buffer = Buffer.from("PNGDATA");
  windowSizeValue: ScreenSize = { width: 1080, height: 1920 };
  windowSizeCalls = 0;
  performedActions: PointerActionSequence[] = [];
  /** When set, `findElements` returns these results in order per call. */
  findElementsSequence: string[][] | null = null;

  async findElement(query: AndroidQuery): Promise<string | null> {
    this.findElementQueries.push(query);
    return this.elementId;
  }
  async findElements(query: AndroidQuery): Promise<string[]> {
    this.findElementsQueries.push(query);
    if (this.findElementsSequence) {
      return this.findElementsSequence.shift() ?? [];
    }
    return this.elements;
  }
  async click(id: string): Promise<void> {
    this.clicks.push(id);
  }
  async setValue(id: string, text: string): Promise<void> {
    this.setValues.push({ id, text });
  }
  async getText(): Promise<string | null> {
    return this.text;
  }
  async pressKeyCode(code: number): Promise<void> {
    this.keyCodes.push(code);
  }
  async screenshotPng(): Promise<Buffer> {
    return this.png;
  }
  async windowSize(): Promise<ScreenSize> {
    this.windowSizeCalls += 1;
    return this.windowSizeValue;
  }
  async performActions(actions: PointerActionSequence): Promise<void> {
    this.performedActions.push(actions);
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

describe("parseAndroidSelector (PROWL-058 selector dialect)", () => {
  it("parses id selectors (bare, quoted, and fully qualified)", () => {
    expect(parseAndroidSelector("id=save")).toEqual({ by: "id", value: "save" });
    expect(parseAndroidSelector('id="save"')).toEqual({ by: "id", value: "save" });
    expect(parseAndroidSelector("id=com.example:id/save")).toEqual({
      by: "id",
      value: "com.example:id/save"
    });
  });

  it("maps label= to content-desc (accessibility id)", () => {
    expect(parseAndroidSelector('label="Submit"')).toEqual({ by: "accessibilityId", value: "Submit" });
    expect(parseAndroidSelector("label=Submit")).toEqual({ by: "accessibilityId", value: "Submit" });
  });

  it("parses role selectors with and without a name", () => {
    expect(parseAndroidSelector("role=android.widget.Button")).toEqual({
      by: "role",
      role: "android.widget.Button"
    });
    expect(parseAndroidSelector('role=android.widget.Button[name="Save"]')).toEqual({
      by: "role",
      role: "android.widget.Button",
      name: "Save"
    });
  });

  it("parses text selectors and falls back to bare text", () => {
    expect(parseAndroidSelector('text="Save"')).toEqual({ by: "text", value: "Save" });
    expect(parseAndroidSelector("text=Welcome")).toEqual({ by: "text", value: "Welcome" });
    expect(parseAndroidSelector("Just some label")).toEqual({ by: "text", value: "Just some label" });
  });

  it("maps :focus to the focused element", () => {
    expect(parseAndroidSelector(":focus")).toEqual({ by: "focused" });
  });
});

describe("androidQueryToLocator", () => {
  it("uses the server's native strategy/selector/context wire shape (not W3C using/value)", () => {
    expect(androidQueryToLocator({ by: "id", value: "com.app:id/save" })).toEqual({
      strategy: "id",
      selector: "com.app:id/save",
      context: ""
    });
    expect(androidQueryToLocator({ by: "accessibilityId", value: "Submit" })).toEqual({
      strategy: "accessibility id",
      selector: "Submit",
      context: ""
    });
  });

  it("qualifies bare resource-ids with the app package; qualified ids pass through", () => {
    expect(androidQueryToLocator({ by: "id", value: "save" }, { appPackage: "com.app" })).toEqual({
      strategy: "id",
      selector: "com.app:id/save",
      context: ""
    });
    expect(
      androidQueryToLocator({ by: "id", value: "android:id/title" }, { appPackage: "com.app" })
    ).toEqual({ strategy: "id", selector: "android:id/title", context: "" });
    // Without a package the bare value passes through unchanged.
    expect(androidQueryToLocator({ by: "id", value: "save" })).toEqual({
      strategy: "id",
      selector: "save",
      context: ""
    });
  });

  it("composes a UiSelector for substring text (mirrors macOS text= semantics)", () => {
    expect(androidQueryToLocator({ by: "text", value: "Save" })).toEqual({
      strategy: "-android uiautomator",
      selector: 'new UiSelector().textContains("Save")',
      context: ""
    });
  });

  it("maps a bare role to a class name and a role+name to class + text", () => {
    expect(androidQueryToLocator({ by: "role", role: "android.widget.Button" })).toEqual({
      strategy: "class name",
      selector: "android.widget.Button",
      context: ""
    });
    expect(androidQueryToLocator({ by: "role", role: "android.widget.Button", name: "Save" })).toEqual({
      strategy: "-android uiautomator",
      selector: 'new UiSelector().className("android.widget.Button").textContains("Save")',
      context: ""
    });
  });

  it("resolves the focused element", () => {
    expect(androidQueryToLocator({ by: "focused" })).toEqual({
      strategy: "-android uiautomator",
      selector: "new UiSelector().focused(true)",
      context: ""
    });
  });

  it("escapes quotes and backslashes to keep UiSelector expressions safe", () => {
    expect(escapeUiSelectorArg('a"b\\c')).toBe('a\\"b\\\\c');
    expect(androidQueryToLocator({ by: "text", value: 'He said "hi"' })).toEqual({
      strategy: "-android uiautomator",
      selector: 'new UiSelector().textContains("He said \\"hi\\"")',
      context: ""
    });
  });
});

describe("unwrapAndroidTextSelector", () => {
  it("returns inner text for text= selectors, null otherwise", () => {
    expect(unwrapAndroidTextSelector('text="Delete"')).toBe("Delete");
    expect(unwrapAndroidTextSelector("text=Delete")).toBe("Delete");
    expect(unwrapAndroidTextSelector("id=x")).toBeNull();
    expect(unwrapAndroidTextSelector('label="Delete"')).toBeNull();
  });
});

describe("createAndroidDriver", () => {
  it("declares only the honest capability set", () => {
    const driver = createAndroidDriver(new FakeAgent());
    expect([...driver.capabilities].sort()).toEqual(["interact", "query", "screenshot", "wait"]);
    expect(driver.capabilities.has("navigate")).toBe(false);
    expect(driver.capabilities.has("evaluate")).toBe(false);
  });

  it("counts via findElements", async () => {
    const agent = new FakeAgent();
    agent.elements = ["a", "b", "c"];
    const driver = createAndroidDriver(agent);
    expect(await driver.count("id=row")).toBe(3);
    expect(agent.findElementsQueries.at(-1)).toEqual({ by: "id", value: "row" });
  });

  it("resolves then clicks an element", async () => {
    const agent = new FakeAgent();
    const driver = createAndroidDriver(agent);
    await driver.click("id=save");
    expect(agent.findElementQueries.at(-1)).toEqual({ by: "id", value: "save" });
    expect(agent.clicks).toEqual(["el-1"]);
  });

  it("throws a clear error when no element matches a click", async () => {
    const agent = new FakeAgent();
    agent.elementId = null;
    const driver = createAndroidDriver(agent);
    await expect(driver.click("id=missing")).rejects.toThrow("No element matched selector: id=missing");
  });

  it("fills the focused element for :focus (type step) and by selector otherwise", async () => {
    const agent = new FakeAgent();
    const driver = createAndroidDriver(agent);
    await driver.fill(":focus", "hello");
    expect(agent.findElementQueries.at(-1)).toEqual({ by: "focused" });
    expect(agent.setValues.at(-1)).toEqual({ id: "el-1", text: "hello" });
    await driver.fill("id=email", "a@b.c");
    expect(agent.findElementQueries.at(-1)).toEqual({ by: "id", value: "email" });
    expect(agent.setValues.at(-1)).toEqual({ id: "el-1", text: "a@b.c" });
  });

  it("maps press keys to Android key codes and rejects unknown keys", async () => {
    const agent = new FakeAgent();
    const driver = createAndroidDriver(agent);
    await driver.press("id=field", "Enter");
    await driver.press("id=field", "back");
    expect(agent.keyCodes).toEqual([66, 4]);
    await expect(driver.press("id=field", "F13")).rejects.toThrow('Unsupported key "F13"');
  });

  it("waits for a selector, polling until it appears", async () => {
    const agent = new FakeAgent();
    const driver = createAndroidDriver(agent);
    let calls = 0;
    agent.findElements = async () => (++calls < 3 ? [] : ["el-1"]);
    await expect(driver.waitForSelector("id=ready", { timeout: 1000 })).resolves.toBeUndefined();
    expect(calls).toBe(3);
  });

  it("times out waiting for a selector that never appears", async () => {
    const agent = new FakeAgent();
    agent.elements = [];
    const driver = createAndroidDriver(agent);
    await expect(driver.waitForSelector("id=never", { timeout: 30 })).rejects.toThrow(
      "Timed out after 30ms waiting for selector: id=never"
    );
  });

  it("writes a screenshot to disk from PNG bytes", async () => {
    const agent = new FakeAgent();
    agent.png = Buffer.from("SCREENSHOT-BYTES");
    const driver = createAndroidDriver(agent);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-android-shot-"));
    const target = path.join(dir, "out.png");
    try {
      await driver.screenshot({ path: target, fullPage: true });
      expect(fs.readFileSync(target).toString()).toBe("SCREENSHOT-BYTES");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sends role/label semantic queries", async () => {
    const agent = new FakeAgent();
    agent.elements = ["x"];
    const driver = createAndroidDriver(agent);
    await driver.countByRole("android.widget.Button", "Save");
    expect(agent.findElementsQueries.at(-1)).toEqual({
      by: "role",
      role: "android.widget.Button",
      name: "Save"
    });
    await driver.fillFirstByLabel("Email", "a@b.c");
    expect(agent.findElementQueries.at(-1)).toEqual({ by: "accessibilityId", value: "Email" });
    expect(agent.setValues.at(-1)).toEqual({ id: "el-1", text: "a@b.c" });
  });

  it("returns element text or null", async () => {
    const present = new FakeAgent();
    present.text = "Saved";
    expect(await createAndroidDriver(present).textContent("text=Saved")).toBe("Saved");

    const missing = new FakeAgent();
    missing.elementId = null;
    expect(await createAndroidDriver(missing).textContent("id=x")).toBeNull();
  });

  it("exposes the package label via currentUrl and unwraps text selectors", () => {
    const driver = createAndroidDriver(new FakeAgent(), { appLabel: "com.example.app" });
    expect(driver.currentUrl()).toBe("android:com.example.app");
    expect(driver.parseTextSelector('text="Delete"')).toBe("Delete");
    expect(driver.parseTextSelector("id=x")).toBeNull();
  });

  it("rejects web-only and touch-incompatible verbs with a clear message", async () => {
    const driver = createAndroidDriver(new FakeAgent());
    await expect(driver.goto("http://x")).rejects.toThrow("navigate is not supported by the Android target");
    await expect(driver.evaluate("1+1")).rejects.toThrow("evalScript is not supported by the Android target");
    await expect(driver.setInputFiles("id=x", "f")).rejects.toThrow(
      "setInputFiles is not supported by the Android target"
    );
    await expect(driver.hover("id=x")).rejects.toThrow("hover is not supported by the Android target");
    await expect(driver.waitForDownloadEvent()).rejects.toThrow(
      "waitForDownload is not supported by the Android target"
    );
    expect(() => driver.onResponse(() => {})).toThrow(
      "onResponse is not supported by the Android target"
    );
    expect(() => driver.onDialog("accept")).toThrow("onDialog is not supported by the Android target");
  });

  it("propagates agent errors", async () => {
    const agent = new FakeAgent();
    agent.findElement = async () => {
      throw new Error("device offline");
    };
    const driver = createAndroidDriver(agent);
    await expect(driver.click("id=x")).rejects.toThrow("device offline");
  });
});

describe("createAndroidDriver touch gestures (PROWL-080)", () => {
  it("scroll(down) posts a centre swipe with inverted finger math", async () => {
    const agent = new FakeAgent(); // 1080x1920 screen
    const driver = createAndroidDriver(agent);
    await driver.scroll("down");
    expect(agent.performedActions).toHaveLength(1);
    const seq = agent.performedActions[0];
    expect(seq.parameters).toEqual({ pointerType: "touch" });
    // Default distance = round(1920 * 0.75) = 1440, half 720, centre (540, 960).
    const moves = seq.actions.filter((a) => a.type === "pointerMove");
    expect(moves[0]).toMatchObject({ x: 540, y: 1680 });
    expect(moves[1]).toMatchObject({ x: 540, y: 240 });
    expect((moves[1] as { y: number }).y).toBeLessThan((moves[0] as { y: number }).y);
  });

  it("scroll amount maps to the swipe distance", async () => {
    const agent = new FakeAgent();
    const driver = createAndroidDriver(agent);
    await driver.scroll("right", 400);
    const moves = agent.performedActions[0].actions.filter((a) => a.type === "pointerMove");
    // right → finger moves left; distance 400, half 200, centre x=540 → 740 → 340
    expect(moves[0]).toMatchObject({ x: 740, y: 960 });
    expect(moves[1]).toMatchObject({ x: 340, y: 960 });
  });

  it("scrollTo short-circuits when the element is already present", async () => {
    const agent = new FakeAgent();
    agent.elements = ["el-1"];
    const driver = createAndroidDriver(agent);
    await driver.scrollIntoView("id=footer");
    expect(agent.performedActions).toHaveLength(0);
    expect(agent.windowSizeCalls).toBe(0);
  });

  it("scrollTo swipes until the element appears", async () => {
    const agent = new FakeAgent();
    agent.findElementsSequence = [[], [], [], ["el-1"]]; // 3 swipes
    const driver = createAndroidDriver(agent);
    await driver.scrollIntoView("id=footer");
    expect(agent.performedActions).toHaveLength(3);
    expect(agent.windowSizeCalls).toBe(1);
  });

  it("scrollTo fails with a clear bounded error when never visible", async () => {
    const agent = new FakeAgent();
    agent.elements = [];
    const driver = createAndroidDriver(agent);
    await expect(driver.scrollIntoView("id=ghost")).rejects.toThrow(
      `scrollTo: element "id=ghost" not visible after ${MAX_SCROLL_TO_SWIPES} scroll attempts on the Android target`
    );
    expect(agent.performedActions).toHaveLength(MAX_SCROLL_TO_SWIPES);
  });

  it("scrollTo reverses direction to find a target above the initial viewport", async () => {
    const agent = new FakeAgent();
    agent.elements = [];
    agent.findElements = async (query) => {
      agent.findElementsQueries.push(query);
      return agent.performedActions.length === 21 ? ["el-1"] : [];
    };
    const driver = createAndroidDriver(agent);
    await driver.scrollIntoView("id=header");
    expect(agent.performedActions).toHaveLength(21);
    const lastMoves = agent.performedActions.at(-1)!.actions.filter((a) => a.type === "pointerMove");
    // scrollTo probes use a shorter 60% span: 1920 * 0.6 = 1152, half 576.
    expect(lastMoves[0]).toMatchObject({ x: 540, y: 384 });
    expect(lastMoves[1]).toMatchObject({ x: 540, y: 1536 });
    expect((lastMoves[1] as { y: number }).y).toBeGreaterThan((lastMoves[0] as { y: number }).y);
  });
});
