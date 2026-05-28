import { describe, expect, it } from "vitest";
import { looksLikeSelector, toVisibilitySelector } from "../src/runner/steps.js";

// Regression coverage for PQH-QA-001 / PQH-QA-002: prose strings containing
// punctuation (":", ".", etc.) used in `assert.visible` / `assert.notVisible`
// must be matched as text, not handed to Playwright's CSS engine (which threw
// "Unexpected token … while parsing css selector").
describe("toVisibilitySelector — prose is matched as text", () => {
  const proseCases = [
    "name:", // PQH-QA-001: label with trailing colon
    "Complete all required fields before opening a pull request.", // PQH-QA-002: sentence
    "Welcome back",
    "Note: see details",
    "3:00 PM",
    "$19.99",
    "Are you sure?",
    "Save & exit",
    "Dashboard"
  ];

  for (const value of proseCases) {
    it(`treats ${JSON.stringify(value)} as text`, () => {
      expect(looksLikeSelector(value)).toBe(false);
      expect(toVisibilitySelector(value)).toBe(`text=${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}`);
    });
  }
});

describe("toVisibilitySelector — documented selector forms still route to the engine", () => {
  const selectorCases = [
    ".card-grid",
    "#submit",
    "[data-testid='submit-btn']",
    "img[alt='Logo']",
    "css=input:checked",
    "xpath=//div[@id='main']",
    "//button",
    'text="Exact Match"'
  ];

  for (const value of selectorCases) {
    it(`treats ${JSON.stringify(value)} as a selector`, () => {
      expect(looksLikeSelector(value)).toBe(true);
      expect(toVisibilitySelector(value)).toBe(value);
    });
  }
});

describe("toVisibilitySelector — edge cases", () => {
  it("treats an empty string as text", () => {
    expect(looksLikeSelector("")).toBe(false);
    expect(toVisibilitySelector("")).toBe("text=");
  });

  it("escapes embedded quotes and backslashes in text values", () => {
    expect(toVisibilitySelector('She said "hi"')).toBe('text=She said \\"hi\\"');
  });
});
