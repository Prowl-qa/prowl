import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createIosDriver,
  escapePredicateArg,
  iosQueryToLocator,
  normalizeXcuiClassName,
  parseIosSelector,
  unwrapIosTextSelector,
  type IosAgentClient,
  type IosQuery
} from "../src/browser/ios-driver.js";

class FakeAgent implements IosAgentClient {
  findElementQueries: IosQuery[] = [];
  findElementsQueries: IosQuery[] = [];
  clicks: string[] = [];
  setValues: { id: string; text: string }[] = [];
  keySequences: string[][] = [];
  homescreens = 0;
  closed = false;
  elementId: string | null = "el-1";
  elements: string[] = ["el-1"];
  text: string | null = "hello";

  async findElement(query: IosQuery): Promise<string | null> {
    this.findElementQueries.push(query);
    return this.elementId;
  }
  async findElements(query: IosQuery): Promise<string[]> {
    this.findElementsQueries.push(query);
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
  async sendKeys(keys: string[]): Promise<void> {
    this.keySequences.push(keys);
  }
  async homescreen(): Promise<void> {
    this.homescreens += 1;
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

function driverFor(agent: IosAgentClient, appLabel?: string) {
  const shots: string[] = [];
  const driver = createIosDriver(agent, {
    appLabel,
    captureScreenshot: async (p) => {
      shots.push(p);
      fs.writeFileSync(p, "SCREENSHOT-BYTES");
    }
  });
  return { driver, shots };
}

describe("parseIosSelector (PROWL-059 selector dialect)", () => {
  it("maps id= to accessibility id (bare and quoted)", () => {
    expect(parseIosSelector("id=save")).toEqual({ by: "accessibilityId", value: "save" });
    expect(parseIosSelector('id="save"')).toEqual({ by: "accessibilityId", value: "save" });
  });

  it("maps label= to an exact label match", () => {
    expect(parseIosSelector('label="Submit"')).toEqual({ by: "label", value: "Submit" });
    expect(parseIosSelector("label=Submit")).toEqual({ by: "label", value: "Submit" });
  });

  it("parses role selectors with and without a name (full and shorthand class)", () => {
    expect(parseIosSelector("role=XCUIElementTypeButton")).toEqual({
      by: "role",
      role: "XCUIElementTypeButton"
    });
    expect(parseIosSelector('role=Button[name="Save"]')).toEqual({
      by: "role",
      role: "Button",
      name: "Save"
    });
  });

  it("parses text selectors and falls back to bare text", () => {
    expect(parseIosSelector('text="Save"')).toEqual({ by: "text", value: "Save" });
    expect(parseIosSelector("Welcome back")).toEqual({ by: "text", value: "Welcome back" });
  });

  it("maps :focus to the focused element", () => {
    expect(parseIosSelector(":focus")).toEqual({ by: "focused" });
  });
});

describe("iosQueryToLocator", () => {
  it("uses the native accessibility id strategy for id=", () => {
    expect(iosQueryToLocator({ by: "accessibilityId", value: "save" })).toEqual({
      using: "accessibility id",
      value: "save"
    });
  });

  it("builds an exact predicate for label=", () => {
    expect(iosQueryToLocator({ by: "label", value: "Submit" })).toEqual({
      using: "predicate string",
      value: 'label == "Submit"'
    });
  });

  it("builds a label/value substring predicate for text=", () => {
    expect(iosQueryToLocator({ by: "text", value: "Save" })).toEqual({
      using: "predicate string",
      value: 'label CONTAINS "Save" OR value CONTAINS "Save"'
    });
  });

  it("maps a bare role to a class name (normalizing shorthand)", () => {
    expect(iosQueryToLocator({ by: "role", role: "Button" })).toEqual({
      using: "class name",
      value: "XCUIElementTypeButton"
    });
    expect(iosQueryToLocator({ by: "role", role: "XCUIElementTypeCell" })).toEqual({
      using: "class name",
      value: "XCUIElementTypeCell"
    });
  });

  it("maps role+name to a type + substring predicate", () => {
    expect(iosQueryToLocator({ by: "role", role: "Button", name: "Save" })).toEqual({
      using: "predicate string",
      value: 'type == "XCUIElementTypeButton" AND (label CONTAINS "Save" OR value CONTAINS "Save")'
    });
  });

  it("resolves the focused element by keyboard focus", () => {
    expect(iosQueryToLocator({ by: "focused" })).toEqual({
      using: "predicate string",
      value: "hasKeyboardFocus == 1"
    });
  });

  it("escapes quotes and backslashes in predicate literals", () => {
    expect(escapePredicateArg('a"b\\c')).toBe('a\\"b\\\\c');
    expect(iosQueryToLocator({ by: "label", value: 'He said "hi"' })).toEqual({
      using: "predicate string",
      value: 'label == "He said \\"hi\\""'
    });
  });

  it("normalizes XCUIElementType shorthand", () => {
    expect(normalizeXcuiClassName("Button")).toBe("XCUIElementTypeButton");
    expect(normalizeXcuiClassName("XCUIElementTypeSwitch")).toBe("XCUIElementTypeSwitch");
  });
});

describe("unwrapIosTextSelector", () => {
  it("returns inner text for text= selectors, null otherwise", () => {
    expect(unwrapIosTextSelector('text="Delete"')).toBe("Delete");
    expect(unwrapIosTextSelector("text=Delete")).toBe("Delete");
    expect(unwrapIosTextSelector("id=x")).toBeNull();
    expect(unwrapIosTextSelector('label="Delete"')).toBeNull();
  });
});

describe("createIosDriver", () => {
  it("declares only the honest capability set", () => {
    const { driver } = driverFor(new FakeAgent());
    expect([...driver.capabilities].sort()).toEqual(["interact", "query", "screenshot", "wait"]);
    expect(driver.capabilities.has("navigate")).toBe(false);
    expect(driver.capabilities.has("evaluate")).toBe(false);
  });

  it("resolves then clicks an element", async () => {
    const agent = new FakeAgent();
    const { driver } = driverFor(agent);
    await driver.click("id=save");
    expect(agent.findElementQueries.at(-1)).toEqual({ by: "accessibilityId", value: "save" });
    expect(agent.clicks).toEqual(["el-1"]);
  });

  it("throws a clear error when no element matches a click", async () => {
    const agent = new FakeAgent();
    agent.elementId = null;
    const { driver } = driverFor(agent);
    await expect(driver.click("id=missing")).rejects.toThrow("No element matched selector: id=missing");
  });

  it("fills the focused element for :focus and by selector otherwise", async () => {
    const agent = new FakeAgent();
    const { driver } = driverFor(agent);
    await driver.fill(":focus", "hello");
    expect(agent.findElementQueries.at(-1)).toEqual({ by: "focused" });
    expect(agent.setValues.at(-1)).toEqual({ id: "el-1", text: "hello" });
    await driver.fill("id=email", "a@b.c");
    expect(agent.findElementQueries.at(-1)).toEqual({ by: "accessibilityId", value: "email" });
  });

  it("maps press keys to WDA keys/homescreen and rejects unknown keys", async () => {
    const agent = new FakeAgent();
    const { driver } = driverFor(agent);
    await driver.press("id=field", "Enter");
    await driver.press("id=field", "Backspace");
    await driver.press("id=field", "Home");
    expect(agent.keySequences).toEqual([["\n"], ["\b"]]);
    expect(agent.homescreens).toBe(1);
    await expect(driver.press("id=field", "F13")).rejects.toThrow('Unsupported key "F13"');
  });

  it("counts via findElements and returns text or null", async () => {
    const agent = new FakeAgent();
    agent.elements = ["a", "b", "c"];
    const { driver } = driverFor(agent);
    expect(await driver.count("id=row")).toBe(3);
    expect(agent.findElementsQueries.at(-1)).toEqual({ by: "accessibilityId", value: "row" });

    const missing = new FakeAgent();
    missing.elementId = null;
    expect(await driverFor(missing).driver.textContent("id=x")).toBeNull();
  });

  it("waits for a selector, polling until it appears, then times out", async () => {
    const agent = new FakeAgent();
    let calls = 0;
    agent.findElements = async () => (++calls < 3 ? [] : ["el-1"]);
    const { driver } = driverFor(agent);
    await expect(driver.waitForSelector("id=ready", { timeout: 1000 })).resolves.toBeUndefined();
    expect(calls).toBe(3);

    const never = new FakeAgent();
    never.elements = [];
    await expect(driverFor(never).driver.waitForSelector("id=never", { timeout: 30 })).rejects.toThrow(
      "Timed out after 30ms waiting for selector: id=never"
    );
  });

  it("captures a screenshot via the injected simctl capture", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-ios-shot-"));
    const target = path.join(dir, "out.png");
    try {
      const { driver } = driverFor(new FakeAgent());
      await driver.screenshot({ path: target, fullPage: true });
      expect(fs.readFileSync(target).toString()).toBe("SCREENSHOT-BYTES");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sends role/label semantic queries", async () => {
    const agent = new FakeAgent();
    const { driver } = driverFor(agent);
    await driver.countByRole("Button", "Save");
    expect(agent.findElementsQueries.at(-1)).toEqual({ by: "role", role: "Button", name: "Save" });
    await driver.fillFirstByLabel("Email", "a@b.c");
    expect(agent.findElementQueries.at(-1)).toEqual({ by: "label", value: "Email" });
    expect(agent.setValues.at(-1)).toEqual({ id: "el-1", text: "a@b.c" });
  });

  it("exposes the bundle label via currentUrl and unwraps text selectors", () => {
    const { driver } = driverFor(new FakeAgent(), "com.example.App");
    expect(driver.currentUrl()).toBe("ios:com.example.App");
    expect(driver.parseTextSelector('text="Delete"')).toBe("Delete");
    expect(driver.parseTextSelector("id=x")).toBeNull();
  });

  it("rejects web-only and touch-incompatible verbs with a clear message", async () => {
    const { driver } = driverFor(new FakeAgent());
    await expect(driver.goto("http://x")).rejects.toThrow("navigate is not supported by the iOS target");
    await expect(driver.evaluate("1+1")).rejects.toThrow("evalScript is not supported by the iOS target");
    await expect(driver.setInputFiles("id=x", "f")).rejects.toThrow(
      "setInputFiles is not supported by the iOS target"
    );
    await expect(driver.hover("id=x")).rejects.toThrow("hover is not supported by the iOS target");
    await expect(driver.scrollIntoView("id=x")).rejects.toThrow(
      "scrollTo is not supported by the iOS target"
    );
    await expect(driver.waitForDownloadEvent()).rejects.toThrow(
      "waitForDownload is not supported by the iOS target"
    );
    expect(() => driver.onResponse(() => {})).toThrow("onResponse is not supported by the iOS target");
    expect(() => driver.onDialog("accept")).toThrow("onDialog is not supported by the iOS target");
  });

  it("propagates agent errors", async () => {
    const agent = new FakeAgent();
    agent.findElement = async () => {
      throw new Error("simulator offline");
    };
    const { driver } = driverFor(agent);
    await expect(driver.click("id=x")).rejects.toThrow("simulator offline");
  });
});
