import { describe, expect, it } from "vitest";
import { huntSchema } from "../src/config/schema.js";

describe("huntSchema shorthand syntax", () => {
  it("accepts shorthand and explicit step forms", () => {
    const parsed = huntSchema.parse({
      steps: [
        { click: "Sign In" },
        { click: { selector: "[data-testid=sign-in]" } },
        { fill: { Email: "user@test.com" } },
        { fill: { selector: "[data-testid=email]", value: "user@test.com" } },
        { type: "hello world" },
        { select: { State: "FL" } },
        { selectOption: { selector: "select[name=state]", value: "FL" } },
        { wait: "Welcome" },
        { wait: { for: "Welcome", timeout: 5000 } },
        { assert: { visible: "Welcome" } },
        { assert: { notVisible: "Error" } },
        { assert: { urlIncludes: "/dashboard" } },
        { assert: { urlEquals: "https://example.com/dashboard" } }
      ]
    });

    expect(parsed.steps).toHaveLength(13);
  });

  it("accepts runHunt step in simple and object forms", () => {
    const parsed = huntSchema.parse({
      steps: [
        { runHunt: "login" },
        { runHunt: { name: "login", vars: { EMAIL: "admin@test.com" } } }
      ]
    });

    expect(parsed.steps).toHaveLength(2);
  });

  it("rejects shorthand records with multiple keys", () => {
    expect(() =>
      huntSchema.parse({
        steps: [{ fill: { Email: "a", Password: "b" } }]
      })
    ).toThrow("Expected exactly one key-value pair");
  });

  it("rejects assert step when multiple assert types are provided", () => {
    expect(() =>
      huntSchema.parse({
        steps: [{ assert: { visible: "Welcome", urlIncludes: "/dashboard" } }]
      })
    ).toThrow("assert requires exactly one");
  });
});
