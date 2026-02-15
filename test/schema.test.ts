import { describe, expect, it } from "vitest";
import { configSchema, huntSchema } from "../src/config/schema.js";

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

  it("accepts runHunt names with subfolder paths", () => {
    const parsed = huntSchema.parse({
      steps: [
        { runHunt: "auth/login" },
        { runHunt: { name: "admin/users-crud" } }
      ]
    });

    expect(parsed.steps).toHaveLength(2);
  });

  it("rejects runHunt names with path traversal", () => {
    expect(() =>
      huntSchema.parse({
        steps: [{ runHunt: "../secrets" }]
      })
    ).toThrow("Invalid hunt name");

    expect(() =>
      huntSchema.parse({
        steps: [{ runHunt: { name: "../../etc/passwd" } }]
      })
    ).toThrow("Invalid hunt name");
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

describe("huntSchema new step types", () => {
  it("accepts hover step", () => {
    const parsed = huntSchema.parse({
      steps: [{ hover: { selector: "[data-testid=menu]" } }]
    });
    expect(parsed.steps).toHaveLength(1);
  });

  it("accepts scroll step", () => {
    const parsed = huntSchema.parse({
      steps: [{ scroll: { direction: "down", amount: 300 } }]
    });
    expect(parsed.steps).toHaveLength(1);
  });

  it("accepts scroll step without amount", () => {
    const parsed = huntSchema.parse({
      steps: [{ scroll: { direction: "up" } }]
    });
    expect(parsed.steps).toHaveLength(1);
  });

  it("rejects scroll step with invalid direction", () => {
    expect(() =>
      huntSchema.parse({
        steps: [{ scroll: { direction: "diagonal" } }]
      })
    ).toThrow();
  });

  it("accepts scrollTo step", () => {
    const parsed = huntSchema.parse({
      steps: [{ scrollTo: { selector: "#footer" } }]
    });
    expect(parsed.steps).toHaveLength(1);
  });
});

describe("huntSchema tags and retry", () => {
  it("accepts hunt with tags", () => {
    const parsed = huntSchema.parse({
      tags: ["smoke", "auth"],
      steps: [{ navigate: "/" }]
    });
    expect(parsed.tags).toEqual(["smoke", "auth"]);
  });

  it("accepts hunt with retry config", () => {
    const parsed = huntSchema.parse({
      retry: { maxRetries: 3, delay: 1000 },
      steps: [{ navigate: "/" }]
    });
    expect(parsed.retry).toEqual({ maxRetries: 3, delay: 1000 });
  });

  it("accepts retry without delay", () => {
    const parsed = huntSchema.parse({
      retry: { maxRetries: 2 },
      steps: [{ navigate: "/" }]
    });
    expect(parsed.retry).toEqual({ maxRetries: 2 });
  });

  it("rejects retry with negative maxRetries", () => {
    expect(() =>
      huntSchema.parse({
        retry: { maxRetries: -1 },
        steps: [{ navigate: "/" }]
      })
    ).toThrow();
  });
});

describe("configSchema browser options", () => {
  it("accepts browser engine options", () => {
    const parsed = configSchema.parse({
      target: { url: "http://localhost" },
      browser: { engine: "firefox" }
    });
    expect(parsed.browser?.engine).toBe("firefox");
  });

  it("rejects invalid browser engine", () => {
    expect(() =>
      configSchema.parse({
        target: { url: "http://localhost" },
        browser: { engine: "opera" }
      })
    ).toThrow();
  });

  it("accepts viewport preset string", () => {
    const parsed = configSchema.parse({
      target: { url: "http://localhost" },
      browser: { viewport: "mobile" }
    });
    expect(parsed.browser?.viewport).toBe("mobile");
  });

  it("accepts viewport object with width and height", () => {
    const parsed = configSchema.parse({
      target: { url: "http://localhost" },
      browser: { viewport: { width: 1920, height: 1080 } }
    });
    expect(parsed.browser?.viewport).toEqual({ width: 1920, height: 1080 });
  });

  it("rejects viewport with invalid preset", () => {
    expect(() =>
      configSchema.parse({
        target: { url: "http://localhost" },
        browser: { viewport: "widescreen" }
      })
    ).toThrow();
  });

  it("accepts valid browser channel", () => {
    const parsed = configSchema.parse({
      target: { url: "http://localhost" },
      browser: { channel: "chrome" }
    });
    expect(parsed.browser?.channel).toBe("chrome");
  });

  it("accepts msedge browser channel", () => {
    const parsed = configSchema.parse({
      target: { url: "http://localhost" },
      browser: { channel: "msedge" }
    });
    expect(parsed.browser?.channel).toBe("msedge");
  });

  it("accepts chromium browser channel", () => {
    const parsed = configSchema.parse({
      target: { url: "http://localhost" },
      browser: { channel: "chromium" }
    });
    expect(parsed.browser?.channel).toBe("chromium");
  });

  it("rejects invalid browser channel", () => {
    expect(() =>
      configSchema.parse({
        target: { url: "http://localhost" },
        browser: { channel: "safari" }
      })
    ).toThrow();
  });
});
