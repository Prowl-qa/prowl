import { describe, expect, it } from "vitest";
import { interpolateHunt, interpolateString } from "../src/config/interpolate.js";
import type { Hunt } from "../src/types/index.js";

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

  it("accepts empty-string variables", () => {
    const result = interpolateString("prefix{{EMPTY}}suffix", {
      ...env,
      EMPTY: ""
    });
    expect(result.value).toBe("prefixsuffix");
    expect(result.usedVars).toEqual(["EMPTY"]);
  });

  it("throws on missing variables", () => {
    expect(() => interpolateString("hi {{MISSING}}", env)).toThrow(
      "Missing variable: MISSING"
    );
  });
});

describe("interpolateHunt", () => {
  it("interpolates step values and records redaction", () => {
    const hunt: Hunt = {
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

    const { hunt: interpolated, redactedFillSteps } = interpolateHunt(hunt, env);
    expect(interpolated.steps[1]).toEqual({
      fill: {
        selector: "[data-testid='password']",
        value: "secret"
      }
    });
    expect(redactedFillSteps.has(1)).toBe(true);
  });

  it("interpolates hunt vars that reference env vars", () => {
    const hunt: Hunt = {
      vars: { EMAIL: "{{TEST_EMAIL}}" },
      steps: [
        { fill: { selector: "[data-testid='email']", value: "{{EMAIL}}" } }
      ]
    };
    const { hunt: interpolated } = interpolateHunt(hunt, env);
    expect(interpolated.steps[0]).toEqual({
      fill: { selector: "[data-testid='email']", value: "user@example.com" }
    });
  });

  it("prefers hunt vars over environment", () => {
    const hunt: Hunt = {
      vars: {
        TEST_EMAIL: "override@example.com"
      },
      steps: [
        {
          fill: {
            selector: "[data-testid='email']",
            value: "{{TEST_EMAIL}}"
          }
        }
      ]
    };

    const { hunt: interpolated } = interpolateHunt(hunt, env);
    expect(interpolated.steps[0]).toEqual({
      fill: {
        selector: "[data-testid='email']",
        value: "override@example.com"
      }
    });
  });
});
