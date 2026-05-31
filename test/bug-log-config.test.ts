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

describe("configSchema — tracing block (OBS-001)", () => {
  it("accepts a tracing block with a custom header", () => {
    const parsed = configSchema.parse({ ...base, tracing: { header: "x-request-id" } });
    expect(parsed.tracing).toEqual({ header: "x-request-id" });
  });

  it("accepts config with no tracing block", () => {
    expect(configSchema.parse({ ...base }).tracing).toBeUndefined();
  });

  it("rejects unknown keys and empty header (strict)", () => {
    expect(() => configSchema.parse({ ...base, tracing: { header: "x", bogus: 1 } })).toThrow();
    expect(() => configSchema.parse({ ...base, tracing: { header: "" } })).toThrow();
  });
});

describe("configSchema — reliability block (PROWL-032)", () => {
  it("accepts a flakyThreshold in [0,1]", () => {
    expect(configSchema.parse({ ...base, reliability: { flakyThreshold: 0.5 } }).reliability).toEqual({
      flakyThreshold: 0.5
    });
  });

  it("accepts config with no reliability block", () => {
    expect(configSchema.parse({ ...base }).reliability).toBeUndefined();
  });

  it("rejects out-of-range thresholds and unknown keys (strict)", () => {
    expect(() => configSchema.parse({ ...base, reliability: { flakyThreshold: 1.5 } })).toThrow();
    expect(() => configSchema.parse({ ...base, reliability: { flakyThreshold: -0.1 } })).toThrow();
    expect(() => configSchema.parse({ ...base, reliability: { bogus: 1 } })).toThrow();
  });
});
