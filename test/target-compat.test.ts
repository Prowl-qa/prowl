import { describe, expect, it } from "vitest";
import {
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
});

describe("assertTargetAppAllowed", () => {
  it("allows any target when allowedApps is empty (scope unset)", () => {
    expect(() => assertTargetAppAllowed([], "com.example.App")).not.toThrow();
  });

  it("allows a target listed in allowedApps", () => {
    expect(() => assertTargetAppAllowed(["com.example.App"], "com.example.App")).not.toThrow();
  });

  it("rejects a target excluded by a non-empty allowedApps", () => {
    expect(() => assertTargetAppAllowed(["com.other.App"], "com.example.App")).toThrow(
      'Target app "com.example.App" is not in guardrails.allowedApps'
    );
  });
});
