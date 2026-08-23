import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  closeIosSession,
  injectUsePortIntoXctestrun,
  launchIosSession,
  resolveWdaProject,
  wdaTestRunArgs,
  WDA_RUNNER_BUNDLE_ID,
  type WdaTestRunPreparer
} from "../src/browser/ios-helper.js";
import type { IosAgentClient } from "../src/browser/ios-driver.js";
import type { SimctlResult, SimctlRunner, XcrunSpawner } from "../src/browser/ios-simctl.js";

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

/** Records every spawned xcodebuild-test process and whether it was killed. */
function fakeSpawner(): XcrunSpawner & { spawns: { args: string[]; killed: boolean }[] } {
  const spawns: { args: string[]; killed: boolean }[] = [];
  const spawner: XcrunSpawner = (args) => {
    const record = { args, killed: false };
    spawns.push(record);
    return {
      kill: () => {
        record.killed = true;
      }
    };
  };
  return Object.assign(spawner, { spawns });
}

/** Preparer that records the port each launch requested and returns a port-tagged path. */
function fakePreparer(): WdaTestRunPreparer & { ports: number[] } {
  const ports: number[] = [];
  const preparer: WdaTestRunPreparer = async ({ xctestrunPath, port }) => {
    ports.push(port);
    return `${xctestrunPath}#port=${port}`;
  };
  return Object.assign(preparer, { ports });
}

const BASE_TESTRUN = "/fake/WebDriverAgentRunner.xctestrun";

const BOOTED_JSON = JSON.stringify({
  devices: {
    "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [
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

/** The `-xctestrun` argument of a recorded `xcodebuild test-without-building` spawn. */
function xctestrunArg(args: string[]): string | undefined {
  const index = args.indexOf("-xctestrun");
  return index >= 0 ? args[index + 1] : undefined;
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

describe("wdaTestRunArgs", () => {
  it("builds an `xcodebuild test-without-building` command for the destination", () => {
    expect(wdaTestRunArgs("/tmp/wda.xctestrun", "BBBB")).toEqual([
      "xcodebuild",
      "test-without-building",
      "-xctestrun",
      "/tmp/wda.xctestrun",
      "-destination",
      "id=BBBB"
    ]);
  });
});

describe("injectUsePortIntoXctestrun", () => {
  it("sets USE_PORT on a format-1 test target's EnvironmentVariables", () => {
    const plist = {
      WebDriverAgentRunner: {
        TestHostPath: "__TESTROOT__/Runner.app",
        TestBundlePath: "__TESTHOST__/PlugIns/WebDriverAgentRunner.xctest",
        EnvironmentVariables: { DYLD_FRAMEWORK_PATH: "__TESTROOT__" }
      },
      __xctestrun_metadata__: { FormatVersion: 1 }
    };
    const out = injectUsePortIntoXctestrun(plist, 8123) as typeof plist;
    expect(out.WebDriverAgentRunner.EnvironmentVariables).toMatchObject({
      DYLD_FRAMEWORK_PATH: "__TESTROOT__",
      USE_PORT: "8123"
    });
    // The original is not mutated.
    expect(
      (plist.WebDriverAgentRunner.EnvironmentVariables as Record<string, unknown>).USE_PORT
    ).toBeUndefined();
  });

  it("sets USE_PORT on a format-2 TestConfigurations tree, creating env when absent", () => {
    const plist = {
      TestConfigurations: [
        {
          Name: "Configuration 1",
          TestTargets: [
            { BlueprintName: "WebDriverAgentRunner", TestBundlePath: "__TESTHOST__/WDA.xctest" }
          ]
        }
      ],
      __xctestrun_metadata__: { FormatVersion: 2 }
    };
    const out = injectUsePortIntoXctestrun(plist, 9001) as typeof plist;
    expect(out.TestConfigurations[0].TestTargets[0]).toMatchObject({
      EnvironmentVariables: { USE_PORT: "9001" }
    });
  });

  it("throws when no test target can be found", () => {
    expect(() => injectUsePortIntoXctestrun({ nothing: true }, 8100)).toThrow(
      "Could not find a test target"
    );
  });
});

describe("launchIosSession", () => {
  it("hosts WDA via xcodebuild test-without-building, launches the target app, and connects", async () => {
    const runner = fakeRunner(BOOTED_JSON);
    const spawner = fakeSpawner();
    const preparer = fakePreparer();
    const agent = new FakeAgent();
    const connector = fakeConnector(agent);

    const session = await launchIosSession({
      app: "com.example.App",
      runner,
      spawner,
      testRunPreparer: preparer,
      portAllocator: async () => 8100,
      agentConnector: connector,
      wdaTestRun: BASE_TESTRUN
    });

    expect(session.bundleId).toBe("com.example.App");
    expect(session.udid).toBe("BBBB");
    expect(connector.seen[0]).toEqual({ port: 8100, bundleId: "com.example.App" });

    // The port was injected into the xctestrun, and WDA was hosted via xcodebuild.
    expect(preparer.ports).toEqual([8100]);
    expect(spawner.spawns).toHaveLength(1);
    const spawnArgs = spawner.spawns[0].args;
    expect(spawnArgs.slice(0, 2)).toEqual(["xcodebuild", "test-without-building"]);
    expect(xctestrunArg(spawnArgs)).toBe(`${BASE_TESTRUN}#port=8100`);
    expect(spawnArgs).toEqual(expect.arrayContaining(["-destination", "id=BBBB"]));

    // The runner .app is never simctl-installed or simctl-launched now.
    expect(runner.calls.some((c) => c.args[1] === "install")).toBe(false);
    expect(
      runner.calls.some((c) => c.args[1] === "launch" && c.args[3] === WDA_RUNNER_BUNDLE_ID)
    ).toBe(false);
    // The target app is launched via simctl.
    expect(
      runner.calls.some((c) => c.args[1] === "launch" && c.args[3] === "com.example.App")
    ).toBe(true);

    await closeIosSession(session);
    await closeIosSession(session);
    expect(agent.closed).toBe(true);
    expect(spawner.spawns[0].killed).toBe(true);
    const terminates = runner.calls.filter((c) => c.args[1] === "terminate").map((c) => c.args[3]);
    expect(terminates).toEqual(expect.arrayContaining([WDA_RUNNER_BUNDLE_ID, "com.example.App"]));
  });

  it("retries WDA startup with a fresh port and kills the failed test process", async () => {
    const lockRoot = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-ios-session-lock-"));
    const runner = fakeRunner(BOOTED_JSON);
    const spawner = fakeSpawner();
    const preparer = fakePreparer();
    const agent = new FakeAgent();
    const connectorPorts: number[] = [];
    const ports = [8500, 8501];

    try {
      const session = await launchIosSession({
        app: "com.example.App",
        runner,
        spawner,
        testRunPreparer: preparer,
        portAllocator: async () => ports.shift() ?? 8599,
        agentConnector: async (options) => {
          connectorPorts.push(options.port);
          if (connectorPorts.length === 1) {
            throw new Error("WDA not ready");
          }
          return agent;
        },
        wdaTestRun: BASE_TESTRUN,
        simulatorLockRoot: lockRoot
      });

      expect(connectorPorts).toEqual([8500, 8501]);
      expect(preparer.ports).toEqual([8500, 8501]);
      expect(spawner.spawns.map((s) => xctestrunArg(s.args))).toEqual([
        `${BASE_TESTRUN}#port=8500`,
        `${BASE_TESTRUN}#port=8501`
      ]);
      // The failed attempt's test process is killed before the retry spawns.
      expect(spawner.spawns[0].killed).toBe(true);

      await closeIosSession(session);
      expect(spawner.spawns[1].killed).toBe(true);
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
        spawner: fakeSpawner(),
        testRunPreparer: fakePreparer(),
        portAllocator: async () => 8600,
        agentConnector: fakeConnector(new FakeAgent()),
        wdaTestRun: BASE_TESTRUN,
        simulatorLockRoot: lockRoot
      });

      await expect(
        launchIosSession({
          app: "com.example.App",
          runner: fakeRunner(BOOTED_JSON),
          spawner: fakeSpawner(),
          testRunPreparer: fakePreparer(),
          portAllocator: async () => 8601,
          agentConnector: fakeConnector(new FakeAgent()),
          wdaTestRun: BASE_TESTRUN,
          simulatorLockRoot: lockRoot
        })
      ).rejects.toThrow('iOS simulator "BBBB" is already reserved');

      await closeIosSession(first);
      const second = await launchIosSession({
        app: "com.example.App",
        runner: fakeRunner(BOOTED_JSON),
        spawner: fakeSpawner(),
        testRunPreparer: fakePreparer(),
        portAllocator: async () => 8602,
        agentConnector: fakeConnector(new FakeAgent()),
        wdaTestRun: BASE_TESTRUN,
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
        spawner: fakeSpawner(),
        testRunPreparer: fakePreparer(),
        portAllocator: async () => 8200,
        agentConnector: fakeConnector(new FakeAgent()),
        wdaTestRun: BASE_TESTRUN
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
        spawner: fakeSpawner(),
        testRunPreparer: fakePreparer(),
        portAllocator: async () => 8300,
        agentConnector: fakeConnector(new FakeAgent()),
        wdaTestRun: BASE_TESTRUN
      });
      expect(
        runner.calls.some((c) => c.args[1] === "uninstall" && c.args[3] === "com.derived.App")
      ).toBe(true);
      await closeIosSession(session);
    } finally {
      fs.rmSync(path.dirname(appPath), { recursive: true, force: true });
    }
  });

  it("rejects coldStart with a bare bundle id (actionable error) before spawning", async () => {
    const runner = fakeRunner(BOOTED_JSON);
    const spawner = fakeSpawner();
    const connector = fakeConnector(new FakeAgent());
    await expect(
      launchIosSession({
        app: "com.example.App",
        coldStart: true,
        runner,
        spawner,
        testRunPreparer: fakePreparer(),
        agentConnector: connector,
        wdaTestRun: BASE_TESTRUN
      })
    ).rejects.toThrow("coldStart requires target.app to be a built .app bundle path");
    expect(connector.seen).toHaveLength(0);
    expect(spawner.spawns).toHaveLength(0);
  });

  it("fails on multiple booted simulators before spawning", async () => {
    const runner = fakeRunner(
      JSON.stringify({
        devices: {
          "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [
            { udid: "BBBB", name: "iPhone 16 Pro", state: "Booted" },
            { udid: "DDDD", name: "iPhone 16", state: "Booted" }
          ]
        }
      })
    );
    const spawner = fakeSpawner();
    const connector = fakeConnector(new FakeAgent());
    await expect(
      launchIosSession({
        app: "com.example.App",
        runner,
        spawner,
        testRunPreparer: fakePreparer(),
        agentConnector: connector,
        wdaTestRun: BASE_TESTRUN
      })
    ).rejects.toThrow("Multiple iOS simulators are booted");
    expect(connector.seen).toHaveLength(0);
    expect(spawner.spawns).toHaveLength(0);
  });

  it("rejects a target app outside allowedApps before install/spawn", async () => {
    const runner = fakeRunner(BOOTED_JSON);
    const spawner = fakeSpawner();
    await expect(
      launchIosSession({
        app: "com.example.App",
        runner,
        spawner,
        testRunPreparer: fakePreparer(),
        agentConnector: fakeConnector(new FakeAgent()),
        wdaTestRun: BASE_TESTRUN,
        allowedApps: ["com.other.App"]
      })
    ).rejects.toThrow("not in guardrails.allowedApps");
    expect(runner.calls.some((c) => c.args[1] === "install")).toBe(false);
    expect(spawner.spawns).toHaveLength(0);
  });

  it("tears down the WDA test process and target app when the connector fails", async () => {
    const runner = fakeRunner(BOOTED_JSON);
    const spawner = fakeSpawner();
    await expect(
      launchIosSession({
        app: "com.example.App",
        runner,
        spawner,
        testRunPreparer: fakePreparer(),
        portAllocator: async () => 8400,
        agentConnector: async () => {
          throw new Error("WDA unreachable");
        },
        wdaTestRun: BASE_TESTRUN
      })
    ).rejects.toThrow("WDA unreachable");
    // Both startup attempts spawn a test process; both are killed on teardown.
    expect(spawner.spawns).toHaveLength(2);
    expect(spawner.spawns.every((s) => s.killed)).toBe(true);
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
    const spawner = fakeSpawner();
    try {
      await expect(
        launchIosSession({
          app: "com.example.App",
          runner: failingRunner,
          spawner,
          testRunPreparer: fakePreparer(),
          portAllocator: async () => 8700,
          agentConnector: fakeConnector(new FakeAgent()),
          wdaTestRun: BASE_TESTRUN,
          simulatorLockRoot: lockRoot
        })
      ).rejects.toThrow('Failed to launch "com.example.App"');

      // A target-launch failure is not retried (it won't get better): one spawn, killed.
      expect(spawner.spawns).toHaveLength(1);
      expect(spawner.spawns[0].killed).toBe(true);
      const terminates = failingRunner.calls
        .filter((c) => c.args[1] === "terminate")
        .map((c) => c.args[3]);
      expect(terminates).toEqual(expect.arrayContaining([WDA_RUNNER_BUNDLE_ID, "com.example.App"]));

      const session = await launchIosSession({
        app: "com.example.App",
        runner: fakeRunner(BOOTED_JSON),
        spawner: fakeSpawner(),
        testRunPreparer: fakePreparer(),
        portAllocator: async () => 8701,
        agentConnector: fakeConnector(new FakeAgent()),
        wdaTestRun: BASE_TESTRUN,
        simulatorLockRoot: lockRoot
      });
      await closeIosSession(session);
    } finally {
      fs.rmSync(lockRoot, { recursive: true, force: true });
    }
  });
});
