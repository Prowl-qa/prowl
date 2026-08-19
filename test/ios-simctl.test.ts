import { describe, expect, it } from "vitest";
import {
  bootedSimulators,
  captureScreenshot,
  execFileXcrunRunner,
  findFreePort,
  installApp,
  launchApp,
  listSimulators,
  parseSimctlDevices,
  parseXcodeVersion,
  selectSimulatorUdid,
  terminateApp,
  uninstallApp,
  xcodeVersion,
  type SimctlResult,
  type SimctlRunner
} from "../src/browser/ios-simctl.js";

type Call = { args: string[]; env?: NodeJS.ProcessEnv };

function fakeRunner(
  responder: (args: string[]) => Partial<SimctlResult>
): SimctlRunner & { calls: Call[] } {
  const calls: Call[] = [];
  const runner: SimctlRunner = async (args, options) => {
    calls.push({ args, env: options?.env });
    return { stdout: "", stderr: "", code: 0, ...responder(args) };
  };
  return Object.assign(runner, { calls });
}

const DEVICES_JSON = JSON.stringify({
  devices: {
    "com.apple.CoreSimulator.SimRuntime.iOS-18-6": [
      { udid: "AAAA", name: "iPhone 16", state: "Shutdown", isAvailable: true },
      { udid: "BBBB", name: "iPhone 16 Pro", state: "Booted", isAvailable: true }
    ],
    "com.apple.CoreSimulator.SimRuntime.iOS-26-2": [
      { udid: "CCCC", name: "iPhone 17", state: "Shutdown", isAvailable: true }
    ]
  }
});

describe("parseSimctlDevices / bootedSimulators", () => {
  it("flattens the runtime→devices map and folds the runtime in", () => {
    const devices = parseSimctlDevices(DEVICES_JSON);
    expect(devices).toHaveLength(3);
    expect(devices[0]).toEqual({
      udid: "AAAA",
      name: "iPhone 16",
      state: "Shutdown",
      runtime: "com.apple.CoreSimulator.SimRuntime.iOS-18-6",
      isAvailable: true
    });
    expect(bootedSimulators(devices).map((d) => d.udid)).toEqual(["BBBB"]);
  });

  it("returns an empty list for missing devices and throws on malformed JSON", () => {
    expect(parseSimctlDevices(JSON.stringify({}))).toEqual([]);
    expect(() => parseSimctlDevices("not json")).toThrow("Could not parse");
  });
});

describe("selectSimulatorUdid", () => {
  it("returns the only booted simulator", () => {
    expect(selectSimulatorUdid(parseSimctlDevices(DEVICES_JSON))).toBe("BBBB");
  });

  it("errors with a describing list when several are booted", () => {
    const devices = parseSimctlDevices(
      JSON.stringify({
        devices: {
          "com.apple.CoreSimulator.SimRuntime.iOS-18-6": [
            { udid: "BBBB", name: "iPhone 16 Pro", state: "Booted" },
            { udid: "DDDD", name: "iPhone 16", state: "Booted" }
          ]
        }
      })
    );
    expect(() => selectSimulatorUdid(devices)).toThrow("Multiple iOS simulators are booted");
    expect(() => selectSimulatorUdid(devices)).toThrow("iPhone 16 Pro");
  });

  it("errors when nothing is booted", () => {
    expect(() => selectSimulatorUdid(parseSimctlDevices(DEVICES_JSON).filter((d) => d.state !== "Booted"))).toThrow(
      "No booted iOS simulator found"
    );
  });

  it("honors a requested udid and validates its state", () => {
    const devices = parseSimctlDevices(DEVICES_JSON);
    expect(selectSimulatorUdid(devices, "BBBB")).toBe("BBBB");
    expect(() => selectSimulatorUdid(devices, "ZZZZ")).toThrow('iOS simulator "ZZZZ" was not found');
    expect(() => selectSimulatorUdid(devices, "AAAA")).toThrow("is not booted (state: Shutdown)");
  });
});

describe("parseXcodeVersion", () => {
  it("extracts the version from xcodebuild output", () => {
    expect(parseXcodeVersion("Xcode 26.2\nBuild version 17C52")).toBe("26.2");
    expect(parseXcodeVersion("nope")).toBeNull();
  });
});

describe("simctl lifecycle wrappers", () => {
  it("lists simulators and surfaces failures", async () => {
    const ok = fakeRunner(() => ({ stdout: DEVICES_JSON }));
    expect((await listSimulators(ok)).map((d) => d.udid)).toContain("BBBB");
    expect(ok.calls.at(-1)?.args).toEqual(["simctl", "list", "devices", "--json"]);

    const broken = fakeRunner(() => ({ code: 72, stderr: "xcode-select: no developer tools" }));
    await expect(listSimulators(broken)).rejects.toThrow("simctl list devices` failed");
  });

  it("installs an app bundle and surfaces failures", async () => {
    const runner = fakeRunner(() => ({}));
    await installApp(runner, "BBBB", "/tmp/App.app");
    expect(runner.calls.at(-1)?.args).toEqual(["simctl", "install", "BBBB", "/tmp/App.app"]);

    const failing = fakeRunner(() => ({ code: 1, stderr: "invalid bundle" }));
    await expect(installApp(failing, "BBBB", "/tmp/App.app")).rejects.toThrow("Failed to install");
  });

  it("launches with SIMCTL_CHILD_ env forwarding and flags failures", async () => {
    const runner = fakeRunner(() => ({ stdout: "com.example.App: 4242" }));
    await launchApp(runner, "BBBB", "com.example.App", { USE_PORT: "8100" });
    expect(runner.calls.at(-1)?.args).toEqual(["simctl", "launch", "BBBB", "com.example.App"]);
    expect(runner.calls.at(-1)?.env).toEqual({ SIMCTL_CHILD_USE_PORT: "8100" });

    const missing = fakeRunner(() => ({ code: 3, stderr: "Unable to launch: not installed" }));
    await expect(launchApp(missing, "BBBB", "com.absent")).rejects.toThrow(
      'Failed to launch "com.absent"'
    );
  });

  it("terminates and uninstalls best-effort (ignoring failures)", async () => {
    const runner = fakeRunner(() => ({ code: 1, stderr: "not running" }));
    await expect(terminateApp(runner, "BBBB", "com.example.App")).resolves.toBeUndefined();
    expect(runner.calls.at(-1)?.args).toEqual(["simctl", "terminate", "BBBB", "com.example.App"]);
    await expect(uninstallApp(runner, "BBBB", "com.example.App")).resolves.toBeUndefined();
    expect(runner.calls.at(-1)?.args).toEqual(["simctl", "uninstall", "BBBB", "com.example.App"]);
  });

  it("captures a screenshot to a path and surfaces failures", async () => {
    const runner = fakeRunner(() => ({}));
    await captureScreenshot(runner, "BBBB", "/tmp/out.png");
    expect(runner.calls.at(-1)?.args).toEqual(["simctl", "io", "BBBB", "screenshot", "/tmp/out.png"]);

    const failing = fakeRunner(() => ({ code: 1, stderr: "device not booted" }));
    await expect(captureScreenshot(failing, "BBBB", "/tmp/out.png")).rejects.toThrow(
      "Failed to capture a simulator screenshot"
    );
  });

  it("reads the Xcode version or returns null", async () => {
    const ok = fakeRunner(() => ({ stdout: "Xcode 26.2\nBuild version 17C52" }));
    expect(await xcodeVersion(ok)).toBe("26.2");
    const missing = fakeRunner(() => ({ code: 1, stderr: "no xcodebuild" }));
    expect(await xcodeVersion(missing)).toBeNull();
  });

  it("preserves xcrun spawn errors when stderr is empty", async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = "";
    try {
      const result = await execFileXcrunRunner(["simctl", "help"], { timeoutMs: 100 });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toMatch(/xcrun|ENOENT|spawn/i);
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

describe("findFreePort", () => {
  it("allocates a usable local port", async () => {
    const port = await findFreePort();
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThanOrEqual(65535);
  });
});
