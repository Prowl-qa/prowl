import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  closeIosSession,
  launchIosSession,
  resolveWdaProject,
  WDA_RUNNER_BUNDLE_ID
} from "../src/browser/ios-helper.js";
import type { IosAgentClient } from "../src/browser/ios-driver.js";
import type { SimctlResult, SimctlRunner } from "../src/browser/ios-simctl.js";

class FakeAgent implements IosAgentClient {
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
  async sendKeys(): Promise<void> {}
  async homescreen(): Promise<void> {}
  async close(): Promise<void> {
    this.closed = true;
  }
}

type Call = { args: string[]; env?: NodeJS.ProcessEnv };

function fakeRunner(
  devicesJson: string,
  responder: (args: string[]) => Partial<SimctlResult> = () => ({})
): SimctlRunner & { calls: Call[] } {
  const calls: Call[] = [];
  const runner: SimctlRunner = async (args, options) => {
    calls.push({ args, env: options?.env });
    const result: SimctlResult = { stdout: "", stderr: "", code: 0 };
    if (args[0] === "simctl" && args[1] === "list") {
      return { ...result, stdout: devicesJson };
    }
    return { ...result, ...responder(args) };
  };
  return Object.assign(runner, { calls });
}

const BOOTED_JSON = JSON.stringify({
  devices: {
    "com.apple.CoreSimulator.SimRuntime.iOS-18-6": [
      { udid: "BBBB", name: "iPhone 16 Pro", state: "Booted", isAvailable: true }
    ]
  }
});

function fakeConnector(agent: FakeAgent) {
  const seen: { port: number; bundleId: string }[] = [];
  const connector = async (options: { port: number; bundleId: string }) => {
    seen.push({ port: options.port, bundleId: options.bundleId });
    return agent;
  };
  return Object.assign(connector, { seen });
}

/** Build a minimal iOS `.app` bundle (root Info.plist) and return its path. */
function makeAppBundle(bundleId: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-ios-app-"));
  const appPath = path.join(dir, "Example.app");
  fs.mkdirSync(appPath, { recursive: true });
  fs.writeFileSync(
    path.join(appPath, "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>` +
      `<key>CFBundleIdentifier</key><string>${bundleId}</string></dict></plist>\n`
  );
  return appPath;
}

describe("resolveWdaProject", () => {
  it("resolves the WebDriverAgent Xcode project from the installed package", () => {
    const { projectPath, version } = resolveWdaProject();
    expect(fs.existsSync(projectPath)).toBe(true);
    expect(projectPath).toMatch(/WebDriverAgent\.xcodeproj$/);
    expect(version).toMatch(/^\d+\.\d+/);
  });

  it("reports recovery commands when the optional WDA package is missing", () => {
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

    expect(() => resolveWdaProject(requireFn)).toThrow(
      "npm install -g appium-webdriveragent@16.4.0"
    );
    expect(() => resolveWdaProject(requireFn)).toThrow(
      "npm install appium-webdriveragent@16.4.0"
    );
  });
});

describe("launchIosSession", () => {
  it("installs WDA + target app, launches on a dynamic port, and connects", async () => {
    const runner = fakeRunner(BOOTED_JSON);
    const agent = new FakeAgent();
    const connector = fakeConnector(agent);

    const session = await launchIosSession({
      app: "com.example.App",
      runner,
      portAllocator: async () => 8100,
      agentConnector: connector,
      wdaRunnerApp: "/fake/WebDriverAgentRunner-Runner.app"
    });

    expect(session.bundleId).toBe("com.example.App");
    expect(session.udid).toBe("BBBB");
    expect(connector.seen[0]).toEqual({ port: 8100, bundleId: "com.example.App" });

    // WDA runner installed and launched with the USE_PORT child env.
    const installs = runner.calls.filter((c) => c.args[1] === "install").map((c) => c.args[3]);
    expect(installs).toContain("/fake/WebDriverAgentRunner-Runner.app");
    const wdaLaunch = runner.calls.find(
      (c) => c.args[1] === "launch" && c.args[3] === WDA_RUNNER_BUNDLE_ID
    );
    expect(wdaLaunch?.env).toEqual({ SIMCTL_CHILD_USE_PORT: "8100" });
    // Target app is launched too.
    expect(
      runner.calls.some((c) => c.args[1] === "launch" && c.args[3] === "com.example.App")
    ).toBe(true);

    await closeIosSession(session);
    await closeIosSession(session);
    expect(agent.closed).toBe(true);
    const terminates = runner.calls.filter((c) => c.args[1] === "terminate").map((c) => c.args[3]);
    expect(terminates).toEqual(expect.arrayContaining([WDA_RUNNER_BUNDLE_ID, "com.example.App"]));
  });

  it("retries WDA startup with a fresh port and cleans up the failed attempt", async () => {
    const lockRoot = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-ios-session-lock-"));
    const runner = fakeRunner(BOOTED_JSON);
    const agent = new FakeAgent();
    const connectorPorts: number[] = [];
    const ports = [8500, 8501];

    try {
      const session = await launchIosSession({
        app: "com.example.App",
        runner,
        portAllocator: async () => ports.shift() ?? 8599,
        agentConnector: async (options) => {
          connectorPorts.push(options.port);
          if (connectorPorts.length === 1) {
            throw new Error("WDA not ready");
          }
          return agent;
        },
        wdaRunnerApp: "/fake/WebDriverAgentRunner-Runner.app",
        simulatorLockRoot: lockRoot
      });

      expect(connectorPorts).toEqual([8500, 8501]);
      const wdaLaunches = runner.calls.filter(
        (c) => c.args[1] === "launch" && c.args[3] === WDA_RUNNER_BUNDLE_ID
      );
      expect(wdaLaunches.map((c) => c.env)).toEqual([
        { SIMCTL_CHILD_USE_PORT: "8500" },
        { SIMCTL_CHILD_USE_PORT: "8501" }
      ]);

      const firstWdaLaunch = runner.calls.findIndex(
        (c) => c.args[1] === "launch" && c.args[3] === WDA_RUNNER_BUNDLE_ID
      );
      const secondWdaLaunch = runner.calls.findIndex(
        (c, index) =>
          index > firstWdaLaunch && c.args[1] === "launch" && c.args[3] === WDA_RUNNER_BUNDLE_ID
      );
      const failedWdaTerminate = runner.calls.findIndex(
        (c, index) =>
          index > firstWdaLaunch && c.args[1] === "terminate" && c.args[3] === WDA_RUNNER_BUNDLE_ID
      );
      expect(failedWdaTerminate).toBeGreaterThan(firstWdaLaunch);
      expect(failedWdaTerminate).toBeLessThan(secondWdaLaunch);

      await closeIosSession(session);
      expect(
        runner.calls.filter((c) => c.args[1] === "terminate" && c.args[3] === WDA_RUNNER_BUNDLE_ID)
      ).toHaveLength(2);
    } finally {
      fs.rmSync(lockRoot, { recursive: true, force: true });
    }
  });

  it("holds the simulator reservation until teardown", async () => {
    const lockRoot = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-ios-session-lock-"));
    try {
      const first = await launchIosSession({
        app: "com.example.App",
        runner: fakeRunner(BOOTED_JSON),
        portAllocator: async () => 8600,
        agentConnector: fakeConnector(new FakeAgent()),
        wdaRunnerApp: "/fake/WebDriverAgentRunner-Runner.app",
        simulatorLockRoot: lockRoot
      });

      await expect(
        launchIosSession({
          app: "com.example.App",
          runner: fakeRunner(BOOTED_JSON),
          portAllocator: async () => 8601,
          agentConnector: fakeConnector(new FakeAgent()),
          wdaRunnerApp: "/fake/WebDriverAgentRunner-Runner.app",
          simulatorLockRoot: lockRoot
        })
      ).rejects.toThrow('iOS simulator "BBBB" is already reserved');

      await closeIosSession(first);
      const second = await launchIosSession({
        app: "com.example.App",
        runner: fakeRunner(BOOTED_JSON),
        portAllocator: async () => 8602,
        agentConnector: fakeConnector(new FakeAgent()),
        wdaRunnerApp: "/fake/WebDriverAgentRunner-Runner.app",
        simulatorLockRoot: lockRoot
      });
      await closeIosSession(second);
    } finally {
      fs.rmSync(lockRoot, { recursive: true, force: true });
    }
  });

  it("installs a .app and derives its bundle id from the root Info.plist", async () => {
    const appPath = makeAppBundle("com.derived.App");
    const runner = fakeRunner(BOOTED_JSON);
    try {
      const session = await launchIosSession({
        app: appPath,
        runner,
        portAllocator: async () => 8200,
        agentConnector: fakeConnector(new FakeAgent()),
        wdaRunnerApp: "/fake/runner.app"
      });
      expect(session.bundleId).toBe("com.derived.App");
      const installs = runner.calls.filter((c) => c.args[1] === "install").map((c) => c.args[3]);
      expect(installs).toContain(path.resolve(appPath));
      await closeIosSession(session);
    } finally {
      fs.rmSync(path.dirname(appPath), { recursive: true, force: true });
    }
  });

  it("uninstalls before reinstalling a .app when coldStart is set", async () => {
    const appPath = makeAppBundle("com.derived.App");
    const runner = fakeRunner(BOOTED_JSON);
    try {
      const session = await launchIosSession({
        app: appPath,
        coldStart: true,
        runner,
        portAllocator: async () => 8300,
        agentConnector: fakeConnector(new FakeAgent()),
        wdaRunnerApp: "/fake/runner.app"
      });
      expect(
        runner.calls.some((c) => c.args[1] === "uninstall" && c.args[3] === "com.derived.App")
      ).toBe(true);
      await closeIosSession(session);
    } finally {
      fs.rmSync(path.dirname(appPath), { recursive: true, force: true });
    }
  });

  it("rejects coldStart with a bare bundle id (actionable error) before connecting", async () => {
    const runner = fakeRunner(BOOTED_JSON);
    const connector = fakeConnector(new FakeAgent());
    await expect(
      launchIosSession({
        app: "com.example.App",
        coldStart: true,
        runner,
        agentConnector: connector,
        wdaRunnerApp: "/fake/runner.app"
      })
    ).rejects.toThrow("coldStart requires target.app to be a built .app bundle path");
    expect(connector.seen).toHaveLength(0);
  });

  it("fails on multiple booted simulators before connecting", async () => {
    const runner = fakeRunner(
      JSON.stringify({
        devices: {
          "com.apple.CoreSimulator.SimRuntime.iOS-18-6": [
            { udid: "BBBB", name: "iPhone 16 Pro", state: "Booted" },
            { udid: "DDDD", name: "iPhone 16", state: "Booted" }
          ]
        }
      })
    );
    const connector = fakeConnector(new FakeAgent());
    await expect(
      launchIosSession({
        app: "com.example.App",
        runner,
        agentConnector: connector,
        wdaRunnerApp: "/fake/runner.app"
      })
    ).rejects.toThrow("Multiple iOS simulators are booted");
    expect(connector.seen).toHaveLength(0);
  });

  it("rejects a target app outside allowedApps before install", async () => {
    const runner = fakeRunner(BOOTED_JSON);
    await expect(
      launchIosSession({
        app: "com.example.App",
        runner,
        agentConnector: fakeConnector(new FakeAgent()),
        wdaRunnerApp: "/fake/runner.app",
        allowedApps: ["com.other.App"]
      })
    ).rejects.toThrow("not in guardrails.allowedApps");
    expect(runner.calls.some((c) => c.args[1] === "install")).toBe(false);
  });

  it("tears down the WDA runner and target app when the connector fails", async () => {
    const runner = fakeRunner(BOOTED_JSON);
    await expect(
      launchIosSession({
        app: "com.example.App",
        runner,
        portAllocator: async () => 8400,
        agentConnector: async () => {
          throw new Error("WDA unreachable");
        },
        wdaRunnerApp: "/fake/runner.app"
      })
    ).rejects.toThrow("WDA unreachable");
    const terminates = runner.calls.filter((c) => c.args[1] === "terminate").map((c) => c.args[3]);
    expect(terminates).toEqual(expect.arrayContaining([WDA_RUNNER_BUNDLE_ID, "com.example.App"]));
  });

  it("tears down and releases the simulator when the target app launch fails", async () => {
    const lockRoot = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-ios-session-lock-"));
    const failingRunner = fakeRunner(BOOTED_JSON, (args) =>
      args[1] === "launch" && args[3] === "com.example.App"
        ? { code: 1, stderr: "not installed" }
        : {}
    );
    try {
      await expect(
        launchIosSession({
          app: "com.example.App",
          runner: failingRunner,
          portAllocator: async () => 8700,
          agentConnector: fakeConnector(new FakeAgent()),
          wdaRunnerApp: "/fake/runner.app",
          simulatorLockRoot: lockRoot
        })
      ).rejects.toThrow('Failed to launch "com.example.App"');

      expect(
        failingRunner.calls.filter((c) => c.args[1] === "launch" && c.args[3] === WDA_RUNNER_BUNDLE_ID)
      ).toHaveLength(1);
      const terminates = failingRunner.calls
        .filter((c) => c.args[1] === "terminate")
        .map((c) => c.args[3]);
      expect(terminates).toEqual(expect.arrayContaining([WDA_RUNNER_BUNDLE_ID, "com.example.App"]));

      const session = await launchIosSession({
        app: "com.example.App",
        runner: fakeRunner(BOOTED_JSON),
        portAllocator: async () => 8701,
        agentConnector: fakeConnector(new FakeAgent()),
        wdaRunnerApp: "/fake/runner.app",
        simulatorLockRoot: lockRoot
      });
      await closeIosSession(session);
    } finally {
      fs.rmSync(lockRoot, { recursive: true, force: true });
    }
  });
});
