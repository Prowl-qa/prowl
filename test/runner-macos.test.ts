import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runHunt } from "../src/runner/index.js";
import type { MacHelperClient } from "../src/browser/mac-driver.js";

class FakeClient implements MacHelperClient {
  calls: { cmd: string; params: Record<string, unknown> }[] = [];
  constructor(
    private readonly responder: (cmd: string) => Record<string, unknown> = () => ({})
  ) {}
  async request(cmd: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    this.calls.push({ cmd, params });
    return this.responder(cmd);
  }
  async close(): Promise<void> {}
}

function macResponder(cmd: string): Record<string, unknown> {
  if (cmd === "check") return { trusted: true };
  if (cmd === "launch") return { bundleId: "com.example.App", pid: 1 };
  if (cmd === "count") return { count: 1 };
  return {};
}

function setupProject(configYml: string, huntName: string, huntYml: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-runmac-"));
  const huntsDir = path.join(tmpDir, ".prowl", "hunts");
  fs.mkdirSync(huntsDir, { recursive: true });
  fs.writeFileSync(path.join(tmpDir, ".prowl", "config.yml"), configYml);
  fs.writeFileSync(path.join(huntsDir, `${huntName}.yml`), huntYml);
  return tmpDir;
}

const MAC_CONFIG =
  "target:\n  type: macos\n  app: 'com.example.App'\nguardrails:\n  allowedApps: ['com.example.App']\n";

describe("runHunt — macOS target (PROWL-048)", () => {
  it("runs a portable hunt end-to-end through a fake helper", async () => {
    const project = setupProject(
      MAC_CONFIG,
      "portable",
      "steps:\n  - click: { selector: 'id=save' }\n  - type: 'hello'\n  - assert: { visible: 'Saved' }\n"
    );
    const client = new FakeClient(macResponder);
    const cwd = process.cwd();
    try {
      process.chdir(project);
      const { result, runDir } = await runHunt({
        huntName: "portable",
        macClientFactory: () => client
      });

      expect(result.status).toBe("pass");
      expect(result.exitCode).toBe(0);
      expect(result.targetUrl).toBe("macos:com.example.App");
      expect(result.steps).toHaveLength(3);
      expect(result.steps.every((s) => s.status === "pass")).toBe(true);

      const cmds = client.calls.map((c) => c.cmd);
      expect(cmds).toContain("check");
      expect(cmds).toContain("launch");
      expect(cmds).toContain("click");
      expect(cmds).toContain("fill"); // type → focused fill
      expect(cmds).toContain("count"); // assert visible
      expect(cmds).toContain("quit"); // teardown
      expect(fs.existsSync(path.join(runDir, "result.json"))).toBe(true);
    } finally {
      process.chdir(cwd);
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("rejects a hunt with a web-only step before launching the helper", async () => {
    const project = setupProject(MAC_CONFIG, "weburl", "steps:\n  - navigate: '/'\n");
    const client = new FakeClient(macResponder);
    const cwd = process.cwd();
    try {
      process.chdir(project);
      await expect(runHunt({ huntName: "weburl", macClientFactory: () => client })).rejects.toThrow(
        'Step "navigate" is not supported by the macOS target'
      );
      expect(client.calls).toHaveLength(0); // never launched
    } finally {
      process.chdir(cwd);
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("rejects a sub-hunt containing a web-only step (macOS target)", async () => {
    const project = setupProject(MAC_CONFIG, "parent", "steps:\n  - runHunt: sub\n");
    fs.writeFileSync(
      path.join(project, ".prowl", "hunts", "sub.yml"),
      "steps:\n  - navigate: '/'\n"
    );
    const client = new FakeClient(macResponder);
    const cwd = process.cwd();
    try {
      process.chdir(project);
      const { result } = await runHunt({ huntName: "parent", macClientFactory: () => client });
      expect(result.status).toBe("fail");
      expect(
        result.steps.some(
          (s) => s.status === "fail" && (s.error ?? "").includes("not supported by the macOS target")
        )
      ).toBe(true);
    } finally {
      process.chdir(cwd);
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("rejects a sub-hunt with a URL assertion (the silent-false-PASS scenario)", async () => {
    const project = setupProject(MAC_CONFIG, "parent", "steps:\n  - runHunt: sub\n");
    // Without the sub-hunt check this would compare against currentUrl()
    // "macos:com.example.App" — and pass if the substring appeared in the id.
    fs.writeFileSync(
      path.join(project, ".prowl", "hunts", "sub.yml"),
      "steps:\n  - assert: { urlIncludes: 'com.example' }\n"
    );
    const client = new FakeClient(macResponder);
    const cwd = process.cwd();
    try {
      process.chdir(project);
      const { result } = await runHunt({ huntName: "parent", macClientFactory: () => client });
      expect(result.status).toBe("fail");
      expect(
        result.steps.some(
          (s) => s.status === "fail" && (s.error ?? "").includes("not supported by the macOS target")
        )
      ).toBe(true);
    } finally {
      process.chdir(cwd);
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("rejects when the target app is excluded by allowedApps", async () => {
    const project = setupProject(
      "target:\n  type: macos\n  app: 'com.example.App'\nguardrails:\n  allowedApps: ['com.other.App']\n",
      "portable",
      "steps:\n  - click: 'Save'\n"
    );
    const client = new FakeClient(macResponder);
    const cwd = process.cwd();
    try {
      process.chdir(project);
      await expect(runHunt({ huntName: "portable", macClientFactory: () => client })).rejects.toThrow(
        "not in guardrails.allowedApps"
      );
      expect(client.calls).toHaveLength(0);
    } finally {
      process.chdir(cwd);
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
});
