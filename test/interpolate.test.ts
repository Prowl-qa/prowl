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
    expect(redactedFillSteps.has("1")).toBe(true);
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

  it("interpolates shorthand step values", () => {
    const hunt: Hunt = {
      vars: {
        CTA: "Sign In"
      },
      steps: [
        { click: "{{CTA}}" },
        { fill: { Email: "{{TEST_EMAIL}}" } },
        { type: "{{TEST_PASSWORD}}" },
        { select: { State: "{{STATE}}" } },
        { wait: "{{CTA}}" },
        { assert: { visible: "{{CTA}}" } }
      ]
    };

    const { hunt: interpolated, redactedFillSteps } = interpolateHunt(hunt, {
      ...env,
      STATE: "FL"
    });
    expect(interpolated.steps[0]).toEqual({ click: "Sign In" });
    expect(interpolated.steps[1]).toEqual({ fill: { Email: "user@example.com" } });
    expect(interpolated.steps[2]).toEqual({ type: "secret" });
    expect(interpolated.steps[3]).toEqual({ select: { State: "FL" } });
    expect(interpolated.steps[4]).toEqual({ wait: "Sign In" });
    expect(interpolated.steps[5]).toEqual({ assert: { visible: "Sign In" } });
    expect(redactedFillSteps.has("1")).toBe(true);
    expect(redactedFillSteps.has("2")).toBe(true);
  });

  it("tracks nested redaction using parent step paths", () => {
    const hunt: Hunt = {
      steps: [
        { type: "public-value" },
        {
          if: {
            visible: ".secret",
            then: [{ type: "{{TEST_PASSWORD}}" }]
          }
        },
        {
          repeat: {
            times: 2,
            steps: [{ fill: { selector: "#password", value: "{{TEST_PASSWORD}}" } }]
          }
        }
      ]
    };

    const { redactedFillSteps } = interpolateHunt(hunt, env);
    expect(redactedFillSteps.has("0")).toBe(false);
    expect(redactedFillSteps.has("1.if.then.0")).toBe(true);
    expect(redactedFillSteps.has("2.repeat.steps.0")).toBe(true);
  });

  it("interpolates if step selector and sub-steps", () => {
    const hunt: Hunt = {
      vars: { SELECTOR: ".cookie-banner", PAGE: "/accept" },
      steps: [
        {
          if: {
            visible: "{{SELECTOR}}",
            then: [{ navigate: "{{PAGE}}" }]
          }
        }
      ]
    };
    const { hunt: interpolated } = interpolateHunt(hunt, env);
    const step = interpolated.steps[0] as { if: { visible: string; then: Array<{ navigate: string }> } };
    expect(step.if.visible).toBe(".cookie-banner");
    expect(step.if.then[0].navigate).toBe("/accept");
  });

  it("interpolates repeat step while selector and sub-steps", () => {
    const hunt: Hunt = {
      vars: { SELECTOR: ".load-more", PAGE: "/next" },
      steps: [
        {
          repeat: {
            while: { visible: "{{SELECTOR}}" },
            maxIterations: 5,
            steps: [{ navigate: "{{PAGE}}" }]
          }
        }
      ]
    };
    const { hunt: interpolated } = interpolateHunt(hunt, env);
    const step = interpolated.steps[0] as {
      repeat: { while: { visible: string }; maxIterations: number; steps: Array<{ navigate: string }> }
    };
    expect(step.repeat.while.visible).toBe(".load-more");
    expect(step.repeat.steps[0].navigate).toBe("/next");
  });

  it("interpolates mockRoute url and body", () => {
    const hunt: Hunt = {
      vars: { API_URL: "**/api/users", BODY: '{"users": []}' },
      steps: [
        {
          mockRoute: {
            url: "{{API_URL}}",
            response: { status: 200, body: "{{BODY}}" }
          }
        }
      ]
    };
    const { hunt: interpolated } = interpolateHunt(hunt, env);
    const step = interpolated.steps[0] as {
      mockRoute: { url: string; response: { status: number; body: string } }
    };
    expect(step.mockRoute.url).toBe("**/api/users");
    expect(step.mockRoute.response.body).toBe('{"users": []}');
  });

  it("interpolates unmockRoute url", () => {
    const hunt: Hunt = {
      vars: { API_URL: "**/api/users" },
      steps: [{ unmockRoute: { url: "{{API_URL}}" } }]
    };
    const { hunt: interpolated } = interpolateHunt(hunt, env);
    const step = interpolated.steps[0] as { unmockRoute: { url: string } };
    expect(step.unmockRoute.url).toBe("**/api/users");
  });

  it("interpolates mockRoute file path", () => {
    const hunt: Hunt = {
      vars: { FIXTURE: "fixtures/orders.json" },
      steps: [
        {
          mockRoute: {
            url: "**/api/orders",
            response: { status: 200, file: "{{FIXTURE}}" }
          }
        }
      ]
    };
    const { hunt: interpolated } = interpolateHunt(hunt, env);
    const step = interpolated.steps[0] as {
      mockRoute: { url: string; response: { status: number; file: string } }
    };
    expect(step.mockRoute.response.file).toBe("fixtures/orders.json");
  });
});
