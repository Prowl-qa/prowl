/**
 * PROWL-058 / ARCH-009 — launch/teardown orchestration for the Android target.
 *
 * Ties together the three layers: adb lifecycle ({@link ./android-adb.js}), the
 * uiautomator2 HTTP agent ({@link ./android-agent.js}), and the driver
 * ({@link ./android-driver.js}). The two prebuilt agent APKs ship inside the
 * `appium-uiautomator2-server` npm package (Apache-2.0) and are resolved from
 * node_modules — never committed to this repo. Every external dependency (adb
 * runner, background spawner, agent connection) is injectable so the whole flow
 * is unit-testable without a device.
 */
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createAndroidDriver, type AndroidAgentClient } from "./android-driver.js";
import {
  clearPackage,
  execFileAdbRunner,
  forceStop,
  forwardDynamicPort,
  installApk,
  launchPackage,
  listDevices,
  parseAaptPackage,
  removeForward,
  selectDeviceSerial,
  spawnAdbProcess,
  startInstrumentation,
  type AdbProcessHandle,
  type AdbRunner,
  type AdbSpawner
} from "./android-adb.js";
import {
  createUia2AgentClient,
  createUia2Session,
  DEFAULT_AGENT_REQUEST_TIMEOUT_MS,
  Uia2Transport,
  waitForAgentReady
} from "./android-agent.js";
import type { SessionDriver } from "./driver.js";

/** The remote port the uiautomator2 server listens on inside the device. */
export const UIA2_REMOTE_PORT = 6790;

/** Locations of the two prebuilt agent APKs. */
export type AgentApks = { serverApk: string; testApk: string };

/** Establishes a live {@link AndroidAgentClient} against a forwarded local port. */
export type AgentConnector = (options: {
  host: string;
  port: number;
  requestTimeoutMs: number;
  readyDeadlineMs: number;
}) => Promise<AndroidAgentClient>;

/** Resolve a package name from an `.apk` file, or null when it can't be determined. */
export type AaptResolver = (apkPath: string) => Promise<string | null>;

/**
 * Resolve the two agent APKs shipped inside `appium-uiautomator2-server`. They
 * live under the package's `apks/` folder; the server APK is version-stamped.
 */
export function resolveAgentApks(requireFn: NodeRequire = createRequire(import.meta.url)): AgentApks {
  let pkgJsonPath: string;
  try {
    pkgJsonPath = requireFn.resolve("appium-uiautomator2-server/package.json");
  } catch {
    throw new Error(
      "The Android target requires the `appium-uiautomator2-server` package (its prebuilt APKs). " +
        "It is a dependency of prowl-tools; run `npm install` to restore it."
    );
  }
  const pkgDir = path.dirname(pkgJsonPath);
  const version = (requireFn(pkgJsonPath) as { version: string }).version;
  const serverApk = path.join(pkgDir, "apks", `appium-uiautomator2-server-v${version}.apk`);
  const testApk = path.join(pkgDir, "apks", "appium-uiautomator2-server-debug-androidTest.apk");
  for (const apk of [serverApk, testApk]) {
    if (!fs.existsSync(apk)) {
      throw new Error(`Expected uiautomator2 agent APK is missing: ${apk}. Reinstall dependencies.`);
    }
  }
  return { serverApk, testApk };
}

function looksLikeApk(app: string): boolean {
  return app.toLowerCase().endsWith(".apk");
}

/** Default aapt-based package resolver: tries `aapt` then `aapt2 dump badging`. */
export const execFileAaptResolver: AaptResolver = async (apkPath) => {
  for (const tool of ["aapt", "aapt2"]) {
    const output = await new Promise<string | null>((resolve) => {
      execFile(
        tool,
        ["dump", "badging", apkPath],
        { encoding: "utf-8", timeout: 20000, maxBuffer: 8 * 1024 * 1024 },
        (error, stdout) => resolve(error ? null : stdout)
      );
    });
    const pkg = output ? parseAaptPackage(output) : null;
    if (pkg) {
      return pkg;
    }
  }
  return null;
};

/** Default connector: builds the HTTP transport, waits for readiness, opens a session. */
export const defaultAgentConnector: AgentConnector = async ({
  host,
  port,
  requestTimeoutMs,
  readyDeadlineMs
}) => {
  const transport = new Uia2Transport({
    baseUrl: `http://${host}:${port}/wd/hub`,
    requestTimeoutMs
  });
  await waitForAgentReady(transport, { deadlineMs: readyDeadlineMs });
  const sessionId = await createUia2Session(transport);
  return createUia2AgentClient(transport, sessionId);
};

export type AndroidSession = {
  client: AndroidAgentClient;
  driver: SessionDriver;
  /** The resolved package name being driven. */
  package: string;
  /** The adb serial of the device being driven. */
  serial: string;
  /** Tear down the session, agent, port forward, and app (best effort). */
  teardown(): Promise<void>;
};

export type LaunchAndroidOptions = {
  /** Package name or `.apk` path. */
  app: string;
  /** adb serial when more than one device is attached. */
  deviceSerial?: string;
  /** `pm clear` the package before launch for a deterministic cold start. */
  coldStart?: boolean;
  timeoutMs?: number;
  // --- injectables (tests / advanced use) ---
  runner?: AdbRunner;
  spawner?: AdbSpawner;
  agentConnector?: AgentConnector;
  apks?: AgentApks;
  aaptResolver?: AaptResolver;
};

/**
 * Resolve the package to launch. A bare package name is used directly; an `.apk`
 * is installed, then its package name is read via aapt (or an actionable error
 * asks the user to name the package).
 */
async function resolvePackage(
  app: string,
  runner: AdbRunner,
  serial: string,
  aaptResolver: AaptResolver
): Promise<string> {
  if (!looksLikeApk(app)) {
    return app;
  }
  const apkPath = path.resolve(app);
  if (!fs.existsSync(apkPath)) {
    throw new Error(`APK not found: ${apkPath}`);
  }
  await installApk(runner, serial, apkPath);
  const pkg = await aaptResolver(apkPath);
  if (!pkg) {
    throw new Error(
      `Installed "${app}" but could not determine its package name. Put Android build-tools ` +
        "`aapt`/`aapt2` on PATH, or set target.app to the package name instead of the .apk path."
    );
  }
  return pkg;
}

/**
 * Preflight, install, launch, and attach the uiautomator2 agent, returning a
 * live {@link AndroidSession}. Actionable errors cover each failure mode: adb
 * missing / no booted device (device selection), agent unreachable (readiness).
 */
export async function launchAndroidSession(options: LaunchAndroidOptions): Promise<AndroidSession> {
  const runner = options.runner ?? execFileAdbRunner;
  const spawner: AdbSpawner = options.spawner ?? spawnAdbProcess;
  const connector = options.agentConnector ?? defaultAgentConnector;
  const aaptResolver = options.aaptResolver ?? execFileAaptResolver;
  const apks = options.apks ?? resolveAgentApks();

  const requestTimeoutMs = Math.max(options.timeoutMs ?? 10000, DEFAULT_AGENT_REQUEST_TIMEOUT_MS) + 5000;
  const readyDeadlineMs = Math.max(options.timeoutMs ?? 10000, DEFAULT_AGENT_REQUEST_TIMEOUT_MS);

  // Preflight: adb reachable + exactly one (or the requested) booted device.
  const devices = await listDevices(runner);
  const serial = selectDeviceSerial(devices, options.deviceSerial);

  const pkg = await resolvePackage(options.app, runner, serial, aaptResolver);

  // Install the on-device agent (both APKs) before instrumenting.
  await installApk(runner, serial, apks.serverApk);
  await installApk(runner, serial, apks.testApk);

  if (options.coldStart) {
    await clearPackage(runner, serial, pkg);
  }
  await launchPackage(runner, serial, pkg);

  let instrumentation: AdbProcessHandle | undefined;
  let localPort: number | undefined;
  let client: AndroidAgentClient | undefined;

  const teardown = async (): Promise<void> => {
    if (client) {
      await client.close().catch(() => undefined);
    }
    instrumentation?.kill();
    if (localPort !== undefined) {
      await removeForward(runner, serial, localPort);
    }
    await forceStop(runner, serial, pkg).catch(() => undefined);
  };

  try {
    instrumentation = startInstrumentation(spawner, serial);
    localPort = await forwardDynamicPort(runner, serial, UIA2_REMOTE_PORT);
    client = await connector({ host: "127.0.0.1", port: localPort, requestTimeoutMs, readyDeadlineMs });
    const driver = createAndroidDriver(client, { appLabel: pkg });
    return { client, driver, package: pkg, serial, teardown };
  } catch (error) {
    await teardown();
    throw error;
  }
}

/** Tear down an Android session (agent session, instrumentation, forward, app). */
export async function closeAndroidSession(session: AndroidSession): Promise<void> {
  await session.teardown();
}
