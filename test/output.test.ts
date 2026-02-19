import { describe, expect, it } from "vitest";
import { describeStep, truncate } from "../src/cli/output.js";
import type { Step } from "../src/types/index.js";

describe("describeStep", () => {
  it("describes navigate step", () => {
    const step: Step = { navigate: "/home" };
    expect(describeStep(step)).toBe('navigate "/home"');
  });

  it("describes click shorthand", () => {
    const step: Step = { click: "Submit" };
    expect(describeStep(step)).toBe('click "Submit"');
  });

  it("describes click explicit", () => {
    const step: Step = { click: { selector: "#btn" } };
    expect(describeStep(step)).toBe('click "#btn"');
  });

  it("describes fill shorthand", () => {
    const step: Step = { fill: { Email: "test@example.com" } };
    expect(describeStep(step)).toBe('fill "Email"');
  });

  it("describes fill explicit", () => {
    const step: Step = { fill: { selector: "#email", value: "test@example.com" } };
    expect(describeStep(step)).toBe('fill "#email"');
  });

  it("describes type step", () => {
    const step: Step = { type: "Hello world" };
    expect(describeStep(step)).toBe('type "Hello world"');
  });

  it("describes type step with truncation", () => {
    const step: Step = { type: "This is a very long text value" };
    expect(describeStep(step)).toBe('type "This is a very long\u2026"');
  });

  it("describes selectOption step", () => {
    const step: Step = { selectOption: { selector: "#country", value: "US" } };
    expect(describeStep(step)).toBe('selectOption "#country"');
  });

  it("describes select shorthand", () => {
    const step: Step = { select: { State: "FL" } };
    expect(describeStep(step)).toBe('select "State"');
  });

  it("describes onDialog step", () => {
    const step: Step = { onDialog: { action: "accept" } };
    expect(describeStep(step)).toBe("onDialog accept");
  });

  it("describes onDialog dismiss", () => {
    const step: Step = { onDialog: { action: "dismiss" } };
    expect(describeStep(step)).toBe("onDialog dismiss");
  });

  it("describes setInputFiles step", () => {
    const step: Step = { setInputFiles: { selector: "#file", files: "test.png" } };
    expect(describeStep(step)).toBe('setInputFiles "#file"');
  });

  it("describes runHunt shorthand", () => {
    const step: Step = { runHunt: "login" };
    expect(describeStep(step)).toBe('runHunt "login"');
  });

  it("describes runHunt explicit", () => {
    const step: Step = { runHunt: { name: "login", vars: { USER: "admin" } } };
    expect(describeStep(step)).toBe('runHunt "login"');
  });

  it("describes press step", () => {
    const step: Step = { press: { selector: "#input", key: "Enter" } };
    expect(describeStep(step)).toBe('press "Enter"');
  });

  it("describes assert visible", () => {
    const step: Step = { assert: { visible: "Welcome" } };
    expect(describeStep(step)).toBe('assert visible "Welcome"');
  });

  it("describes assert notVisible", () => {
    const step: Step = { assert: { notVisible: "Error" } };
    expect(describeStep(step)).toBe('assert notVisible "Error"');
  });

  it("describes assert urlIncludes", () => {
    const step: Step = { assert: { urlIncludes: "/dashboard" } };
    expect(describeStep(step)).toBe('assert urlIncludes "/dashboard"');
  });

  it("describes assert urlEquals", () => {
    const step: Step = { assert: { urlEquals: "http://localhost/home" } };
    expect(describeStep(step)).toBe('assert urlEquals "http://localhost/home"');
  });

  it("describes wait shorthand", () => {
    const step: Step = { wait: "Loading" };
    expect(describeStep(step)).toBe('wait "Loading"');
  });

  it("describes wait explicit", () => {
    const step: Step = { wait: { for: "Ready", timeout: 5000 } };
    expect(describeStep(step)).toBe('wait "Ready"');
  });

  it("describes waitForSelector step", () => {
    const step: Step = { waitForSelector: { selector: "#main" } };
    expect(describeStep(step)).toBe('waitForSelector "#main"');
  });

  it("describes waitForUrl step", () => {
    const step: Step = { waitForUrl: { value: "/dashboard" } };
    expect(describeStep(step)).toBe('waitForUrl "/dashboard"');
  });

  it("describes waitForNetworkIdle step", () => {
    const step: Step = { waitForNetworkIdle: {} };
    expect(describeStep(step)).toBe("waitForNetworkIdle");
  });

  it("describes hover step", () => {
    const step: Step = { hover: { selector: "#menu" } };
    expect(describeStep(step)).toBe('hover "#menu"');
  });

  it("describes scroll step with amount", () => {
    const step: Step = { scroll: { direction: "down", amount: 300 } };
    expect(describeStep(step)).toBe("scroll down 300px");
  });

  it("describes scroll step with default amount", () => {
    const step: Step = { scroll: { direction: "up" } };
    expect(describeStep(step)).toBe("scroll up 500px");
  });

  it("describes scrollTo step", () => {
    const step: Step = { scrollTo: { selector: "#footer" } };
    expect(describeStep(step)).toBe('scrollTo "#footer"');
  });

  it("describes screenshot with name", () => {
    const step: Step = { screenshot: { name: "hero" } };
    expect(describeStep(step)).toBe('screenshot "hero"');
  });

  it("describes screenshot without name", () => {
    const step: Step = { screenshot: {} };
    expect(describeStep(step)).toBe('screenshot "auto"');
  });

  it("describes if step with visible", () => {
    const step: Step = { if: { visible: ".banner", then: [{ click: ".accept" }] } };
    expect(describeStep(step)).toBe('if visible ".banner"');
  });

  it("describes if step with notVisible", () => {
    const step: Step = { if: { notVisible: ".modal", then: [{ navigate: "/" }] } };
    expect(describeStep(step)).toBe('if notVisible ".modal"');
  });

  it("falls back when if condition is unspecified", () => {
    const step = { if: { then: [{ navigate: "/" }] } } as unknown as Step;
    expect(describeStep(step)).toBe("if condition unspecified");
  });

  it("describes repeat step with times", () => {
    const step: Step = { repeat: { times: 3, steps: [{ click: ".btn" }] } };
    expect(describeStep(step)).toBe("repeat 3 times");
  });

  it("describes repeat step with while", () => {
    const step: Step = {
      repeat: { while: { visible: ".load-more" }, maxIterations: 10, steps: [{ click: ".btn" }] }
    };
    expect(describeStep(step)).toBe('repeat while ".load-more"');
  });

  it("describes mockRoute step", () => {
    const step: Step = {
      mockRoute: { url: "**/api/users", response: { status: 200, body: "{}" } }
    };
    expect(describeStep(step)).toBe('mockRoute "**/api/users"');
  });

  it("describes unmockRoute step", () => {
    const step: Step = { unmockRoute: { url: "**/api/users" } };
    expect(describeStep(step)).toBe('unmockRoute "**/api/users"');
  });
});

describe("truncate", () => {
  it("returns text unchanged when within limit", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("returns text unchanged when exactly at limit", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });

  it("truncates text exceeding limit", () => {
    expect(truncate("hello world", 6)).toBe("hello\u2026");
  });

  it("handles single character max", () => {
    expect(truncate("ab", 1)).toBe("\u2026");
  });

  it("handles empty string", () => {
    expect(truncate("", 5)).toBe("");
  });
});
