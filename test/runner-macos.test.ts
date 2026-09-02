import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runHunt } from "../src/runner/index.js";
import type { MacHelperClient } from "../src/browser/mac-driver.js";

class FakeClient implements MacHelperClient {
  calls: { cmd: string; params: Record<string, unknown> }[] = [];
  constructor(
    private readonly responder: (cmd: string, params: Record<string, unknown>) => Record<string, unknown> = () => ({})
  ) {}
  async request(cmd: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    this.calls.push({ cmd, params });
    return this.responder(cmd, params);
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

  it("runs an assertScreenshot hunt with the window-scoped helper response shape", async () => {
    const project = setupProject(
      MAC_CONFIG,
      "shot",
      "steps:\n  - assertScreenshot: { name: 'home' }\n"
    );
    // The helper writes the capture to the requested path and reports the new
    // window-scoped response shape ({ path, scope }); the runner must accept it
    // and create the baseline on first run.
    const client = new FakeClient((cmd, params) => {
      if (cmd === "screenshot") {
        fs.writeFileSync(String(params.path), "PNGDATA");
        return { path: params.path, scope: "window" };
      }
      return macResponder(cmd);
    });
    const cwd = process.cwd();
    try {
      process.chdir(project);
      const { result } = await runHunt({ huntName: "shot", macClientFactory: () => client });

      expect(result.status).toBe("pass");
      const shot = client.calls.find((c) => c.cmd === "screenshot");
      expect(shot).toBeDefined();
      expect(typeof shot?.params.path).toBe("string");
      expect(shot?.params).not.toHaveProperty("fullPage");
      expect(result.steps.some((s) => s.type === "assertScreenshot" && s.status === "pass")).toBe(true);
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
      expect(client.calls.map((c) => c.cmd)).toContain("quit");
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
      expect(client.calls.map((c) => c.cmd)).toContain("quit");
    } finally {
      process.chdir(cwd);
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("runs applicable top-level hunt assertions and marks web-only ones skipped", async () => {
    // PROWL-050 / ARCH-004: applicable assertions (selectorExists/selectorNotExists)
    // run against the driver after steps; web-only ones (urlIncludes, and the
    // config-default noConsoleErrors/noNetworkErrors) are reported as skipped with
    // a warning, never silently dropped and never a hard error.
    const project = setupProject(
      MAC_CONFIG,
      "with-assertions",
      [
        "steps:",
        "  - click: 'Save'",
        "assertions:",
        "  - selectorExists: 'Saved'",
        "  - selectorNotExists: 'Missing'",
        "  - urlIncludes: '/home'",
        ""
      ].join("\n")
    );
    // selectorExists → count 1 (pass); selectorNotExists → count 0 (pass).
    const client = new FakeClient((cmd, params) => {
      if (cmd === "count") {
        const query = params.query as { value?: string } | undefined;
        return { count: query?.value === "Missing" ? 0 : 1 };
      }
      return macResponder(cmd);
    });
    const cwd = process.cwd();
    try {
      process.chdir(project);
      const { result, runDir } = await runHunt({
        huntName: "with-assertions",
        macClientFactory: () => client
      });

      expect(result.status).toBe("pass");
      // Helper WAS launched now (assertions no longer reject before launch).
      expect(client.calls.map((c) => c.cmd)).toContain("launch");
      expect(client.calls.map((c) => c.cmd)).toContain("quit");

      const byType = (t: string) => result.assertions.find((a) => a.type === t);
      expect(byType("selectorExists")).toMatchObject({ status: "pass", value: "Saved" });
      expect(byType("selectorNotExists")).toMatchObject({ status: "pass", value: "Missing" });
      expect(byType("urlIncludes")?.status).toBe("skipped");
      expect(byType("urlIncludes")?.error).toContain("web-only");
      // Config defaults are web-only on native, surfaced as skipped (not silent).
      expect(byType("noConsoleErrors")?.status).toBe("skipped");
      expect(byType("noNetworkErrors")?.status).toBe("skipped");

      // Skipped assertions are visible in result.json and summary.md.
      const written = JSON.parse(fs.readFileSync(path.join(runDir, "result.json"), "utf-8"));
      expect(written.assertions.some((a: { status: string }) => a.status === "skipped")).toBe(true);
      const summary = fs.readFileSync(path.join(runDir, "summary.md"), "utf-8");
      expect(summary).toContain("[SKIPPED]");
    } finally {
      process.chdir(cwd);
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("applies forbidden selector guardrails to top-level native assertions", async () => {
    const project = setupProject(
      [
        "target:",
        "  type: macos",
        "  app: 'com.example.App'",
        "guardrails:",
        "  allowedApps: ['com.example.App']",
        "  forbiddenSelectors:",
        "    - 'text=\"Danger\"'",
        ""
      ].join("\n"),
      "assert-forbidden",
      [
        "steps:",
        "  - click: 'Save'",
        "assertions:",
        "  - selectorExists: 'text=\"Danger Zone\"'",
        ""
      ].join("\n")
    );
    const client = new FakeClient(macResponder);
    const cwd = process.cwd();
    try {
      process.chdir(project);
      const { result } = await runHunt({
        huntName: "assert-forbidden",
        macClientFactory: () => client
      });

      expect(result.status).toBe("fail");
      expect(result.exitCode).toBe(1);
      expect(result.assertions.find((a) => a.type === "selectorExists")).toMatchObject({
        status: "fail",
        error: 'Native assertion "selectorExists" failed: Forbidden selector: text="Danger Zone"'
      });
      expect(
        client.calls.some(
          (c) => c.cmd === "count" && JSON.stringify(c.params).includes("Danger Zone")
        )
      ).toBe(false);
      expect(client.calls.map((c) => c.cmd)).toContain("quit");
    } finally {
      process.chdir(cwd);
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("fails the hunt when an applicable top-level assertion fails", async () => {
    // A failing applicable assertion fails the hunt, matching the web path.
    const project = setupProject(
      MAC_CONFIG,
      "assert-fail",
      "steps:\n  - click: 'Save'\nassertions:\n  - selectorExists: 'Nope'\n"
    );
    // count 0 → selectorExists fails.
    const client = new FakeClient((cmd) => (cmd === "count" ? { count: 0 } : macResponder(cmd)));
    const cwd = process.cwd();
    try {
      process.chdir(project);
      const { result } = await runHunt({ huntName: "assert-fail", macClientFactory: () => client });
      expect(result.status).toBe("fail");
      expect(result.exitCode).toBe(1);
      const selectorExists = result.assertions.find((a) => a.type === "selectorExists");
      expect(selectorExists).toMatchObject({ status: "fail", value: "Nope" });
      expect(client.calls.map((c) => c.cmd)).toContain("quit");
    } finally {
      process.chdir(cwd);
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("evaluates top-level native assertions after a step failure", async () => {
    const project = setupProject(
      MAC_CONFIG,
      "step-fail-assertions",
      "steps:\n  - click: 'Save'\nassertions:\n  - selectorExists: 'Saved'\n"
    );
    const client = new FakeClient((cmd) => {
      if (cmd === "click") {
        throw new Error("click failed");
      }
      if (cmd === "count") {
        return { count: 1 };
      }
      return macResponder(cmd);
    });
    const cwd = process.cwd();
    try {
      process.chdir(project);
      const { result } = await runHunt({
        huntName: "step-fail-assertions",
        macClientFactory: () => client
      });

      expect(result.status).toBe("fail");
      expect(result.exitCode).toBe(1);
      expect(result.steps.find((s) => s.type === "click")).toMatchObject({
        status: "fail",
        error: "click failed"
      });
      expect(result.assertions.find((a) => a.type === "selectorExists")).toMatchObject({
        status: "pass",
        value: "Saved"
      });
      expect(client.calls.map((c) => c.cmd)).toContain("count");
      expect(client.calls.map((c) => c.cmd)).toContain("quit");
    } finally {
      process.chdir(cwd);
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("rejects sub-hunts with hunt-level assertions and still quits the helper", async () => {
    const project = setupProject(MAC_CONFIG, "parent", "steps:\n  - runHunt: sub\n");
    fs.writeFileSync(
      path.join(project, ".prowl", "hunts", "sub.yml"),
      "steps:\n  - click: 'Save'\nassertions:\n  - selectorExists: 'Saved'\n"
    );
    const client = new FakeClient(macResponder);
    const cwd = process.cwd();
    try {
      process.chdir(project);
      const { result } = await runHunt({ huntName: "parent", macClientFactory: () => client });
      expect(result.status).toBe("fail");
      expect(
        result.steps.some(
          (s) => s.status === "fail" && (s.error ?? "").includes("Hunt-level assertions are not supported")
        )
      ).toBe(true);
      expect(client.calls.map((c) => c.cmd)).toContain("quit");
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
