import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  closeAndroidSession,
  launchAndroidSession,
  resolveAgentApks
} from "../src/browser/android-helper.js";
import type { AndroidAgentClient } from "../src/browser/android-driver.js";
import type { AdbResult, AdbRunner, AdbSpawner } from "../src/browser/android-adb.js";

class FakeAgent implements AndroidAgentClient {
  closed = false;
  async findElement(): Promise<string | null> {
    return "el";
  }
  async findElements(): Promise<string[]> {
    return ["el"];
  }
  async click(): Promise<void> {}
  async setValue(): Promise<void> {}
  async getText(): Promise<string | null> {
    return null;
  }
  async pressKeyCode(): Promise<void> {}
  async screenshotPng(): Promise<Buffer> {
    return Buffer.from("PNG");
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

function fakeRunner(devicesStdout: string): AdbRunner & { calls: string[][] } {
  const calls: string[][] = [];
  const runner: AdbRunner = async (args) => {
    calls.push(args);
    const result: AdbResult = { stdout: "", stderr: "", code: 0 };
    if (args[0] === "devices") {
      return { ...result, stdout: devicesStdout };
    }
    if (args.includes("install")) {
      return { ...result, stdout: "Success" };
    }
    if (args.includes("monkey")) {
      return { ...result, stdout: "Events injected: 1" };
    }
    if (args.includes("forward") && args.includes("tcp:0")) {
      return { ...result, stdout: "40000\n" };
    }
    if (args.includes("clear")) {
      return { ...result, stdout: "Success" };
    }
    return result;
  };
  return Object.assign(runner, { calls });
}

const APKS = { serverApk: "/fake/server.apk", testApk: "/fake/test.apk" };

describe("resolveAgentApks", () => {
  it("resolves both prebuilt APKs from the installed package", () => {
    const apks = resolveAgentApks();
    expect(fs.existsSync(apks.serverApk)).toBe(true);
    expect(fs.existsSync(apks.testApk)).toBe(true);
    expect(apks.serverApk).toMatch(/appium-uiautomator2-server-v[\d.]+\.apk$/);
    expect(apks.testApk).toMatch(/androidTest\.apk$/);
  });

  it("reports recovery commands when the optional agent package is missing", () => {
    const requireFn = Object.assign(
      (() => {
        throw new Error("unexpected require call");
      }) as NodeRequire,
      {
        resolve: () => {
          throw new Error("missing optional dependency");
        }
      }
    );

    expect(() => resolveAgentApks(requireFn)).toThrow(
      "npm install -g appium-uiautomator2-server@10.6.2"
    );
    expect(() => resolveAgentApks(requireFn)).toThrow(
      "npm install appium-uiautomator2-server@10.6.2"
    );
  });
});

describe("launchAndroidSession", () => {
  function fakeConnector(agent: FakeAgent) {
    const seen: { port: number; appPackage?: string }[] = [];
    const connector = async (options: { port: number; appPackage?: string }) => {
      seen.push({ port: options.port, appPackage: options.appPackage });
      return agent;
    };
    return Object.assign(connector, { seen });
  }

  it("installs the agent, launches, forwards a dynamic port, and connects", async () => {
    const runner = fakeRunner("emulator-5554 device\n");
    const killed = { count: 0 };
    const spawner: AdbSpawner = () => ({ kill: () => (killed.count += 1) });
    const agent = new FakeAgent();
    const connector = fakeConnector(agent);

    const session = await launchAndroidSession({
      app: "com.example.app",
      runner,
      spawner,
      agentConnector: connector,
      apks: APKS
    });

    expect(session.package).toBe("com.example.app");
    expect(session.serial).toBe("emulator-5554");
    expect(connector.seen[0].port).toBe(40000);
    // The resolved package reaches the agent client so bare `id=` selectors qualify.
    expect(connector.seen[0].appPackage).toBe("com.example.app");
    // Both agent APKs were installed.
    const installs = runner.calls.filter((c) => c.includes("install")).map((c) => c[c.length - 1]);
    expect(installs).toEqual(expect.arrayContaining([APKS.serverApk, APKS.testApk]));

    await closeAndroidSession(session);
    await closeAndroidSession(session);
    expect(agent.closed).toBe(true);
    expect(killed.count).toBe(1);
    expect(runner.calls.filter((c) => c.includes("--remove"))).toHaveLength(1);
    expect(runner.calls.filter((c) => c.includes("force-stop"))).toHaveLength(1);
  });

  it("clears package data when coldStart is set", async () => {
    const runner = fakeRunner("emulator-5554 device\n");
    const agent = new FakeAgent();
    const session = await launchAndroidSession({
      app: "com.example.app",
      coldStart: true,
      runner,
      spawner: () => ({ kill: () => undefined }),
      agentConnector: fakeConnector(agent),
      apks: APKS
    });
    expect(runner.calls.some((c) => c.includes("clear"))).toBe(true);
    await closeAndroidSession(session);
  });

  it("fails on multiple attached devices before connecting", async () => {
    const runner = fakeRunner("emulator-5554 device\nemulator-5556 device\n");
    const agent = new FakeAgent();
    const connector = fakeConnector(agent);
    await expect(
      launchAndroidSession({
        app: "com.example.app",
        runner,
        spawner: () => ({ kill: () => undefined }),
        agentConnector: connector,
        apks: APKS
      })
    ).rejects.toThrow("Multiple Android devices attached");
    expect(connector.seen).toHaveLength(0);
  });

  it("installs an .apk and derives its package name via the aapt resolver", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-apk-"));
    const apkPath = path.join(dir, "app-debug.apk");
    fs.writeFileSync(apkPath, "not-a-real-apk");
    const runner = fakeRunner("emulator-5554 device\n");
    const agent = new FakeAgent();
    try {
      const session = await launchAndroidSession({
        app: apkPath,
        runner,
        spawner: () => ({ kill: () => undefined }),
        agentConnector: fakeConnector(agent),
        apks: APKS,
        aaptResolver: async () => "com.derived.pkg"
      });
      expect(session.package).toBe("com.derived.pkg");
      const installs = runner.calls.filter((c) => c.includes("install")).map((c) => c[c.length - 1]);
      expect(installs).toContain(path.resolve(apkPath));
      await closeAndroidSession(session);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects an .apk whose resolved package is outside allowedApps before install", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-apk-"));
    const apkPath = path.join(dir, "app-debug.apk");
    fs.writeFileSync(apkPath, "not-a-real-apk");
    const runner = fakeRunner("emulator-5554 device\n");
    try {
      await expect(
        launchAndroidSession({
          app: apkPath,
          runner,
          spawner: () => ({ kill: () => undefined }),
          agentConnector: fakeConnector(new FakeAgent()),
          apks: APKS,
          aaptResolver: async () => "com.blocked.pkg",
          allowedApps: ["com.allowed.pkg"]
        })
      ).rejects.toThrow("not in guardrails.allowedApps");
      expect(runner.calls.some((c) => c.includes("install"))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("errors when an .apk package name cannot be determined", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-apk-"));
    const apkPath = path.join(dir, "app.apk");
    fs.writeFileSync(apkPath, "x");
    const runner = fakeRunner("emulator-5554 device\n");
    try {
      await expect(
        launchAndroidSession({
          app: apkPath,
          runner,
          spawner: () => ({ kill: () => undefined }),
          agentConnector: fakeConnector(new FakeAgent()),
          apks: APKS,
          aaptResolver: async () => null
        })
      ).rejects.toThrow("Could not determine the package name");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("tears down instrumentation and the forward when the connector fails", async () => {
    const runner = fakeRunner("emulator-5554 device\n");
    const killed = { count: 0 };

    await expect(
      launchAndroidSession({
        app: "com.example.app",
        runner,
        spawner: () => ({ kill: () => (killed.count += 1) }),
        agentConnector: async () => {
          throw new Error("agent unreachable");
        },
        apks: APKS
      })
    ).rejects.toThrow("agent unreachable");

    expect(killed.count).toBe(1);
    expect(runner.calls.some((c) => c.includes("--remove"))).toBe(true);
    expect(runner.calls.some((c) => c.includes("force-stop"))).toBe(true);
  });
});
