import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockInstallMacdriver = vi.fn();
const mockCollectMacdriverStatus = vi.fn();
const mockTccGuidance = vi.fn(() => "TCC guidance");

vi.mock("../src/browser/macdriver-install.js", () => ({
  installMacdriver: (...args: unknown[]) => mockInstallMacdriver(...args),
  collectMacdriverStatus: (...args: unknown[]) => mockCollectMacdriverStatus(...args),
  tccGuidance: (...args: unknown[]) => mockTccGuidance(...args)
}));

import { buildMacdriverCommand } from "../src/cli/commands/macdriver.js";
import { buildProgram } from "../src/cli/program.js";

describe("macdriver command", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  async function runMacdriver(args: string[]): Promise<void> {
    await buildMacdriverCommand().parseAsync(["node", "prowl", ...args]);
  }

  function stdout(): string {
    return logSpy.mock.calls.flat().join("\n");
  }

  function stderr(): string {
    return errorSpy.mock.calls.flat().join("\n");
  }

  it("registers the macdriver command group on the root program", () => {
    const program = buildProgram();
    const command = program.commands.find((entry) => entry.name() === "macdriver");

    expect(command).toBeDefined();
    expect(command?.commands.map((entry) => entry.name())).toEqual(["install", "status"]);
  });

  it("runs install with --force and prints the installed binary path", async () => {
    mockInstallMacdriver.mockResolvedValue({
      version: "0.1.0",
      binaryPath: "/Users/test/.prowl/macdriver/0.1.0/prowl-macdriver",
      alreadyInstalled: false
    });

    await runMacdriver(["install", "--force"]);

    expect(mockInstallMacdriver).toHaveBeenCalledWith({ force: true });
    expect(stdout()).toContain("Installing prowl-macdriver 0.1.0");
    expect(stdout()).toContain("Installed prowl-macdriver 0.1.0");
    expect(stdout()).toContain("/Users/test/.prowl/macdriver/0.1.0/prowl-macdriver");
    expect(stdout()).toContain("TCC guidance");
    expect(process.exitCode).toBeUndefined();
  });

  it("prints the already-installed install branch", async () => {
    mockInstallMacdriver.mockResolvedValue({
      version: "0.1.0",
      binaryPath: "/Users/test/.prowl/macdriver/0.1.0/prowl-macdriver",
      alreadyInstalled: true
    });

    await runMacdriver(["install"]);

    expect(mockInstallMacdriver).toHaveBeenCalledWith({ force: undefined });
    expect(stdout()).toContain("Already installed at /Users/test/.prowl/macdriver/0.1.0/prowl-macdriver");
    expect(process.exitCode).toBeUndefined();
  });

  it("sets a nonzero exit code when install fails", async () => {
    mockInstallMacdriver.mockRejectedValue(new Error("download failed"));

    await runMacdriver(["install"]);

    expect(stderr()).toContain("Error: download failed");
    expect(process.exitCode).toBe(1);
  });

  it("prints resolved status and installed versions", async () => {
    mockCollectMacdriverStatus.mockResolvedValue({
      resolved: {
        path: "/Users/test/.prowl/macdriver/0.1.0/prowl-macdriver",
        source: "user-install"
      },
      pinnedVersion: "0.1.0",
      installed: [
        {
          version: "0.1.0",
          binaryPath: "/Users/test/.prowl/macdriver/0.1.0/prowl-macdriver"
        }
      ],
      probedVersion: "0.1.0"
    });

    await runMacdriver(["status"]);

    expect(stdout()).toContain("prowl-macdriver status");
    expect(stdout()).toContain("pinned version:   0.1.0");
    expect(stdout()).toContain("resolved via:     user install");
    expect(stdout()).toContain("runs:             yes (reports 0.1.0)");
    expect(stdout()).toContain("installed versions:");
    expect(process.exitCode).toBeUndefined();
  });

  it("prints install guidance when status cannot resolve a helper", async () => {
    mockCollectMacdriverStatus.mockResolvedValue({
      resolved: null,
      pinnedVersion: "0.1.0",
      installed: [],
      probedVersion: null
    });

    await runMacdriver(["status"]);

    expect(stdout()).toContain("resolved binary:  none");
    expect(stdout()).toContain("Run `prowl macdriver install`");
    expect(stdout()).toContain("installed versions: none");
    expect(process.exitCode).toBeUndefined();
  });

  it("sets a nonzero exit code when status fails", async () => {
    mockCollectMacdriverStatus.mockRejectedValue(new Error("status failed"));

    await runMacdriver(["status"]);

    expect(stderr()).toContain("Error: status failed");
    expect(process.exitCode).toBe(1);
  });
});
