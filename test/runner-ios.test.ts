import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runHunt } from "../src/runner/index.js";
import { createIosDriver, type IosAgentClient, type IosQuery } from "../src/browser/ios-driver.js";
import type { IosSession, LaunchIosOptions } from "../src/browser/ios-helper.js";

/** A fake WDA agent: every element lookup succeeds with one element. */
class FakeAgent implements IosAgentClient {
  async findElement(_query: IosQuery): Promise<string | null> {
    return "el-1";
  }
  async findElements(_query: IosQuery): Promise<string[]> {
    return ["el-1"];
  }
  async click(): Promise<void> {}
  async setValue(): Promise<void> {}
  async getText(): Promise<string | null> {
    return "text";
  }
  async sendKeys(): Promise<void> {}
  async homescreen(): Promise<void> {}
  async close(): Promise<void> {}
}

class FailingAgent extends FakeAgent {
  async findElement(_query: IosQuery): Promise<string | null> {
    throw new Error("transient iOS failure");
  }
}

type Harness = {
  factory: (options: LaunchIosOptions) => Promise<IosSession>;
  launched: LaunchIosOptions[];
  tornDown: () => boolean;
};

function harness(bundleId = "com.example.App"): Harness {
  const launched: LaunchIosOptions[] = [];
  let tornDown = false;
  const factory = async (options: LaunchIosOptions): Promise<IosSession> => {
    launched.push(options);
    const agent = new FakeAgent();
    return {
      client: agent,
      driver: createIosDriver(agent, {
        appLabel: bundleId,
        captureScreenshot: async (p) => fs.writeFileSync(p, "PNGDATA")
      }),
      bundleId,
      udid: "BBBB",
      teardown: async () => {
        tornDown = true;
      }
    };
  };
  return { factory, launched, tornDown: () => tornDown };
}

function setupProject(configYml: string, huntName: string, huntYml: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowl-runios-"));
  const huntsDir = path.join(tmpDir, ".prowl", "hunts");
  fs.mkdirSync(huntsDir, { recursive: true });
  fs.writeFileSync(path.join(tmpDir, ".prowl", "config.yml"), configYml);
  fs.writeFileSync(path.join(huntsDir, `${huntName}.yml`), huntYml);
  return tmpDir;
}

const IOS_CONFIG =
  "target:\n  type: ios\n  app: 'com.example.App'\nguardrails:\n  allowedApps: ['com.example.App']\n";

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

describe("runHunt — iOS target (PROWL-059)", () => {
  it("runs a portable hunt end-to-end through a fake agent", async () => {
    const project = setupProject(
      IOS_CONFIG,
      "portable",
      "steps:\n  - click: { selector: 'id=save' }\n  - type: 'hello'\n  - assert: { visible: 'Saved' }\n"
    );
    const h = harness();
    await withProject(project, async () => {
      const { result, runDir } = await runHunt({ huntName: "portable", iosSessionFactory: h.factory });
      expect(result.status).toBe("pass");
      expect(result.exitCode).toBe(0);
      expect(result.targetUrl).toBe("ios:com.example.App");
      expect(result.steps).toHaveLength(3);
      expect(result.steps.every((s) => s.status === "pass")).toBe(true);
      expect(h.launched[0]).toMatchObject({ app: "com.example.App" });
      expect(h.tornDown()).toBe(true);
      expect(fs.existsSync(path.join(runDir, "result.json"))).toBe(true);
      expect(result.artifacts.screenshots.length).toBeGreaterThan(0);
      expect(fs.existsSync(path.join(runDir, result.artifacts.screenshots[0]))).toBe(true);
    });
  });

  it("passes udid and coldStart from the target into the session factory", async () => {
    const project = setupProject(
      "target:\n  type: ios\n  app: 'com.example.App'\n  udid: 'CAFE-1234'\n  coldStart: true\nguardrails:\n  allowedApps: ['com.example.App']\n",
      "portable",
      "steps:\n  - click: 'Save'\n"
    );
    const h = harness();
    await withProject(project, async () => {
      const { result } = await runHunt({ huntName: "portable", iosSessionFactory: h.factory });
      expect(result.status).toBe("pass");
      expect(h.launched[0]).toMatchObject({
        app: "com.example.App",
        udid: "CAFE-1234",
        coldStart: true
      });
    });
  });

  it("rejects a web-only step before launching WDA", async () => {
    const project = setupProject(IOS_CONFIG, "weburl", "steps:\n  - navigate: '/'\n");
    const h = harness();
    await withProject(project, async () => {
      await expect(runHunt({ huntName: "weburl", iosSessionFactory: h.factory })).rejects.toThrow(
        'Step "navigate" is not supported by the iOS target'
      );
      expect(h.launched).toHaveLength(0);
    });
  });

  it("rejects top-level hunt assertions before launching WDA", async () => {
    const project = setupProject(
      IOS_CONFIG,
      "with-assertions",
      "steps:\n  - click: 'Save'\nassertions:\n  - selectorExists: 'Saved'\n"
    );
    const h = harness();
    await withProject(project, async () => {
      await expect(
        runHunt({ huntName: "with-assertions", iosSessionFactory: h.factory })
      ).rejects.toThrow("Hunt-level assertions are not supported by the iOS target");
      expect(h.launched).toHaveLength(0);
    });
  });

  it("rejects when the target app is excluded by allowedApps", async () => {
    const project = setupProject(
      "target:\n  type: ios\n  app: 'com.example.App'\nguardrails:\n  allowedApps: ['com.other.App']\n",
      "portable",
      "steps:\n  - click: 'Save'\n"
    );
    const h = harness();
    await withProject(project, async () => {
      await expect(runHunt({ huntName: "portable", iosSessionFactory: h.factory })).rejects.toThrow(
        "not in guardrails.allowedApps"
      );
      expect(h.launched).toHaveLength(0);
    });
  });

  it("retries an iOS hunt and reports the successful attempt", async () => {
    const project = setupProject(
      IOS_CONFIG,
      "retry",
      "retry:\n  maxRetries: 1\n  delay: 0\nsteps:\n  - click: 'Save'\n"
    );
    const launched: LaunchIosOptions[] = [];
    let tornDown = 0;
    const factory = async (options: LaunchIosOptions): Promise<IosSession> => {
      launched.push(options);
      const agent = launched.length === 1 ? new FailingAgent() : new FakeAgent();
      return {
        client: agent,
        driver: createIosDriver(agent, {
          appLabel: "com.example.App",
          captureScreenshot: async (p) => fs.writeFileSync(p, "PNGDATA")
        }),
        bundleId: "com.example.App",
        udid: "BBBB",
        teardown: async () => {
          tornDown += 1;
        }
      };
    };

    await withProject(project, async () => {
      const { result } = await runHunt({ huntName: "retry", iosSessionFactory: factory });
      expect(result.status).toBe("pass");
      expect(result.artifacts.summary).toBe("Passed on attempt 2 of 2");
      expect(launched).toHaveLength(2);
      expect(tornDown).toBe(2);
    });
  });
});
