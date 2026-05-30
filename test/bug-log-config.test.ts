import { describe, expect, it } from "vitest";
import { configSchema } from "../src/config/schema.js";

// PROWL-039 / P5-011: configurable bug-log destination via config.yml.
// These cover schema validation of the new `bugLog` block; path resolution
// and enabled precedence are covered in test/mcp-tools.test.ts.
const base = { target: { url: "http://localhost:3000" } };

describe("configSchema — bugLog block", () => {
  it("accepts a full bugLog block", () => {
    const parsed = configSchema.parse({
      ...base,
      bugLog: { enabled: false, backlogPath: "qa/findings.md", resolvedPath: "qa/done.md" }
    });
    expect(parsed.bugLog).toEqual({ enabled: false, backlogPath: "qa/findings.md", resolvedPath: "qa/done.md" });
  });

  it("accepts a partial bugLog block (enabled only)", () => {
    const parsed = configSchema.parse({ ...base, bugLog: { enabled: true } });
    expect(parsed.bugLog).toEqual({ enabled: true });
  });

  it("accepts config with no bugLog block at all", () => {
    const parsed = configSchema.parse({ ...base });
    expect(parsed.bugLog).toBeUndefined();
  });

  it("rejects unknown keys inside bugLog (strict)", () => {
    expect(() => configSchema.parse({ ...base, bugLog: { enabled: true, bogus: 1 } })).toThrow();
  });

  it("rejects wrong types and empty path strings", () => {
    expect(() => configSchema.parse({ ...base, bugLog: { enabled: "yes" } })).toThrow();
    expect(() => configSchema.parse({ ...base, bugLog: { backlogPath: "" } })).toThrow();
  });
});
