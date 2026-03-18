import { describe, expect, it } from "vitest";
import pkg from "../package.json";
import { buildProgram, CLI_VERSION } from "../src/cli/program.js";

describe("buildProgram", () => {
  it("uses the package version for the CLI version", () => {
    const program = buildProgram();

    expect(CLI_VERSION).toBe(pkg.version);
    expect(program.version()).toBe(pkg.version);
  });
});
