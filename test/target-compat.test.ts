import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  androidAppAllowedIdentities,
  assertAndroidAppAllowed,
  assertHuntAssertionsSupportedByTarget,
  assertIosAppAllowed,
  assertStepsSupportedByTarget,
  assertTargetAppAllowed,
  iosAppAllowedIdentities,
  readIosBundleIdentifier,
  webOnlyReason
} from "../src/config/target.js";
import type { Step } from "../src/types/index.js";

describe("webOnlyReason", () => {
  it("flags web-only step types", () => {
    expect(webOnlyReason({ navigate: "/" })).toBe("navigate");
    expect(webOnlyReason({ evalScript: "1+1" })).toBe("evalScript");
    expect(webOnlyReason({ onDialog: { action: "accept" } })).toBe("onDialog");
    expect(webOnlyReason({ scroll: { direction: "down" } })).toBe("scroll");
  });

  it("flags url assertions but allows visible assertions", () => {
    expect(webOnlyReason({ assert: { urlIncludes: "/x" } })).toBe("assert (url)");
    expect(webOnlyReason({ assert: { visible: "Ready" } })).toBeNull();
  });

  it("treats portable steps as supported", () => {
    expect(webOnlyReason({ click: "Save" })).toBeNull();
    expect(webOnlyReason({ type: "hello" })).toBeNull();
    expect(webOnlyReason({ scrollTo: { selector: "id=footer" } })).toBeNull();
  });
});

describe("assertStepsSupportedByTarget", () => {
  it("is a no-op for the web target", () => {
    expect(() => assertStepsSupportedByTarget([{ navigate: "/" }], "web")).not.toThrow();
  });

  it("rejects a web-only step on the macos target", () => {
    expect(() => assertStepsSupportedByTarget([{ navigate: "/" }], "macos")).toThrow(
      'Step "navigate" is not supported by the macOS target'
    );
  });

  it("accepts a fully portable macos hunt", () => {
    const steps: Step[] = [
      { click: "Save" },
      { type: "hello" },
      { assert: { visible: "Saved" } },
      { screenshot: { name: "after" } }
    ];
    expect(() => assertStepsSupportedByTarget(steps, "macos")).not.toThrow();
  });

  it("recurses into if/repeat bodies", () => {
    const nestedIf: Step[] = [
      { if: { visible: "X", then: [{ evalScript: "boom" }] } }
    ];
    expect(() => assertStepsSupportedByTarget(nestedIf, "macos")).toThrow('Step "evalScript"');

    const nestedRepeat: Step[] = [
      { repeat: { times: 2, steps: [{ waitForUrl: { value: "/x" } }] } }
    ];
    expect(() => assertStepsSupportedByTarget(nestedRepeat, "macos")).toThrow('Step "waitForUrl"');
  });

  it("recurses into if else bodies", () => {
    const nestedIfElse: Step[] = [
      { if: { visible: "X", then: [{ click: "Save" }], else: [{ setInputFiles: { selector: "input", files: "x.txt" } }] } }
    ];
    expect(() => assertStepsSupportedByTarget(nestedIfElse, "macos")).toThrow('Step "setInputFiles"');
  });
});

describe("assertTargetAppAllowed", () => {
  it("allows any target when allowedApps is empty (scope unset)", () => {
    expect(() => assertTargetAppAllowed([], "com.example.App")).not.toThrow();
  });

  it("allows a target listed in allowedApps", () => {
    expect(() => assertTargetAppAllowed(["com.example.App"], "com.example.App")).not.toThrow();
  });

  it("allows an app-path target by bundle id, bundle name, or path", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-app-"));
    const appPath = path.join(root, "Example.app");
    const contentsPath = path.join(appPath, "Contents");
    fs.mkdirSync(contentsPath, { recursive: true });
    fs.writeFileSync(
      path.join(contentsPath, "Info.plist"),
      [
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
        "<plist version=\"1.0\">",
        "<dict>",
        "<key>CFBundleIdentifier</key>",
        "<string>com.example.App</string>",
        "</dict>",
        "</plist>"
      ].join("\n")
    );

    try {
      expect(() => assertTargetAppAllowed(["com.example.App"], appPath)).not.toThrow();
      expect(() => assertTargetAppAllowed(["Example"], appPath)).not.toThrow();
      expect(() => assertTargetAppAllowed([appPath], `${appPath}/`)).not.toThrow();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("allows an app-path target by bundle id resolved through plutil fallback", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-app-"));
    const appPath = path.join(root, "BinaryExample.app");
    const contentsPath = path.join(appPath, "Contents");
    const plistPath = path.join(contentsPath, "Info.plist");
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
    const originalExistsSync = fs.existsSync;
    const execFileSync = vi.fn(() => "com.example.Binary\n");

    fs.mkdirSync(contentsPath, { recursive: true });
    fs.writeFileSync(plistPath, Buffer.from("bplist00-not-xml"));

    vi.spyOn(fs, "existsSync").mockImplementation((candidate) => {
      if (candidate === "/usr/bin/plutil") {
        return true;
      }
      return originalExistsSync(candidate);
    });
    vi.doMock("node:child_process", () => ({ execFileSync }));
    vi.resetModules();
    Object.defineProperty(process, "platform", { value: "darwin" });

    try {
      const { assertTargetAppAllowed: assertTargetAppAllowedWithPlutil } = await import("../src/config/target.js");

      expect(() => assertTargetAppAllowedWithPlutil(["com.example.Binary"], appPath)).not.toThrow();
      expect(execFileSync).toHaveBeenCalledWith(
        "/usr/bin/plutil",
        ["-extract", "CFBundleIdentifier", "raw", "-o", "-", plistPath],
        { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 1000 }
      );
    } finally {
      if (platformDescriptor) {
        Object.defineProperty(process, "platform", platformDescriptor);
      }
      vi.doUnmock("node:child_process");
      vi.restoreAllMocks();
      vi.resetModules();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a target excluded by a non-empty allowedApps", () => {
    expect(() => assertTargetAppAllowed(["com.other.App"], "com.example.App")).toThrow(
      'Target app "com.example.App" is not in guardrails.allowedApps'
    );
  });
});

describe("assertHuntAssertionsSupportedByTarget", () => {
  it("rejects hunt-level assertions on the macos target", () => {
    expect(() => assertHuntAssertionsSupportedByTarget([{ selectorExists: "Saved" }], "macos")).toThrow(
      "Hunt-level assertions are not supported by the macOS target"
    );
  });

  it("allows hunt-level assertions on the web target", () => {
    expect(() => assertHuntAssertionsSupportedByTarget([{ selectorExists: "Saved" }], "web")).not.toThrow();
  });
});

describe("android target gating (PROWL-058)", () => {
  it("rejects web-only steps with an Android-labelled message", () => {
    expect(() => assertStepsSupportedByTarget([{ navigate: "/" }], "android")).toThrow(
      'Step "navigate" is not supported by the Android target'
    );
    expect(() => assertHuntAssertionsSupportedByTarget([{ selectorExists: "x" }], "android")).toThrow(
      "Hunt-level assertions are not supported by the Android target"
    );
  });

  it("accepts a fully portable android hunt and recurses into bodies", () => {
    const steps: Step[] = [
      { click: "Save" },
      { type: "hello" },
      { assert: { visible: "Saved" } },
      { if: { visible: "X", then: [{ press: { selector: ":focus", key: "Enter" } }] } }
    ];
    expect(() => assertStepsSupportedByTarget(steps, "android")).not.toThrow();
  });
});

describe("androidAppAllowedIdentities / assertAndroidAppAllowed", () => {
  it("treats a bare package name as its own identity", () => {
    expect(androidAppAllowedIdentities("com.example.app")).toEqual(["com.example.app"]);
    expect(() => assertAndroidAppAllowed([], "com.example.app")).not.toThrow();
    expect(() => assertAndroidAppAllowed(["com.example.app"], "com.example.app")).not.toThrow();
  });

  it("matches an .apk target by resolved package identity", () => {
    const apkPath = "build/outputs/app-debug.apk";
    expect(androidAppAllowedIdentities(apkPath, "com.example.app")).toContain("com.example.app");
    expect(() => assertAndroidAppAllowed(["com.example.app"], apkPath, "com.example.app")).not.toThrow();
  });

  it("matches an .apk target by canonical full path", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-apk-"));
    const apkPath = path.join(dir, "app-debug.apk");
    fs.writeFileSync(apkPath, "x");
    try {
      expect(androidAppAllowedIdentities(apkPath)).toEqual([fs.realpathSync.native(apkPath)]);
      expect(() => assertAndroidAppAllowed([apkPath], `${apkPath}/`)).not.toThrow();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects an .apk with the same filename in a different directory", () => {
    const allowedDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-allowed-apk-"));
    const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-target-apk-"));
    const allowedApk = path.join(allowedDir, "app-debug.apk");
    const targetApk = path.join(targetDir, "app-debug.apk");
    fs.writeFileSync(allowedApk, "allowed");
    fs.writeFileSync(targetApk, "target");
    try {
      expect(() => assertAndroidAppAllowed([allowedApk], targetApk, "com.target.app")).toThrow(
        'Target app "'
      );
    } finally {
      fs.rmSync(allowedDir, { recursive: true, force: true });
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
  });

  it("rejects an app excluded by a non-empty allowedApps", () => {
    expect(() => assertAndroidAppAllowed(["com.other.app"], "com.example.app")).toThrow(
      'Target app "com.example.app" is not in guardrails.allowedApps'
    );
  });
});

describe("iOS target gating (PROWL-059)", () => {
  it("rejects web-only steps with an iOS-labelled message", () => {
    expect(() => assertStepsSupportedByTarget([{ navigate: "/" }], "ios")).toThrow(
      'Step "navigate" is not supported by the iOS target'
    );
    expect(() => assertHuntAssertionsSupportedByTarget([{ selectorExists: "x" }], "ios")).toThrow(
      "Hunt-level assertions are not supported by the iOS target"
    );
  });

  it("accepts a fully portable iOS hunt and recurses into bodies", () => {
    const steps: Step[] = [
      { click: "Save" },
      { type: "hello" },
      { assert: { visible: "Saved" } },
      { if: { visible: "X", then: [{ press: { selector: ":focus", key: "Enter" } }] } }
    ];
    expect(() => assertStepsSupportedByTarget(steps, "ios")).not.toThrow();
  });
});

describe("iosAppAllowedIdentities / assertIosAppAllowed", () => {
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

  it("treats a bare bundle id as its own identity", () => {
    expect(iosAppAllowedIdentities("com.example.App")).toEqual(["com.example.App"]);
    expect(() => assertIosAppAllowed([], "com.example.App")).not.toThrow();
    expect(() => assertIosAppAllowed(["com.example.App"], "com.example.App")).not.toThrow();
  });

  it("reads the bundle id from a .app root Info.plist and authorizes by it or by path", () => {
    const appPath = makeAppBundle("com.derived.App");
    try {
      expect(readIosBundleIdentifier(appPath)).toBe("com.derived.App");
      const identities = iosAppAllowedIdentities(appPath);
      expect(identities).toContain("com.derived.App");
      expect(identities).toContain(path.resolve(appPath));
      // Allowlisted by bundle id even though the target is given as a path.
      expect(() => assertIosAppAllowed(["com.derived.App"], appPath)).not.toThrow();
      // Allowlisted by the .app path.
      expect(() => assertIosAppAllowed([appPath], appPath)).not.toThrow();
    } finally {
      fs.rmSync(path.dirname(appPath), { recursive: true, force: true });
    }
  });

  it("rejects an app excluded by a non-empty allowedApps", () => {
    expect(() => assertIosAppAllowed(["com.other.App"], "com.example.App")).toThrow(
      'Target app "com.example.App" is not in guardrails.allowedApps'
    );
  });
});
