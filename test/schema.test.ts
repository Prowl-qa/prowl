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

describe("huntSchema if step", () => {
  it("accepts if with visible and then", () => {
    const parsed = huntSchema.parse({
      steps: [{ if: { visible: ".cookie-banner", then: [{ click: ".accept" }] } }]
    });
    expect(parsed.steps).toHaveLength(1);
  });

  it("accepts if with notVisible and then", () => {
    const parsed = huntSchema.parse({
      steps: [{ if: { notVisible: ".welcome-modal", then: [{ navigate: "/onboarding" }] } }]
    });
    expect(parsed.steps).toHaveLength(1);
  });

  it("rejects if with both visible and notVisible", () => {
    expect(() =>
      huntSchema.parse({
        steps: [{ if: { visible: ".a", notVisible: ".b", then: [{ navigate: "/" }] } }]
      })
    ).toThrow("if requires exactly one");
  });

  it("rejects if with neither visible nor notVisible", () => {
    expect(() =>
      huntSchema.parse({
        steps: [{ if: { then: [{ navigate: "/" }] } }]
      })
    ).toThrow("if requires exactly one");
  });

  it("rejects if with empty then", () => {
    expect(() =>
      huntSchema.parse({
        steps: [{ if: { visible: ".banner", then: [] } }]
      })
    ).toThrow();
  });

  it("accepts nested if", () => {
    const parsed = huntSchema.parse({
      steps: [{
        if: {
          visible: ".outer",
          then: [{
            if: { visible: ".inner", then: [{ click: ".btn" }] }
          }]
        }
      }]
    });
    expect(parsed.steps).toHaveLength(1);
  });
});

describe("huntSchema repeat step", () => {
  it("accepts repeat with times and steps", () => {
    const parsed = huntSchema.parse({
      steps: [{ repeat: { times: 3, steps: [{ click: ".load-more" }] } }]
    });
    expect(parsed.steps).toHaveLength(1);
  });

  it("accepts repeat with while, maxIterations, and steps", () => {
    const parsed = huntSchema.parse({
      steps: [{
        repeat: {
          while: { visible: ".load-more" },
          maxIterations: 10,
          steps: [{ click: ".load-more" }]
        }
      }]
    });
    expect(parsed.steps).toHaveLength(1);
  });

  it("rejects repeat with both times and while", () => {
    expect(() =>
      huntSchema.parse({
        steps: [{
          repeat: {
            times: 3,
            while: { visible: ".btn" },
            maxIterations: 5,
            steps: [{ click: ".btn" }]
          }
        }]
      })
    ).toThrow("repeat requires either times or while, not both");
  });

  it("rejects repeat with neither times nor while", () => {
    expect(() =>
      huntSchema.parse({
        steps: [{ repeat: { steps: [{ click: ".btn" }] } }]
      })
    ).toThrow("repeat requires either times or while");
  });

  it("rejects while without maxIterations", () => {
    expect(() =>
      huntSchema.parse({
        steps: [{
          repeat: {
            while: { visible: ".btn" },
            steps: [{ click: ".btn" }]
          }
        }]
      })
    ).toThrow("while requires maxIterations");
  });

  it("rejects repeat with empty steps", () => {
    expect(() =>
      huntSchema.parse({
        steps: [{ repeat: { times: 3, steps: [] } }]
      })
    ).toThrow();
  });
});

describe("huntSchema mockRoute and unmockRoute", () => {
  it("accepts mockRoute with body", () => {
    const parsed = huntSchema.parse({
      steps: [{
        mockRoute: {
          url: "**/api/users",
          response: { status: 200, body: '{"users": []}' }
        }
      }]
    });
    expect(parsed.steps).toHaveLength(1);
  });

  it("accepts mockRoute with file", () => {
    const parsed = huntSchema.parse({
      steps: [{
        mockRoute: {
          url: "**/api/orders",
          response: { status: 200, file: "fixtures/orders.json" }
        }
      }]
    });
    expect(parsed.steps).toHaveLength(1);
  });

  it("accepts mockRoute with contentType", () => {
    const parsed = huntSchema.parse({
      steps: [{
        mockRoute: {
          url: "**/api/data",
          response: { status: 200, contentType: "text/plain", body: "hello" }
        }
      }]
    });
    expect(parsed.steps).toHaveLength(1);
  });

  it("rejects mockRoute with both body and file", () => {
    expect(() =>
      huntSchema.parse({
        steps: [{
          mockRoute: {
            url: "**/api/users",
            response: { status: 200, body: "{}", file: "data.json" }
          }
        }]
      })
    ).toThrow("response requires exactly one of body or file");
  });

  it("rejects mockRoute with neither body nor file", () => {
    expect(() =>
      huntSchema.parse({
        steps: [{
          mockRoute: {
            url: "**/api/users",
            response: { status: 200 }
          }
        }]
      })
    ).toThrow("response requires exactly one of body or file");
  });

  it("accepts unmockRoute", () => {
    const parsed = huntSchema.parse({
      steps: [{ unmockRoute: { url: "**/api/users" } }]
    });
    expect(parsed.steps).toHaveLength(1);
  });
});

describe("huntSchema evalScript step", () => {
  it("accepts evalScript shorthand string", () => {
    const parsed = huntSchema.parse({
      steps: [{ evalScript: "document.title" }]
    });
    expect(parsed.steps).toHaveLength(1);
  });

  it("accepts evalScript object with expression", () => {
    const parsed = huntSchema.parse({
      steps: [{ evalScript: { expression: "document.querySelectorAll('tr').length" } }]
    });
    expect(parsed.steps).toHaveLength(1);
  });

  it("accepts evalScript object with expression and as", () => {
    const parsed = huntSchema.parse({
      steps: [{ evalScript: { expression: "document.title", as: "PAGE_TITLE" } }]
    });
    expect(parsed.steps).toHaveLength(1);
  });

  it("rejects evalScript with empty expression", () => {
    expect(() =>
      huntSchema.parse({
        steps: [{ evalScript: "" }]
      })
    ).toThrow();
  });

  it("rejects evalScript object with empty expression", () => {
    expect(() =>
      huntSchema.parse({
        steps: [{ evalScript: { expression: "" } }]
      })
    ).toThrow();
  });
});

describe("huntSchema runScript step", () => {
  it("accepts runScript with file", () => {
    const parsed = huntSchema.parse({
      steps: [{ runScript: { file: "scripts/setup-data.js" } }]
    });
    expect(parsed.steps).toHaveLength(1);
  });

  it("rejects runScript with empty file", () => {
    expect(() =>
      huntSchema.parse({
        steps: [{ runScript: { file: "" } }]
      })
    ).toThrow();
  });
});

describe("huntSchema assertScreenshot step", () => {
  it("accepts assertScreenshot with name and threshold", () => {
    const parsed = huntSchema.parse({
      steps: [{ assertScreenshot: { name: "homepage", threshold: 0.1 } }]
    });
    expect(parsed.steps).toHaveLength(1);
  });

  it("accepts assertScreenshot with name only", () => {
    const parsed = huntSchema.parse({
      steps: [{ assertScreenshot: { name: "checkout-form" } }]
    });
    expect(parsed.steps).toHaveLength(1);
  });

  it("rejects assertScreenshot with threshold > 1", () => {
    expect(() =>
      huntSchema.parse({
        steps: [{ assertScreenshot: { name: "test", threshold: 1.5 } }]
      })
    ).toThrow();
  });

  it("rejects assertScreenshot with threshold < 0", () => {
    expect(() =>
      huntSchema.parse({
        steps: [{ assertScreenshot: { name: "test", threshold: -0.1 } }]
      })
    ).toThrow();
  });

  it("rejects assertScreenshot with empty name", () => {
    expect(() =>
      huntSchema.parse({
        steps: [{ assertScreenshot: { name: "" } }]
      })
    ).toThrow();
  });
});

describe("configSchema artifacts options", () => {
  it("accepts artifacts.junit boolean", () => {
    const parsed = configSchema.parse({
      target: { url: "http://localhost" },
      artifacts: { junit: true }
    });
    expect(parsed.artifacts?.junit).toBe(true);
  });

  it("accepts artifacts.junit as false", () => {
    const parsed = configSchema.parse({
      target: { url: "http://localhost" },
      artifacts: { junit: false }
    });
    expect(parsed.artifacts?.junit).toBe(false);
  });
});
