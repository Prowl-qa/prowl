import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  closeMacSession,
  launchMacSession,
  macdriverBuildInstructions,
  resolveHelperBinary,
  SpawnMacHelperClient
} from "../src/browser/mac-helper.js";
import type { MacHelperClient } from "../src/browser/mac-driver.js";
import { MACDRIVER_VERSION, macdriverInstalledBinary } from "../src/browser/macdriver-release.js";
import { executeSteps } from "../src/runner/steps.js";
import type { Step } from "../src/types/index.js";

class FakeClient implements MacHelperClient {
  calls: { cmd: string; params: Record<string, unknown> }[] = [];
  closed = false;
  constructor(
    private readonly responder: (
      cmd: string,
      params: Record<string, unknown>
    ) => Record<string, unknown> = () => ({})
  ) {}
  async request(cmd: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    this.calls.push({ cmd, params });
    return this.responder(cmd, params);
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

describe("resolveHelperBinary", () => {
  it("returns an explicit PROWL_MACDRIVER_BIN when it exists", () => {
    const self = fileURLToPath(import.meta.url);
    expect(resolveHelperBinary({ PROWL_MACDRIVER_BIN: self } as NodeJS.ProcessEnv)).toBe(self);
  });

  it("throws build instructions when PROWL_MACDRIVER_BIN is missing", () => {
    const missing = path.join(os.tmpdir(), "definitely-not-here-prowl-macdriver");
    expect(() => resolveHelperBinary({ PROWL_MACDRIVER_BIN: missing } as NodeJS.ProcessEnv)).toThrow(
      "swift build"
    );
  });

  it("build instructions lead with `prowl macdriver install`, then source build and env override", () => {
    const text = macdriverBuildInstructions();
    expect(text).toContain("prowl macdriver install");
    expect(text).toContain("swift build");
    expect(text).toContain("PROWL_MACDRIVER_BIN");
  });

  it("resolves a user-level install of the pinned version when no env override is set", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-resolve-home-"));
    try {
      const userBinary = macdriverInstalledBinary(MACDRIVER_VERSION, home);
      fs.mkdirSync(path.dirname(userBinary), { recursive: true });
      fs.writeFileSync(userBinary, "bin");
      expect(resolveHelperBinary({} as NodeJS.ProcessEnv, { homedir: home })).toBe(userBinary);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("prefers the env override over a user-level install", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-resolve-home-"));
    try {
      const userBinary = macdriverInstalledBinary(MACDRIVER_VERSION, home);
      fs.mkdirSync(path.dirname(userBinary), { recursive: true });
      fs.writeFileSync(userBinary, "bin");
      const override = fileURLToPath(import.meta.url);
      expect(resolveHelperBinary({ PROWL_MACDRIVER_BIN: override } as NodeJS.ProcessEnv, { homedir: home })).toBe(
        override
      );
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("launchMacSession", () => {
  it("checks trust, launches the app, and builds a driver", async () => {
    const client = new FakeClient((cmd) => {
      if (cmd === "check") return { trusted: true };
      if (cmd === "launch") return { bundleId: "com.example.App", pid: 42 };
      return {};
    });
    const session = await launchMacSession({ app: "com.example.App", clientFactory: () => client });
    expect(session.bundleId).toBe("com.example.App");
    expect(session.driver.capabilities.has("interact")).toBe(true);
    expect(client.calls[0].cmd).toBe("check");
    expect(client.calls[1]).toEqual({ cmd: "launch", params: { app: "com.example.App", timeout: 10 } });
  });

  it("rejects and closes the client when Accessibility is not trusted", async () => {
    const client = new FakeClient((cmd) => (cmd === "check" ? { trusted: false } : {}));
    await expect(
      launchMacSession({ app: "com.example.App", clientFactory: () => client })
    ).rejects.toThrow("not trusted for Accessibility");
    expect(client.closed).toBe(true);
  });
});

describe("closeMacSession", () => {
  it("quits the app then closes the client", async () => {
    const client = new FakeClient((cmd) => (cmd === "check" ? { trusted: true } : {}));
    const session = await launchMacSession({ app: "com.example.App", clientFactory: () => client });
    await closeMacSession(session);
    expect(client.calls.some((c) => c.cmd === "quit")).toBe(true);
    expect(client.closed).toBe(true);
  });

  it("closes the client even when quit reports a non-clean termination", async () => {
    // BUG-MAC-001 fix: the quit response now reports how the app went down
    // (`{ quit, state }`, e.g. terminated / forced / timedOut). A forced or
    // timed-out termination must never stop teardown from closing the client.
    const client = new FakeClient((cmd) => {
      if (cmd === "check") return { trusted: true };
      if (cmd === "quit") return { quit: false, state: "timedOut" };
      return {};
    });
    const session = await launchMacSession({ app: "com.example.App", clientFactory: () => client });
    await closeMacSession(session);
    expect(client.calls.some((c) => c.cmd === "quit")).toBe(true);
    expect(client.closed).toBe(true);
  });
});

describe("SpawnMacHelperClient request timeout", () => {
  // A stand-in "helper" that consumes stdin and never writes a response, so a
  // request can only ever resolve via the transport's own deadline.
  function writeHangScript(): string {
    const scriptPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "prowl-hang-")), "hang.sh");
    fs.writeFileSync(scriptPath, "#!/bin/sh\ncat >/dev/null\n");
    fs.chmodSync(scriptPath, 0o755);
    return scriptPath;
  }

  function writeCrashAfterRequestScript(): string {
    const scriptPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "prowl-crash-")), "crash.sh");
    fs.writeFileSync(scriptPath, "#!/bin/sh\nread line\necho fatal helper >&2\nexit 7\n");
    fs.chmodSync(scriptPath, 0o755);
    return scriptPath;
  }

  it("rejects a hung request with a named-command timeout and does not leak the pending entry", async () => {
    const scriptPath = writeHangScript();
    const client = new SpawnMacHelperClient(scriptPath, { requestTimeoutMs: 150 });
    try {
      await expect(client.request("click", { query: { by: "id", value: "x" } })).rejects.toThrow(
        'prowl-macdriver request "click" timed out after 150ms'
      );
      expect(client.pendingCount).toBe(0);
      // The client stays usable: a second request also times out cleanly.
      await expect(client.request("waitFor")).rejects.toThrow(
        'prowl-macdriver request "waitFor" timed out after 150ms'
      );
      expect(client.pendingCount).toBe(0);
    } finally {
      await client.close();
      fs.rmSync(path.dirname(scriptPath), { recursive: true, force: true });
    }
  });

  it("rejects later requests with the helper's terminal failure", async () => {
    const scriptPath = writeCrashAfterRequestScript();
    const client = new SpawnMacHelperClient(scriptPath, { requestTimeoutMs: 1000 });
    try {
      await expect(client.request("count")).rejects.toThrow(
        "prowl-macdriver exited unexpectedly (code 7): fatal helper"
      );
      expect(client.pendingCount).toBe(0);
      await expect(client.request("click")).rejects.toThrow(
        "prowl-macdriver exited unexpectedly (code 7): fatal helper"
      );
    } finally {
      await client.close();
      fs.rmSync(path.dirname(scriptPath), { recursive: true, force: true });
    }
  });
});

describe("MacDriver end-to-end through executeSteps (fake helper)", () => {
  it("runs portable steps and records the expected helper traffic", async () => {
    const client = new FakeClient((cmd) => {
      if (cmd === "check") return { trusted: true };
      if (cmd === "launch") return { bundleId: "com.example.App" };
      if (cmd === "count") return { count: 1 }; // assert visible passes
      return {};
    });
    const { driver } = await launchMacSession({ app: "com.example.App", clientFactory: () => client });

    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-mac-steps-"));
    const steps: Step[] = [
      { click: { selector: "id=save" } },
      { type: "hello" },
      { assert: { visible: "Saved" } }
    ];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await executeSteps({
        driver,
        steps,
        targetUrl: "macos:com.example.App",
        runDir,
        screenshotsMode: "on-failure",
        forbiddenSelectors: [],
        allowedDomains: [],
        allowedApps: ["com.example.App"],
        maxTotalTimeMs: 30000,
        maxSteps: 50,
        redactedFillSteps: new Set(),
        configDir: runDir
      });

      expect(result.failed).toBe(false);
      expect(client.calls).toContainEqual({ cmd: "click", params: { query: { by: "id", value: "save" } } });
      expect(client.calls).toContainEqual({ cmd: "fill", params: { query: { by: "focused" }, value: "hello" } });
      // assert visible "Saved" → count query by text
      expect(client.calls).toContainEqual({ cmd: "count", params: { query: { by: "text", value: "Saved" } } });
    } finally {
      warn.mockRestore();
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });
});
