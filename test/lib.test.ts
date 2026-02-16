import { describe, expect, it } from "vitest";
import {
  runHunt,
  listHunts,
  loadConfig,
  loadHunt,
  loadHuntMeta,
  loadHuntTags,
  huntSchema,
  configSchema,
  stepSchema,
  interpolateHunt
} from "../src/index.js";

describe("library API exports", () => {
  it("exports runHunt function", () => {
    expect(typeof runHunt).toBe("function");
  });

  it("exports config loader functions", () => {
    expect(typeof loadConfig).toBe("function");
    expect(typeof loadHunt).toBe("function");
    expect(typeof listHunts).toBe("function");
    expect(typeof loadHuntMeta).toBe("function");
    expect(typeof loadHuntTags).toBe("function");
  });

  it("exports schema objects", () => {
    expect(huntSchema).toBeDefined();
    expect(configSchema).toBeDefined();
    expect(stepSchema).toBeDefined();
    expect(typeof huntSchema.parse).toBe("function");
    expect(typeof configSchema.parse).toBe("function");
    expect(typeof stepSchema.parse).toBe("function");
  });

  it("exports interpolateHunt function", () => {
    expect(typeof interpolateHunt).toBe("function");
  });
});

describe("huntSchema validation", () => {
  it("validates a minimal hunt", () => {
    const hunt = { steps: [{ navigate: "http://localhost:3000" }] };
    const result = huntSchema.parse(hunt);
    expect(result.steps).toHaveLength(1);
  });

  it("validates a hunt with all optional fields", () => {
    const hunt = {
      name: "test-hunt",
      description: "A test hunt",
      tags: ["smoke", "fast"],
      vars: { BASE_URL: "http://localhost:3000" },
      steps: [{ navigate: "{{BASE_URL}}" }],
      assertions: [{ urlIncludes: "localhost" }],
      retry: { maxRetries: 2, delay: 1000 }
    };
    const result = huntSchema.parse(hunt);
    expect(result.name).toBe("test-hunt");
    expect(result.tags).toEqual(["smoke", "fast"]);
  });

  it("rejects invalid input", () => {
    expect(() => huntSchema.parse({})).toThrow();
    expect(() => huntSchema.parse({ steps: "not-an-array" })).toThrow();
    expect(() => huntSchema.parse({ steps: [{ unknownStep: true }] })).toThrow();
  });
});
