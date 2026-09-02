import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runHunt } from "../src/runner/index.js";
import { createAndroidDriver, type AndroidAgentClient, type AndroidQuery } from "../src/browser/android-driver.js";
import type { AndroidSession, LaunchAndroidOptions } from "../src/browser/android-helper.js";

/** A fake on-device agent: every element lookup succeeds with one element. */
class FakeAgent implements AndroidAgentClient {
  async findElement(_query: AndroidQuery): Promise<string | null> {
    return "el-1";
  }
  async findElements(_query: AndroidQuery): Promise<string[]> {
    return ["el-1"];
  }
  async click(): Promise<void> {}
  async setValue(): Promise<void> {}
  async getText(): Promise<string | null> {
    return "text";
  }
  async pressKeyCode(): Promise<void> {}
  async screenshotPng(): Promise<Buffer> {
    return Buffer.from("PNGDATA");
  }
  async close(): Promise<void> {}
}

class FailingAgent extends FakeAgent {
  async findElement(_query: AndroidQuery): Promise<string | null> {
    throw new Error("transient Android failure");
  }
}

type Harness = {
  factory: (options: LaunchAndroidOptions) => Promise<AndroidSession>;
  launched: LaunchAndroidOptions[];
  tornDown: () => boolean;
};

function harness(pkg = "com.example.app"): Harness {
  const launched: LaunchAndroidOptions[] = [];
  let tornDown = false;
  const factory = async (options: LaunchAndroidOptions): Promise<AndroidSession> => {
    launched.push(options);
    const agent = new FakeAgent();
    return {
      client: agent,
      driver: createAndroidDriver(agent, { appLabel: pkg }),
      package: pkg,
      serial: "emulator-5554",
      teardown: async () => {
        tornDown = true;
      }
    };
  };
  return { factory, launched, tornDown: () => tornDown };
}

function setupProject(configYml: string, huntName: string, huntYml: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-runandroid-"));
  const huntsDir = path.join(tmpDir, ".prowl", "hunts");
  fs.mkdirSync(huntsDir, { recursive: true });
  fs.writeFileSync(path.join(tmpDir, ".prowl", "config.yml"), configYml);
  fs.writeFileSync(path.join(huntsDir, `${huntName}.yml`), huntYml);
  return tmpDir;
}

const ANDROID_CONFIG =
  "target:\n  type: android\n  app: 'com.example.app'\nguardrails:\n  allowedApps: ['com.example.app']\n";

async function withProject<T>(project: string, run: () => Promise<T>): Promise<T> {
  const cwd = process.cwd();
  try {
    process.chdir(project);
    return await run();
  } finally {
    process.chdir(cwd);
    fs.rmSync(project, { recursive: true, force: true });
  }
}

describe("runHunt — Android target (PROWL-058)", () => {
  it("runs a portable hunt end-to-end through a fake agent", async () => {
    const project = setupProject(
      ANDROID_CONFIG,
      "portable",
      "steps:\n  - click: { selector: 'id=save' }\n  - type: 'hello'\n  - assert: { visible: 'Saved' }\n"
    );
    const h = harness();
    await withProject(project, async () => {
      const { result, runDir } = await runHunt({ huntName: "portable", androidSessionFactory: h.factory });
      expect(result.status).toBe("pass");
      expect(result.exitCode).toBe(0);
      expect(result.targetUrl).toBe("android:com.example.app");
      expect(result.steps).toHaveLength(3);
      expect(result.steps.every((s) => s.status === "pass")).toBe(true);
      expect(h.launched[0]).toMatchObject({ app: "com.example.app" });
      expect(h.tornDown()).toBe(true);
      expect(fs.existsSync(path.join(runDir, "result.json"))).toBe(true);
      expect(result.artifacts.screenshots.length).toBeGreaterThan(0);
      expect(fs.existsSync(path.join(runDir, result.artifacts.screenshots[0]))).toBe(true);
    });
  });

  it("passes deviceSerial and coldStart from the target into the session factory", async () => {
    const project = setupProject(
      "target:\n  type: android\n  app: 'com.example.app'\n  deviceSerial: 'emulator-5556'\n  coldStart: true\nguardrails:\n  allowedApps: ['com.example.app']\n",
      "portable",
      "steps:\n  - click: 'Save'\n"
    );
    const h = harness();
    await withProject(project, async () => {
      const { result } = await runHunt({ huntName: "portable", androidSessionFactory: h.factory });
      expect(result.status).toBe("pass");
      expect(h.launched[0]).toMatchObject({
        app: "com.example.app",
        deviceSerial: "emulator-5556",
        coldStart: true
      });
    });
  });

  it("rejects a web-only step before launching the agent", async () => {
    const project = setupProject(ANDROID_CONFIG, "weburl", "steps:\n  - navigate: '/'\n");
    const h = harness();
    await withProject(project, async () => {
      await expect(runHunt({ huntName: "weburl", androidSessionFactory: h.factory })).rejects.toThrow(
        'Step "navigate" is not supported by the Android target'
      );
      expect(h.launched).toHaveLength(0);
    });
  });

  it("rejects a sub-hunt containing a web-only step (Android target) and still tears down", async () => {
    const project = setupProject(ANDROID_CONFIG, "parent", "steps:\n  - runHunt: sub\n");
    fs.writeFileSync(path.join(project, ".prowl", "hunts", "sub.yml"), "steps:\n  - navigate: '/'\n");
    const h = harness();
    await withProject(project, async () => {
      const { result } = await runHunt({ huntName: "parent", androidSessionFactory: h.factory });
      expect(result.status).toBe("fail");
      expect(
        result.steps.some(
          (s) => s.status === "fail" && (s.error ?? "").includes("not supported by the Android target")
        )
      ).toBe(true);
      expect(h.tornDown()).toBe(true);
    });
  });

  it("runs applicable hunt assertions and skips web-only ones (Android target)", async () => {
    // PROWL-050 / ARCH-004: the applicable subset (selectorExists) runs against
    // the driver; web-only types (urlIncludes) are reported as skipped, never
    // silently dropped and never a hard error — mirrored on this second native
    // target to prove the shared native run path applies the fix uniformly.
    const project = setupProject(
      ANDROID_CONFIG,
      "with-assertions",
      "steps:\n  - click: 'Save'\nassertions:\n  - selectorExists: 'Saved'\n  - urlIncludes: '/home'\n"
    );
    const h = harness();
    await withProject(project, async () => {
      const { result } = await runHunt({ huntName: "with-assertions", androidSessionFactory: h.factory });
      // The fake agent finds one element for any query, so selectorExists passes.
      expect(result.status).toBe("pass");
      expect(h.launched).toHaveLength(1);

      const selectorExists = result.assertions.find((a) => a.type === "selectorExists");
      expect(selectorExists).toMatchObject({ status: "pass", value: "Saved" });

      const urlIncludes = result.assertions.find((a) => a.type === "urlIncludes");
      expect(urlIncludes?.status).toBe("skipped");
      expect(urlIncludes?.error).toContain("web-only");

      // Config defaults (noConsoleErrors/noNetworkErrors) are web-only too.
      expect(result.assertions.some((a) => a.type === "noConsoleErrors" && a.status === "skipped")).toBe(true);
    });
  });

  it("rejects when the target app is excluded by allowedApps", async () => {
    const project = setupProject(
      "target:\n  type: android\n  app: 'com.example.app'\nguardrails:\n  allowedApps: ['com.other.app']\n",
      "portable",
      "steps:\n  - click: 'Save'\n"
    );
    const h = harness();
    await withProject(project, async () => {
      await expect(runHunt({ huntName: "portable", androidSessionFactory: h.factory })).rejects.toThrow(
        "not in guardrails.allowedApps"
      );
      expect(h.launched).toHaveLength(0);
    });
  });

  it("retries an Android hunt and reports the successful attempt", async () => {
    const project = setupProject(
      ANDROID_CONFIG,
      "retry",
      "retry:\n  maxRetries: 1\n  delay: 0\nsteps:\n  - click: 'Save'\n"
    );
    const launched: LaunchAndroidOptions[] = [];
    let tornDown = 0;
    const factory = async (options: LaunchAndroidOptions): Promise<AndroidSession> => {
      launched.push(options);
      const agent = launched.length === 1 ? new FailingAgent() : new FakeAgent();
      return {
        client: agent,
        driver: createAndroidDriver(agent, { appLabel: "com.example.app" }),
        package: "com.example.app",
        serial: "emulator-5554",
        teardown: async () => {
          tornDown += 1;
        }
      };
    };

    await withProject(project, async () => {
      const { result } = await runHunt({ huntName: "retry", androidSessionFactory: factory });
      expect(result.status).toBe("pass");
      expect(result.artifacts.summary).toBe("Passed on attempt 2 of 2");
      expect(launched).toHaveLength(2);
      expect(tornDown).toBe(2);
    });
  });
});
