import { describe, expect, it } from "vitest";
import { extractSelectorIntent, buildHealCandidates, healSelector } from "../src/runner/healing.js";

// PROWL-023 / P5-005: self-healing selectors.

describe("extractSelectorIntent", () => {
  it("pulls words from an id selector and splits separators", () => {
    expect(extractSelectorIntent("#submit-form").words).toEqual(["submit", "form"]);
  });

  it("pulls words from class tokens", () => {
    expect(extractSelectorIntent(".login-button").words).toEqual(["login", "button"]);
  });

  it("pulls values from attribute selectors", () => {
    expect(extractSelectorIntent("[data-testid='sign-in']").words).toEqual(["sign", "in"]);
    expect(extractSelectorIntent('[aria-label="Close Dialog"]').words).toEqual(["close", "dialog"]);
  });

  it("splits camelCase", () => {
    expect(extractSelectorIntent("#signInButton").words).toEqual(["sign", "in", "button"]);
  });

  it("returns no words for a structural-only selector", () => {
    expect(extractSelectorIntent("div > span:nth-child(2)").words).toEqual([]);
  });

  it("builds a space-joined label", () => {
    expect(extractSelectorIntent("#submit-form").label).toBe("submit form");
  });
});

describe("buildHealCandidates", () => {
  it("returns text, aria, then structural candidates in order", () => {
    const candidates = buildHealCandidates("#sign-in");
    expect(candidates[0]).toEqual({ selector: "text=sign in", strategy: "text" });
    expect(candidates[1]).toEqual({ selector: '[aria-label*="sign in" i]', strategy: "aria" });
    expect(candidates.some((c) => c.selector === 'button:has-text("sign in")' && c.strategy === "structural")).toBe(true);
  });

  it("returns nothing when the selector has no usable words", () => {
    expect(buildHealCandidates("div > span")).toEqual([]);
  });
});

function fakePage(counts: Record<string, number>) {
  return {
    locator: (selector: string) => ({
      count: async () => counts[selector] ?? 0
    })
  };
}

describe("healSelector", () => {
  it("returns null when disabled, even if a candidate would match", async () => {
    const page = fakePage({ "text=sign in": 1 });
    expect(await healSelector(page, "#sign-in", { enabled: false })).toBeNull();
  });

  it("heals to a uniquely matching text candidate", async () => {
    const page = fakePage({ "text=sign in": 1 });
    expect(await healSelector(page, "#sign-in", { enabled: true })).toEqual({
      selector: "text=sign in",
      healedFrom: "#sign-in",
      strategy: "text"
    });
  });

  it("falls through to aria when text does not uniquely match", async () => {
    const page = fakePage({ "text=close": 0, '[aria-label*="close" i]': 1 });
    const result = await healSelector(page, "[data-testid='close']", { enabled: true });
    expect(result).toMatchObject({ strategy: "aria", healedFrom: "[data-testid='close']" });
  });

  it("does NOT heal when a candidate matches multiple elements (ambiguous)", async () => {
    const page = fakePage({ "text=sign in": 3 });
    expect(await healSelector(page, "#sign-in", { enabled: true })).toBeNull();
  });

  it("returns null when nothing matches", async () => {
    const page = fakePage({});
    expect(await healSelector(page, "#sign-in", { enabled: true })).toBeNull();
  });

  it("returns null for a selector with no usable intent", async () => {
    const page = fakePage({});
    expect(await healSelector(page, "div > span", { enabled: true })).toBeNull();
  });
});
