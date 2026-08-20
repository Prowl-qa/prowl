/**
 * PROWL-059 / ARCH-010 — launch/teardown orchestration for the iOS simulator target.
 *
 * Ties together the three layers: `simctl` lifecycle ({@link ./ios-simctl.js}), the
 * WebDriverAgent HTTP agent ({@link ./ios-agent.js}), and the driver
 * ({@link ./ios-driver.js}). The WDA Xcode project ships inside the
 * `appium-webdriveragent` npm package (Apache-2.0); its runner app is built once
 * with `xcodebuild build-for-testing` and cached under `~/.prowl/wda/` keyed on
 * the WDA + Xcode versions, then installed and launched via `simctl` (no code
 * signing on simulators). Every external dependency (simctl runner, port
 * allocator, agent connector) is injectable so the whole flow is unit-testable
 * without a simulator or Xcode.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createIosDriver, type IosAgentClient } from "./ios-driver.js";
import {
  captureScreenshot,
  execFileXcrunRunner,
  findFreePort,
  installApp,
  launchApp,
  listSimulators,
  reserveSimulatorUdid,
  selectSimulatorUdid,
  terminateApp,
  uninstallApp,
  xcodeVersion,
  type SimctlRunner
} from "./ios-simctl.js";
import {
  createWdaAgentClient,
  createWdaSession,
  DEFAULT_WDA_REQUEST_TIMEOUT_MS,
  waitForWdaReady,
  WdaTransport
} from "./ios-agent.js";
import { assertIosAppAllowed, looksLikeIosAppPath, readIosBundleIdentifier } from "../config/target.js";
import type { SessionDriver } from "./driver.js";

/** Bundle id of the prebuilt WebDriverAgent runner (its xctest host app). */
export const WDA_RUNNER_BUNDLE_ID = "com.facebook.WebDriverAgentRunner.xctrunner";
/** The runner `.app` produced by `xcodebuild build-for-testing`. */
export const WDA_RUNNER_APP_NAME = "WebDriverAgentRunner-Runner.app";
/** Env var WDA reads to pick its HTTP port (forwarded via `SIMCTL_CHILD_USE_PORT`). */
export const WDA_USE_PORT_ENV = "USE_PORT";
/** One retry covers the race where a released dynamic port is claimed before WDA binds. */
const WDA_STARTUP_ATTEMPTS = 2;

/** Establishes a live {@link IosAgentClient} against a running WDA HTTP server. */
export type IosAgentConnector = (options: {
  host: string;
  port: number;
  bundleId: string;
  requestTimeoutMs: number;
  readyDeadlineMs: number;
}) => Promise<IosAgentClient>;

/** Default connector: builds the HTTP transport, waits for readiness, opens a session. */
export const defaultIosAgentConnector: IosAgentConnector = async ({
  host,
  port,
  bundleId,
  requestTimeoutMs,
  readyDeadlineMs
}) => {
  const transport = new WdaTransport({ baseUrl: `http://${host}:${port}`, requestTimeoutMs });
  await waitForWdaReady(transport, { deadlineMs: readyDeadlineMs });
  const sessionId = await createWdaSession(transport, bundleId);
  return createWdaAgentClient(transport, sessionId);
};

/** Resolve the WDA Xcode project bundled inside `appium-webdriveragent`. */
export function resolveWdaProject(requireFn: NodeRequire = createRequire(import.meta.url)): {
  projectPath: string;
  version: string;
} {
  let pkgJsonPath: string;
  try {
    pkgJsonPath = requireFn.resolve("appium-webdriveragent/package.json");
  } catch {
    throw new Error(
      "The iOS target requires the `appium-webdriveragent` package (its WDA Xcode project). " +
        "It is an optional dependency of prowl-tools; it may have been skipped (--omit=optional) " +
        "or failed to install. Restore it for a global Prowl install with: " +
        "npm install -g appium-webdriveragent@16.4.0. If Prowl is installed locally in a " +
        "project, run: npm install appium-webdriveragent@16.4.0"
    );
  }
  const pkgDir = path.dirname(pkgJsonPath);
  const version = (requireFn(pkgJsonPath) as { version: string }).version;
  const projectPath = path.join(pkgDir, "WebDriverAgent.xcodeproj");
  if (!fs.existsSync(projectPath)) {
    throw new Error(`Expected WebDriverAgent project is missing: ${projectPath}. Reinstall dependencies.`);
  }
  return { projectPath, version };
}

/** Cache directory for a built WDA runner, keyed on the WDA + Xcode versions. */
export function wdaCacheDir(wdaVersion: string, xcode: string, homeDir: string = os.homedir()): string {
  return path.join(homeDir, ".prowl", "wda", `${wdaVersion}-xcode${xcode}`);
}

/** Path to the built runner app inside a derived-data directory. */
function runnerAppPath(derivedDataPath: string): string {
  return path.join(derivedDataPath, "Build", "Products", "Debug-iphonesimulator", WDA_RUNNER_APP_NAME);
}

export type ResolveWdaRunnerOptions = {
  runner?: SimctlRunner;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  requireFn?: NodeRequire;
  /** One-line progress notice sink (defaults to stderr). */
  logger?: (message: string) => void;
};

/**
 * Resolve a WebDriverAgent runner `.app`. Order: (a) the `PROWL_WDA_RUNNER` env
 * override; (b) a previously built runner in the version-keyed cache; (c) a
 * one-time `xcodebuild build-for-testing` that populates the cache. Simulators
 * need no code signing. Throws actionable errors when Xcode is missing or the
 * build fails.
 */
export async function resolveWdaRunner(options: ResolveWdaRunnerOptions = {}): Promise<string> {
  const runner = options.runner ?? execFileXcrunRunner;
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const log = options.logger ?? ((message: string) => process.stderr.write(`${message}\n`));

  const override = env.PROWL_WDA_RUNNER;
  if (override) {
    if (!fs.existsSync(override)) {
      throw new Error(`PROWL_WDA_RUNNER points at a missing path: ${override}`);
    }
    return override;
  }

  const { projectPath, version } = resolveWdaProject(options.requireFn);
  const xcode = await xcodeVersion(runner);
  if (!xcode) {
    throw new Error(
      "Could not determine the Xcode version (`xcrun xcodebuild -version`). The iOS target " +
        "requires Xcode on macOS. Install it and run `xcode-select --switch`, then retry."
    );
  }

  const cacheDir = wdaCacheDir(version, xcode, homeDir);
  const cachedRunner = runnerAppPath(cacheDir);
  if (fs.existsSync(cachedRunner)) {
    return cachedRunner;
  }

  log(
    `Prowl: building WebDriverAgent for the iOS target (first run only; this can take a few minutes)…`
  );
  fs.mkdirSync(cacheDir, { recursive: true });
  const result = await runner(
    [
      "xcodebuild",
      "build-for-testing",
      "-project",
      projectPath,
      "-scheme",
      "WebDriverAgentRunner",
      "-destination",
      "generic/platform=iOS Simulator",
      "-derivedDataPath",
      cacheDir,
      "CODE_SIGNING_ALLOWED=NO"
    ],
    { timeoutMs: 1_200_000 }
  );
  if (result.code !== 0) {
    throw new Error(
      "Failed to build WebDriverAgent with `xcodebuild build-for-testing`. Ensure a full Xcode " +
        "(not just the command-line tools) is installed and selected (`xcode-select -p`). " +
        `Details: ${(result.stderr.trim() || result.stdout.trim()).slice(-800)}`
    );
  }
  if (!fs.existsSync(cachedRunner)) {
    throw new Error(
      `WebDriverAgent build succeeded but the runner app was not found at ${cachedRunner}. ` +
        "This may indicate an Xcode layout change; set PROWL_WDA_RUNNER to a prebuilt runner."
    );
  }
  return cachedRunner;
}

export type IosSession = {
  client: IosAgentClient;
  driver: SessionDriver;
  /** The resolved bundle id being driven. */
  bundleId: string;
  /** The UDID of the simulator being driven. */
  udid: string;
  /** Tear down the session, WDA runner, and target app (best effort). */
  teardown(): Promise<void>;
};

export type LaunchIosOptions = {
  /** Bundle id or `.app` path. */
  app: string;
  /** Simulator UDID when more than one is booted. */
  udid?: string;
  /** Uninstall+reinstall the app before launch (requires a `.app` path). */
  coldStart?: boolean;
  timeoutMs?: number;
  // --- injectables (tests / advanced use) ---
  runner?: SimctlRunner;
  portAllocator?: () => Promise<number>;
  agentConnector?: IosAgentConnector;
  /** Skip WDA build/resolution by supplying the runner app path directly. */
  wdaRunnerApp?: string;
  /** Optional app scope guardrail from config.guardrails.allowedApps. */
  allowedApps?: string[];
  /** Override the simulator lock root; intended for tests. */
  simulatorLockRoot?: string;
  logger?: (message: string) => void;
};

/**
 * Resolve the bundle id to drive. A bare bundle id is used directly; a `.app`
 * path is validated, its `CFBundleIdentifier` read from the bundle's root
 * `Info.plist`, and (after guardrail check) installed. `coldStart` reinstalls a
 * `.app`; with a bare bundle id it is a hard, actionable error.
 */
async function resolveBundleId(
  app: string,
  runner: SimctlRunner,
  udid: string,
  coldStart: boolean,
  allowedApps: string[]
): Promise<string> {
  if (!looksLikeIosAppPath(app)) {
    assertIosAppAllowed(allowedApps, app);
    if (coldStart) {
      throw new Error(
        `coldStart requires target.app to be a built .app bundle path (a bare bundle id like ` +
          `"${app}" cannot be reinstalled). Point target.app at the .app, or drop coldStart.`
      );
    }
    return app;
  }
  const appPath = path.resolve(app);
  if (!fs.existsSync(appPath)) {
    throw new Error(`.app bundle not found: ${appPath}`);
  }
  const bundleId = readIosBundleIdentifier(appPath);
  if (!bundleId) {
    throw new Error(
      `Could not read CFBundleIdentifier from "${appPath}" (root Info.plist). ` +
        "Ensure target.app points at a built iOS .app bundle."
    );
  }
  assertIosAppAllowed(allowedApps, appPath);
  if (coldStart) {
    await uninstallApp(runner, udid, bundleId);
  }
  await installApp(runner, udid, appPath);
  return bundleId;
}

/**
 * Preflight, install, launch, and attach WDA, returning a live {@link IosSession}.
 * Actionable errors cover each failure mode: Xcode/simctl missing, no booted
 * simulator (device selection), WDA build failures, agent unreachable (readiness).
 */
export async function launchIosSession(options: LaunchIosOptions): Promise<IosSession> {
  const runner = options.runner ?? execFileXcrunRunner;
  const portAllocator = options.portAllocator ?? findFreePort;
  const connector = options.agentConnector ?? defaultIosAgentConnector;

  const requestTimeoutMs = Math.max(options.timeoutMs ?? 10000, DEFAULT_WDA_REQUEST_TIMEOUT_MS) + 5000;
  // WDA's HTTP server can take a while to come up on a cold simulator.
  const readyDeadlineMs = Math.max(options.timeoutMs ?? 10000, 60000);

  // Preflight: simctl reachable + exactly one (or the requested) booted simulator.
  const devices = await listSimulators(runner);
  const udid = selectSimulatorUdid(devices, options.udid);
  const reservation = await reserveSimulatorUdid(udid, { lockRoot: options.simulatorLockRoot });

  let reservationReleased = false;
  const releaseReservation = async (): Promise<void> => {
    if (reservationReleased) {
      return;
    }
    reservationReleased = true;
    await reservation.release();
  };

  try {
    const bundleId = await resolveBundleId(
      options.app,
      runner,
      udid,
      options.coldStart ?? false,
      options.allowedApps ?? []
    );

    const wdaRunnerApp =
      options.wdaRunnerApp ?? (await resolveWdaRunner({ runner, logger: options.logger }));

    await installApp(runner, udid, wdaRunnerApp);

    for (let attempt = 1; attempt <= WDA_STARTUP_ATTEMPTS; attempt += 1) {
      let client: IosAgentClient | undefined;
      let tornDown = false;
      let terminateWda = false;
      let terminateTarget = false;
      let stage: "port" | "wda-launch" | "target-launch" | "connect" = "port";
      const teardownAttempt = async (): Promise<void> => {
        if (tornDown) {
          return;
        }
        tornDown = true;
        if (client) {
          await client.close().catch(() => undefined);
        }
        if (terminateWda) {
          await terminateApp(runner, udid, WDA_RUNNER_BUNDLE_ID);
        }
        if (terminateTarget) {
          await terminateApp(runner, udid, bundleId);
        }
      };

      try {
        const port = await portAllocator();
        stage = "wda-launch";
        terminateWda = true;
        await launchApp(runner, udid, WDA_RUNNER_BUNDLE_ID, { [WDA_USE_PORT_ENV]: String(port) });

        stage = "target-launch";
        terminateTarget = true;
        await launchApp(runner, udid, bundleId);

        stage = "connect";
        client = await connector({ host: "127.0.0.1", port, bundleId, requestTimeoutMs, readyDeadlineMs });
        const driver = createIosDriver(client, {
          appLabel: bundleId,
          captureScreenshot: (outPath: string) => captureScreenshot(runner, udid, outPath)
        });
        const teardown = async (): Promise<void> => {
          await teardownAttempt();
          await releaseReservation();
        };
        return { client, driver, bundleId, udid, teardown };
      } catch (error) {
        await teardownAttempt();
        if (stage === "target-launch" || attempt >= WDA_STARTUP_ATTEMPTS) {
          throw error instanceof Error ? error : new Error(String(error));
        }
      }
    }

    throw new Error("WebDriverAgent startup failed without an error.");
  } catch (error) {
    await releaseReservation().catch(() => undefined);
    throw error;
  }
}

/** Tear down an iOS session (agent session, WDA runner, target app). */
export async function closeIosSession(session: IosSession): Promise<void> {
  await session.teardown();
}
