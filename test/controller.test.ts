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
      setDefaultNavigationTimeout: vi.fn()
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
import { launchBrowser, closeBrowser, type BrowserOptions } from "../src/browser/controller.js";

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
      expect(chromium.launch).toHaveBeenCalledWith({ headless: true, slowMo: 0 });
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
      expect(firefox.launch).toHaveBeenCalledWith({ headless: true, slowMo: 0 });
    } finally {
      fs.rmSync(opts.runDir, { recursive: true, force: true });
    }
  });

  it("launches webkit when specified", async () => {
    const opts = makeOptions({ engine: "webkit" });
    try {
      await launchBrowser(opts);
      expect(webkit.launch).toHaveBeenCalledWith({ headless: true, slowMo: 0 });
    } finally {
      fs.rmSync(opts.runDir, { recursive: true, force: true });
    }
  });

  it("passes headless and slowMo to launch", async () => {
    const opts = makeOptions({ headless: false, slowMo: 200 });
    try {
      await launchBrowser(opts);
      expect(chromium.launch).toHaveBeenCalledWith({ headless: false, slowMo: 200 });
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
});
