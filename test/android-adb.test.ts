import { describe, expect, it } from "vitest";
import {
  bootedDevices,
  clearPackage,
  forceStop,
  forwardDynamicPort,
  installApk,
  launchPackage,
  listDevices,
  parseAaptPackage,
  parseAdbDevices,
  parseForwardPort,
  selectDeviceSerial,
  startInstrumentation,
  withSerial,
  type AdbResult,
  type AdbRunner
} from "../src/browser/android-adb.js";

function fakeRunner(
  responder: (args: string[]) => Partial<AdbResult>
): AdbRunner & { calls: string[][] } {
  const calls: string[][] = [];
  const runner: AdbRunner = async (args) => {
    calls.push(args);
    return { stdout: "", stderr: "", code: 0, ...responder(args) };
  };
  return Object.assign(runner, { calls });
}

const DEVICES_OUTPUT = `List of devices attached
emulator-5554          device product:sdk_gphone64 model:Pixel_6 device:emu64 transport_id:1
ZY223  unauthorized
0A1B2C3D               offline
`;

describe("parseAdbDevices / bootedDevices", () => {
  it("parses serials, states, and descriptors and skips the header", () => {
    const devices = parseAdbDevices(DEVICES_OUTPUT);
    expect(devices).toHaveLength(3);
    expect(devices[0]).toEqual({
      serial: "emulator-5554",
      state: "device",
      description: { product: "sdk_gphone64", model: "Pixel_6", device: "emu64", transport_id: "1" }
    });
    expect(bootedDevices(devices).map((d) => d.serial)).toEqual(["emulator-5554"]);
  });

  it("returns an empty list when nothing is attached", () => {
    expect(parseAdbDevices("List of devices attached\n\n")).toEqual([]);
  });
});

describe("selectDeviceSerial", () => {
  it("returns the only booted device", () => {
    expect(selectDeviceSerial(parseAdbDevices(DEVICES_OUTPUT))).toBe("emulator-5554");
  });

  it("errors with the list when several devices are booted", () => {
    const devices = parseAdbDevices("emulator-5554 device\nemulator-5556 device\n");
    expect(() => selectDeviceSerial(devices)).toThrow(
      "Multiple Android devices attached (emulator-5554, emulator-5556)"
    );
  });

  it("errors when no booted device is present", () => {
    expect(() => selectDeviceSerial([])).toThrow("No booted Android device found");
  });

  it("honors a requested serial and validates its state", () => {
    const devices = parseAdbDevices("emulator-5554 device\nemulator-5556 device\n");
    expect(selectDeviceSerial(devices, "emulator-5556")).toBe("emulator-5556");
    expect(() => selectDeviceSerial(devices, "missing")).toThrow('Android device "missing" is not attached');
    expect(() => selectDeviceSerial(parseAdbDevices("ZY offline\n"), "ZY")).toThrow(
      "present but not ready (state: offline)"
    );
  });
});

describe("parseForwardPort", () => {
  it("parses the dynamically allocated local port", () => {
    expect(parseForwardPort("41000\n")).toBe(41000);
  });
  it("rejects non-numeric or out-of-range output", () => {
    expect(() => parseForwardPort("nope")).toThrow("Could not parse a forwarded port");
    expect(() => parseForwardPort("70000")).toThrow("Could not parse a forwarded port");
  });
});

describe("parseAaptPackage", () => {
  it("extracts the package name from aapt badging output", () => {
    expect(parseAaptPackage("package: name='com.example.app' versionCode='1'")).toBe("com.example.app");
    expect(parseAaptPackage("no package here")).toBeNull();
  });
});

describe("withSerial", () => {
  it("prefixes -s <serial> only when a serial is set", () => {
    expect(withSerial("abc", ["shell", "ls"])).toEqual(["-s", "abc", "shell", "ls"]);
    expect(withSerial(undefined, ["devices"])).toEqual(["devices"]);
  });
});

describe("adb lifecycle wrappers", () => {
  it("lists devices and surfaces adb failures", async () => {
    const ok = fakeRunner(() => ({ stdout: DEVICES_OUTPUT }));
    expect((await listDevices(ok)).map((d) => d.serial)).toContain("emulator-5554");

    const broken = fakeRunner(() => ({ code: 127, stderr: "command not found" }));
    await expect(listDevices(broken)).rejects.toThrow("adb devices` failed");
  });

  it("installs an APK with replace/test/grant flags and detects FAILURE", async () => {
    const runner = fakeRunner(() => ({ stdout: "Success" }));
    await installApk(runner, "emulator-5554", "/tmp/app.apk");
    expect(runner.calls.at(-1)).toEqual([
      "-s",
      "emulator-5554",
      "install",
      "-r",
      "-t",
      "-g",
      "/tmp/app.apk"
    ]);

    const failing = fakeRunner(() => ({ stdout: "Failure [INSTALL_FAILED_OLDER_SDK]" }));
    await expect(installApk(failing, "s", "/tmp/app.apk")).rejects.toThrow("Failed to install APK");
  });

  it("launches via monkey and flags a missing package", async () => {
    const runner = fakeRunner(() => ({ stdout: "Events injected: 1" }));
    await launchPackage(runner, "s", "com.example.app");
    expect(runner.calls.at(-1)).toEqual([
      "-s",
      "s",
      "shell",
      "monkey",
      "-p",
      "com.example.app",
      "-c",
      "android.intent.category.LAUNCHER",
      "1"
    ]);

    const missing = fakeRunner(() => ({ stdout: "** No activities found to run, monkey aborted." }));
    await expect(launchPackage(missing, "s", "com.absent")).rejects.toThrow(
      'Failed to launch Android package "com.absent"'
    );
  });

  it("forwards a dynamic port and parses the allocated port", async () => {
    const runner = fakeRunner(() => ({ stdout: "42042\n" }));
    expect(await forwardDynamicPort(runner, "s", 6790)).toBe(42042);
    expect(runner.calls.at(-1)).toEqual(["-s", "s", "forward", "tcp:0", "tcp:6790"]);
  });

  it("clears package data for a cold start and requires Success", async () => {
    const runner = fakeRunner(() => ({ stdout: "Success" }));
    await clearPackage(runner, "s", "com.example.app");
    expect(runner.calls.at(-1)).toEqual(["-s", "s", "shell", "pm", "clear", "com.example.app"]);

    const failed = fakeRunner(() => ({ stdout: "Failed" }));
    await expect(clearPackage(failed, "s", "com.x")).rejects.toThrow("Failed to clear Android package");
  });

  it("force-stops a package", async () => {
    const runner = fakeRunner(() => ({}));
    await forceStop(runner, "s", "com.example.app");
    expect(runner.calls.at(-1)).toEqual(["-s", "s", "shell", "am", "force-stop", "com.example.app"]);
  });

  it("spawns the instrumentation server with the AndroidJUnitRunner entrypoint", () => {
    const spawned: string[][] = [];
    const handle = startInstrumentation((args) => {
      spawned.push(args);
      return { kill: () => undefined };
    }, "emulator-5554");
    expect(spawned[0]).toEqual([
      "-s",
      "emulator-5554",
      "shell",
      "am",
      "instrument",
      "-w",
      "-e",
      "disableAnalytics",
      "true",
      "io.appium.uiautomator2.server.test/androidx.test.runner.AndroidJUnitRunner"
    ]);
    expect(typeof handle.kill).toBe("function");
  });
});
