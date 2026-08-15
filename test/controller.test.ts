import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("playwright", () => {
  function createMockBrowser() {
    const tracing = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined)
    };
    const page = {
      setDefaultTimeout: vi.fn(),
      setDefaultNavigationTimeout: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      route: vi.fn(async () => undefined),
      unroute: vi.fn(async () => undefined),
      waitForEvent: vi.fn(async () => undefined),
      screenshot: vi.fn(async () => undefined)
    };
    const context = {
      newPage: vi.fn(async () => page),
      tracing,
      close: vi.fn(async () => undefined)
    };
    const browser = {
      newContext: vi.fn(async () => context),
      close: vi.fn(async () => undefined)
    };
    return { browser, context, page, tracing };
  }

  const chromiumMock = createMockBrowser();
  const firefoxMock = createMockBrowser();
  const webkitMock = createMockBrowser();

  return {
    chromium: { launch: vi.fn(async () => chromiumMock.browser) },
    firefox: { launch: vi.fn(async () => firefoxMock.browser) },
    webkit: { launch: vi.fn(async () => webkitMock.browser) }
  };
});

import { chromium, firefox, webkit } from "playwright";
import { launchBrowser, closeBrowser, createPlaywrightDriver, type BrowserOptions } from "../src/browser/controller.js";

function makeOptions(overrides?: Partial<BrowserOptions>): BrowserOptions {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-ctrl-"));
  return {
    headless: true,
    slowMo: 0,
    timeout: 30000,
    trace: false,
    recordHar: false,
    runDir,
    ...overrides
  };
}

describe("launchBrowser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("launches chromium by default", async () => {
    const opts = makeOptions();
    try {
      await launchBrowser(opts);
      expect(chromium.launch).toHaveBeenCalledWith({ headless: true, slowMo: 0, channel: undefined });
      expect(firefox.launch).not.toHaveBeenCalled();
      expect(webkit.launch).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(opts.runDir, { recursive: true, force: true });
    }
  });

  it("throws an actionable error for unsupported browser engines", async () => {
    const opts = makeOptions({ engine: "safari" as BrowserOptions["engine"] });
    try {
      await expect(launchBrowser(opts)).rejects.toThrow(
        'Unsupported browser engine "safari". Available engines: chromium, firefox, webkit.'
      );
      expect(chromium.launch).not.toHaveBeenCalled();
      expect(firefox.launch).not.toHaveBeenCalled();
      expect(webkit.launch).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(opts.runDir, { recursive: true, force: true });
    }
  });

  it("launches firefox when specified", async () => {
    const opts = makeOptions({ engine: "firefox" });
    try {
      await launchBrowser(opts);
      expect(firefox.launch).toHaveBeenCalledWith({ headless: true, slowMo: 0, channel: undefined });
    } finally {
      fs.rmSync(opts.runDir, { recursive: true, force: true });
    }
  });

  it("launches webkit when specified", async () => {
    const opts = makeOptions({ engine: "webkit" });
    try {
      await launchBrowser(opts);
      expect(webkit.launch).toHaveBeenCalledWith({ headless: true, slowMo: 0, channel: undefined });
    } finally {
      fs.rmSync(opts.runDir, { recursive: true, force: true });
    }
  });

  it("passes headless and slowMo to launch", async () => {
    const opts = makeOptions({ headless: false, slowMo: 200 });
    try {
      await launchBrowser(opts);
      expect(chromium.launch).toHaveBeenCalledWith({ headless: false, slowMo: 200, channel: undefined });
    } finally {
      fs.rmSync(opts.runDir, { recursive: true, force: true });
    }
  });

  it("passes channel to engine launch", async () => {
    const opts = makeOptions({ channel: "chrome" });
    try {
      await launchBrowser(opts);
      expect(chromium.launch).toHaveBeenCalledWith({ headless: true, slowMo: 0, channel: "chrome" });
    } finally {
      fs.rmSync(opts.runDir, { recursive: true, force: true });
    }
  });

  it("does not pass channel by default", async () => {
    const opts = makeOptions();
    try {
      await launchBrowser(opts);
      expect(chromium.launch).toHaveBeenCalledWith({ headless: true, slowMo: 0, channel: undefined });
    } finally {
      fs.rmSync(opts.runDir, { recursive: true, force: true });
    }
  });

  it("sets page timeouts", async () => {
    const opts = makeOptions({ timeout: 15000 });
    try {
      const session = await launchBrowser(opts);
      expect(session.page.setDefaultTimeout).toHaveBeenCalledWith(15000);
      expect(session.page.setDefaultNavigationTimeout).toHaveBeenCalledWith(15000);
    } finally {
      fs.rmSync(opts.runDir, { recursive: true, force: true });
    }
  });

  it("loads storage state when file exists", async () => {
    const opts = makeOptions();
    const storagePath = path.join(opts.runDir, "auth-state.json");
    fs.writeFileSync(storagePath, JSON.stringify({ cookies: [] }));
    opts.storageStatePath = storagePath;
    try {
      await launchBrowser(opts);
      const browser = await (chromium.launch as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(browser.newContext).toHaveBeenCalledWith(
        expect.objectContaining({ storageState: storagePath })
      );
    } finally {
      fs.rmSync(opts.runDir, { recursive: true, force: true });
    }
  });

  it("skips storage state when file does not exist", async () => {
    const opts = makeOptions({ storageStatePath: "/nonexistent/auth.json" });
    try {
      await launchBrowser(opts);
      const browser = await (chromium.launch as ReturnType<typeof vi.fn>).mock.results[0].value;
      const callArgs = browser.newContext.mock.calls[0][0] ?? {};
      expect(callArgs.storageState).toBeUndefined();
    } finally {
      fs.rmSync(opts.runDir, { recursive: true, force: true });
    }
  });

  it("warns when storage state path is set but file missing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const opts = makeOptions({ storageStatePath: "/nonexistent/auth.json" });
    try {
      await launchBrowser(opts);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("/nonexistent/auth.json")
      );
    } finally {
      warnSpy.mockRestore();
      fs.rmSync(opts.runDir, { recursive: true, force: true });
    }
  });

  it("starts tracing when trace is true", async () => {
    const opts = makeOptions({ trace: true });
    try {
      const session = await launchBrowser(opts);
      expect(session.tracePath).toBe(path.join(opts.runDir, "trace.zip"));
      expect(session.context.tracing.start).toHaveBeenCalledWith({
        screenshots: true,
        snapshots: true,
        sources: true
      });
    } finally {
      fs.rmSync(opts.runDir, { recursive: true, force: true });
    }
  });

  it("does not start tracing when trace is false", async () => {
    const opts = makeOptions({ trace: false });
    try {
      const session = await launchBrowser(opts);
      expect(session.tracePath).toBeUndefined();
      expect(session.context.tracing.start).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(opts.runDir, { recursive: true, force: true });
    }
  });

  it("configures HAR recording when enabled", async () => {
    const opts = makeOptions({ recordHar: true });
    try {
      await launchBrowser(opts);
      const browser = await (chromium.launch as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(browser.newContext).toHaveBeenCalledWith(
        expect.objectContaining({
          recordHar: { path: path.join(opts.runDir, "network.har") }
        })
      );
    } finally {
      fs.rmSync(opts.runDir, { recursive: true, force: true });
    }
  });

  it("passes viewport to context", async () => {
    const opts = makeOptions({ viewport: { width: 1920, height: 1080 } });
    try {
      await launchBrowser(opts);
      const browser = await (chromium.launch as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(browser.newContext).toHaveBeenCalledWith(
        expect.objectContaining({ viewport: { width: 1920, height: 1080 } })
      );
    } finally {
      fs.rmSync(opts.runDir, { recursive: true, force: true });
    }
  });

  it("closes the browser when setup fails after launch", async () => {
    const browser = await chromium.launch();
    (chromium.launch as ReturnType<typeof vi.fn>).mockClear();
    const originalNewContext = browser.newContext;
    browser.newContext = vi.fn(async () => {
      throw new Error("context failed");
    }) as typeof browser.newContext;

    const opts = makeOptions();
    try {
      await expect(launchBrowser(opts)).rejects.toThrow("context failed");
      expect(browser.close).toHaveBeenCalled();
    } finally {
      browser.newContext = originalNewContext;
      fs.rmSync(opts.runDir, { recursive: true, force: true });
    }
  });
});

describe("closeBrowser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stops tracing and closes context and browser", async () => {
    const opts = makeOptions({ trace: true });
    try {
      const session = await launchBrowser(opts);
      await closeBrowser(session);
      expect(session.context.tracing.stop).toHaveBeenCalledWith({
        path: session.tracePath
      });
      expect(session.context.close).toHaveBeenCalled();
      expect(session.browser.close).toHaveBeenCalled();
    } finally {
      fs.rmSync(opts.runDir, { recursive: true, force: true });
    }
  });

  it("skips tracing stop when no trace path", async () => {
    const opts = makeOptions({ trace: false });
    try {
      const session = await launchBrowser(opts);
      await closeBrowser(session);
      expect(session.context.tracing.stop).not.toHaveBeenCalled();
      expect(session.context.close).toHaveBeenCalled();
      expect(session.browser.close).toHaveBeenCalled();
    } finally {
      fs.rmSync(opts.runDir, { recursive: true, force: true });
    }
  });

  it("closes the browser when tracing stop fails", async () => {
    const opts = makeOptions({ trace: true });
    try {
      const session = await launchBrowser(opts);
      const originalStop = session.context.tracing.stop;
      session.context.tracing.stop = vi.fn(async () => {
        throw new Error("trace stop failed");
      }) as typeof session.context.tracing.stop;

      await expect(closeBrowser(session)).rejects.toThrow("trace stop failed");
      expect(session.browser.close).toHaveBeenCalled();
      session.context.tracing.stop = originalStop;
    } finally {
      fs.rmSync(opts.runDir, { recursive: true, force: true });
    }
  });
});

describe("createPlaywrightDriver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes malformed quoted text selectors", () => {
    const driver = createPlaywrightDriver({} as Parameters<typeof createPlaywrightDriver>[0]);

    expect(driver.parseTextSelector('text="Delete')).toBe("Delete");
    expect(driver.parseTextSelector("text='Delete")).toBe("Delete");
    expect(driver.parseTextSelector('text="')).toBe("");
    expect(driver.parseTextSelector("text=Delete")).toBe("Delete");
    expect(driver.parseTextSelector("css=button")).toBeNull();
  });

  it("registers response observation through the page", () => {
    const page = { on: vi.fn() };
    const driver = createPlaywrightDriver(page as unknown as Parameters<typeof createPlaywrightDriver>[0]);
    const handler = vi.fn();

    driver.onResponse(handler);

    expect(page.on).toHaveBeenCalledWith("response", handler);
  });

  it("awaits route handlers and fulfillment", async () => {
    const page = { route: vi.fn(async () => undefined) };
    const driver = createPlaywrightDriver(page as unknown as Parameters<typeof createPlaywrightDriver>[0]);
    const fulfill = vi.fn(async () => undefined);

    await driver.route("**/api/users", async (route) => {
      await route.fulfill({ status: 200, body: "{}" });
    });
    const callback = page.route.mock.calls[0][1] as (route: {
      fulfill(response: { status: number; body?: string }): Promise<void>;
      abort(reason: string): Promise<void>;
    }) => Promise<void>;

    await callback({ fulfill, abort: vi.fn(async () => undefined) });

    expect(fulfill).toHaveBeenCalledWith({ status: 200, body: "{}" });
  });

  it("aborts and rethrows when route handlers fail", async () => {
    const page = { route: vi.fn(async () => undefined) };
    const driver = createPlaywrightDriver(page as unknown as Parameters<typeof createPlaywrightDriver>[0]);
    const abort = vi.fn(async () => undefined);

    await driver.route("**/api/users", async () => {
      throw new Error("mock failed");
    });
    const callback = page.route.mock.calls[0][1] as (route: {
      fulfill(response: { status: number; body?: string }): Promise<void>;
      abort(reason: string): Promise<void>;
    }) => Promise<void>;

    await expect(callback({ fulfill: vi.fn(async () => undefined), abort })).rejects.toThrow(
      "Route handler failed for **/api/users: mock failed"
    );
    expect(abort).toHaveBeenCalledWith("failed");
  });

  it("handles dialog action rejections inside the listener", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const page = { once: vi.fn() };
    const driver = createPlaywrightDriver(page as unknown as Parameters<typeof createPlaywrightDriver>[0]);

    try {
      driver.onDialog("accept");
      const callback = page.once.mock.calls[0][1] as (dialog: {
        accept(): Promise<void>;
        dismiss(): Promise<void>;
      }) => void;
      callback({
        accept: vi.fn(async () => {
          throw new Error("page closed");
        }),
        dismiss: vi.fn(async () => undefined)
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(warnSpy).toHaveBeenCalledWith("Failed to accept dialog: page closed");
    } finally {
      warnSpy.mockRestore();
    }
  });
});
