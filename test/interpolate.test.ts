import { describe, expect, it } from "vitest";
import { interpolateGoal, interpolateString } from "../src/config/interpolate.js";
import type { Goal } from "../src/types/index.js";

const env = {
  TEST_EMAIL: "user@example.com",
  TEST_PASSWORD: "secret"
};

describe("interpolateString", () => {
  it("replaces variables", () => {
    const result = interpolateString("hello {{TEST_EMAIL}}", env);
    expect(result.value).toBe("hello user@example.com");
    expect(result.usedVars).toEqual(["TEST_EMAIL"]);
  });

  it("throws on missing variables", () => {
    expect(() => interpolateString("hi {{MISSING}}", env)).toThrow(
      "Missing environment variable: MISSING"
    );
  });
});

describe("interpolateGoal", () => {
  it("interpolates step values and records redaction", () => {
    const goal: Goal = {
      steps: [
        { navigate: "/" },
        {
          fill: {
            selector: "[data-testid='password']",
            value: "{{TEST_PASSWORD}}"
          }
        }
      ]
    };

    const { goal: interpolated, redactedFillSteps } = interpolateGoal(goal, env);
    expect(interpolated.steps[1]).toEqual({
      fill: {
        selector: "[data-testid='password']",
        value: "secret"
      }
    });
    expect(redactedFillSteps.has(1)).toBe(true);
  });
});
