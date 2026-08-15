import { describe, expect, it } from "vitest";
import {
  createMacDriver,
  parseMacSelector,
  unwrapMacTextSelector,
  type MacHelperClient
} from "../src/browser/mac-driver.js";

class FakeClient implements MacHelperClient {
  calls: { cmd: string; params: Record<string, unknown> }[] = [];
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
  async close(): Promise<void> {}
  last(): { cmd: string; params: Record<string, unknown> } {
    return this.calls[this.calls.length - 1];
  }
}

describe("parseMacSelector (PROWL-048 selector dialect)", () => {
  it("parses id selectors", () => {
    expect(parseMacSelector("id=openSettings")).toEqual({ by: "id", value: "openSettings" });
  });

  it("parses role selectors with and without a name", () => {
    expect(parseMacSelector('role=button[name="Save"]')).toEqual({ by: "role", role: "button", name: "Save" });
    expect(parseMacSelector("role=textField")).toEqual({ by: "role", role: "textField" });
  });

  it("parses label selectors (quoted and bare)", () => {
    expect(parseMacSelector('label="Email"')).toEqual({ by: "label", value: "Email" });
    expect(parseMacSelector("label=Email")).toEqual({ by: "label", value: "Email" });
  });

  it("parses text selectors and falls back to bare text", () => {
    expect(parseMacSelector('text="Save"')).toEqual({ by: "text", value: "Save" });
    expect(parseMacSelector("text=Welcome")).toEqual({ by: "text", value: "Welcome" });
    expect(parseMacSelector("Just some label")).toEqual({ by: "text", value: "Just some label" });
  });
});

describe("unwrapMacTextSelector", () => {
  it("returns the inner text for text= selectors and null otherwise", () => {
    expect(unwrapMacTextSelector('text="Delete"')).toBe("Delete");
    expect(unwrapMacTextSelector("text=Delete")).toBe("Delete");
    expect(unwrapMacTextSelector("id=deleteButton")).toBeNull();
    expect(unwrapMacTextSelector('role=button[name="Delete"]')).toBeNull();
  });
});

describe("createMacDriver", () => {
  it("declares only the honest capability set", () => {
    const driver = createMacDriver(new FakeClient());
    expect([...driver.capabilities].sort()).toEqual(["interact", "query", "screenshot", "wait"]);
    expect(driver.capabilities.has("navigate")).toBe(false);
    expect(driver.capabilities.has("evaluate")).toBe(false);
    expect(driver.capabilities.has("route")).toBe(false);
  });

  it("sends a structured count query and returns the count", async () => {
    const client = new FakeClient(() => ({ count: 3 }));
    const driver = createMacDriver(client);
    expect(await driver.count("id=row")).toBe(3);
    expect(client.last()).toEqual({ cmd: "count", params: { query: { by: "id", value: "row" } } });
  });

  it("maps the statusItem selector to openMenu", async () => {
    const client = new FakeClient();
    const driver = createMacDriver(client);
    await driver.click("statusItem");
    expect(client.last()).toEqual({ cmd: "openMenu", params: {} });
  });

  it("maps a menu= selector to clickMenu", async () => {
    const client = new FakeClient();
    const driver = createMacDriver(client);
    await driver.click("menu=Preferences…");
    expect(client.last()).toEqual({ cmd: "clickMenu", params: { title: "Preferences…" } });
  });

  it("routes a normal click through a click query", async () => {
    const client = new FakeClient();
    const driver = createMacDriver(client);
    await driver.click('role=button[name="Save"]');
    expect(client.last()).toEqual({ cmd: "click", params: { query: { by: "role", role: "button", name: "Save" } } });
  });

  it("fills the focused element for a :focus selector (type step)", async () => {
    const client = new FakeClient();
    const driver = createMacDriver(client);
    await driver.fill(":focus", "hello");
    expect(client.last()).toEqual({ cmd: "fill", params: { query: { by: "focused" }, value: "hello" } });
  });

  it("sends role/label helper queries", async () => {
    const client = new FakeClient(() => ({ count: 1 }));
    const driver = createMacDriver(client);
    await driver.countByRole("button", "Save");
    expect(client.last()).toEqual({ cmd: "count", params: { query: { by: "role", role: "button", name: "Save" } } });
    await driver.fillFirstByLabel("Email", "a@b.c");
    expect(client.last()).toEqual({ cmd: "fill", params: { query: { by: "label", value: "Email" }, value: "a@b.c" } });
  });

  it("converts a waitForSelector timeout from ms to seconds", async () => {
    const client = new FakeClient();
    const driver = createMacDriver(client);
    await driver.waitForSelector("id=ready", { timeout: 5000 });
    expect(client.last()).toEqual({ cmd: "waitFor", params: { query: { by: "id", value: "ready" }, timeout: 5 } });
  });

  it("exposes bundle label via currentUrl and unwraps text selectors", () => {
    const driver = createMacDriver(new FakeClient(), { appLabel: "com.example.App" });
    expect(driver.currentUrl()).toBe("macos:com.example.App");
    expect(driver.parseTextSelector('text="Delete"')).toBe("Delete");
    expect(driver.parseTextSelector("id=x")).toBeNull();
  });

  it("rejects web-only verbs with a clear message", async () => {
    const driver = createMacDriver(new FakeClient());
    await expect(driver.goto("http://x")).rejects.toThrow("navigate is not supported by the macOS target");
    await expect(driver.evaluate("1+1")).rejects.toThrow("evalScript is not supported by the macOS target");
    await expect(driver.setInputFiles("id=x", "f")).rejects.toThrow("setInputFiles is not supported by the macOS target");
    await expect(driver.waitForDownloadEvent()).rejects.toThrow("waitForDownload is not supported by the macOS target");
  });

  it("propagates helper errors", async () => {
    const client = new FakeClient(() => {
      throw new Error("no element matched query");
    });
    const driver = createMacDriver(client);
    await expect(driver.count("id=missing")).rejects.toThrow("no element matched query");
  });
});
