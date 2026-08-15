import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  assertHuntAssertionsSupportedByTarget,
  assertStepsSupportedByTarget,
  assertTargetAppAllowed,
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
