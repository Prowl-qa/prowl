/**
 * PROWL-059 / ARCH-010 — launch/teardown orchestration for the iOS simulator target.
 *
 * Ties together the three layers: `simctl` lifecycle ({@link ./ios-simctl.js}), the
 * WebDriverAgent HTTP agent ({@link ./ios-agent.js}), and the driver
 * ({@link ./ios-driver.js}). The WDA Xcode project ships inside the
 * `appium-webdriveragent` npm package (Apache-2.0); it is built once with
 * `xcodebuild build-for-testing` and cached under `~/.prowl/wda/` keyed on the
 * WDA + Xcode versions.
 *
 * PROWL-069 / ARCH-013 — WDA is launched via the standard XCTest host launch
 * (`xcodebuild test-without-building` driven by the generated `.xctestrun`), not
 * by `simctl launch` of the runner `.app`. On iOS 26+ a bare `simctl launch` of
 * `com.facebook.WebDriverAgentRunner.xctrunner` is terminated by RunningBoard
 * ("had no entitlements"): the xctrunner must be hosted by the test runner, which
 * supplies the entitlements the bare launch lacks. This is now the single launch
 * path (the older preinstalled-runner fast path is retired) — it is how
 * Appium/WebDriverAgent launch on modern runtimes and it works on iOS 18 and 26+
 * alike. Every external dependency (simctl runner, xcodebuild spawner, xctestrun
 * preparer, port allocator, agent connector) is injectable so the whole flow is
 * unit-testable without a simulator or Xcode.
 */
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
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
  spawnXcrunProcess,
  terminateApp,
  uninstallApp,
  xcodeVersion,
  type SimctlRunner,
  type XcrunProcessHandle,
  type XcrunSpawner
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
/** Env var WDA reads to pick its HTTP port (injected into the runner's xctestrun env). */
export const WDA_USE_PORT_ENV = "USE_PORT";
/** Filename prefix each launch's port-injected xctestrun (a Products-dir sibling) carries. */
const PREPARED_XCTESTRUN_PREFIX = "prowl-wda-xctestrun-";
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

/** The `Build/Products` directory a `-derivedDataPath` build writes the xctestrun into. */
function productsDir(derivedDataPath: string): string {
  return path.join(derivedDataPath, "Build", "Products");
}

/** First `*.xctestrun` file in `dir`, or null when the directory is missing/empty. */
function findXctestrunIn(dir: string): string | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const match = entries
    .filter((name) => name.endsWith(".xctestrun") && !name.startsWith(PREPARED_XCTESTRUN_PREFIX))
    .sort()[0];
  return match ? path.join(dir, match) : null;
}

/**
 * Resolve the `.xctestrun` that a `PROWL_WDA_RUNNER` override points at. The
 * override may name the xctestrun directly, a derived-data / Products directory
 * that contains one, or (for backward compatibility) the runner `.app` whose
 * sibling `Build/Products/*.xctestrun` we can locate.
 */
function resolveOverrideXctestrun(override: string): string {
  if (!fs.existsSync(override)) {
    throw new Error(`PROWL_WDA_RUNNER points at a missing path: ${override}`);
  }
  if (override.endsWith(".xctestrun")) {
    return override;
  }
  const candidates: string[] = [];
  const stat = fs.statSync(override);
  if (stat.isDirectory()) {
    // A derived-data dir, a Products dir, or any dir that directly holds one.
    candidates.push(override, productsDir(override));
  } else if (override.endsWith(".app")) {
    // Build/Products/<Config>-iphonesimulator/Runner.app → Build/Products/*.xctestrun
    candidates.push(path.dirname(path.dirname(override)));
  }
  for (const dir of candidates) {
    const found = findXctestrunIn(dir);
    if (found) {
      return found;
    }
  }
  throw new Error(
    `PROWL_WDA_RUNNER (${override}) does not resolve to a WebDriverAgent .xctestrun. ` +
      "Point it at the generated `*.xctestrun`, at the `-derivedDataPath` directory from " +
      "`xcodebuild build-for-testing`, or at that build's runner `.app`."
  );
}

export type ResolveWdaTestRunOptions = {
  runner?: SimctlRunner;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  requireFn?: NodeRequire;
  /** One-line progress notice sink (defaults to stderr). */
  logger?: (message: string) => void;
};

/**
 * Resolve a WebDriverAgent `.xctestrun` file (the input to the XCTest host
 * launch). Order: (a) the `PROWL_WDA_RUNNER` env override; (b) a previously built
 * xctestrun in the version-keyed cache; (c) a one-time
 * `xcodebuild build-for-testing` that populates the cache. Simulators need no
 * code signing. Throws actionable errors when Xcode is missing or the build fails.
 */
export async function resolveWdaTestRun(options: ResolveWdaTestRunOptions = {}): Promise<string> {
  const runner = options.runner ?? execFileXcrunRunner;
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const log = options.logger ?? ((message: string) => process.stderr.write(`${message}\n`));

  const override = env.PROWL_WDA_RUNNER;
  if (override) {
    return resolveOverrideXctestrun(override);
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
  const cached = findXctestrunIn(productsDir(cacheDir));
  if (cached) {
    return cached;
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
  const built = findXctestrunIn(productsDir(cacheDir));
  if (!built) {
    throw new Error(
      `WebDriverAgent build succeeded but no .xctestrun was found under ${productsDir(cacheDir)}. ` +
        "This may indicate an Xcode layout change; set PROWL_WDA_RUNNER to a prebuilt runner/xctestrun."
    );
  }
  return built;
}

/**
 * Return a deep copy of a parsed `.xctestrun` plist with the WDA HTTP port
 * (`USE_PORT`) injected into every test target's `EnvironmentVariables`. WDA
 * reads `USE_PORT` from its process environment; under `xcodebuild test` that
 * environment comes from the xctestrun, so the dynamic port must be written here.
 *
 * Handles both xctestrun layouts: format 1 (top-level dict keyed by test-target
 * name) and format 2 (a `TestConfigurations[].TestTargets[]` tree). A test target
 * is recognized by a `TestBundlePath`/`TestHostPath` string; any object that
 * already carries an `EnvironmentVariables` dict is updated too. Throws when no
 * target is found, so a future format change fails loudly rather than launching
 * WDA on the wrong port.
 */
export function injectUsePortIntoXctestrun(plist: unknown, port: number): unknown {
  const clone = structuredClone(plist);
  let injected = 0;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const entry of node) {
        visit(entry);
      }
      return;
    }
    if (!node || typeof node !== "object") {
      return;
    }
    const obj = node as Record<string, unknown>;
    const isTarget =
      typeof obj.TestBundlePath === "string" || typeof obj.TestHostPath === "string";
    const existingEnv =
      obj.EnvironmentVariables && typeof obj.EnvironmentVariables === "object" &&
      !Array.isArray(obj.EnvironmentVariables)
        ? (obj.EnvironmentVariables as Record<string, unknown>)
        : undefined;
    if (isTarget || existingEnv) {
      const env = existingEnv ?? {};
      env[WDA_USE_PORT_ENV] = String(port);
      obj.EnvironmentVariables = env;
      injected += 1;
    }
    for (const value of Object.values(obj)) {
      visit(value);
    }
  };
  visit(clone);
  if (injected === 0) {
    throw new Error(
      "Could not find a test target in the WebDriverAgent .xctestrun to set USE_PORT. " +
        "The xctestrun format may have changed; set PROWL_WDA_RUNNER to a compatible runner."
    );
  }
  return clone;
}

/**
 * Produce a launch-specific `.xctestrun` with `USE_PORT` set to `port`, returning
 * its path. The base xctestrun (built/cached) is never mutated in place.
 */
export type WdaTestRunPreparer = (options: {
  xctestrunPath: string;
  port: number;
}) => Promise<string>;

/** Run `plutil`, resolving its stdout; throws an actionable error on failure. */
function runPlutil(args: string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(
      "plutil",
      args,
      { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `\`plutil ${args.join(" ")}\` failed: ${(stderr || error.message).slice(0, 400)}`
            )
          );
          return;
        }
        resolve(stdout ?? "");
      }
    );
  });
}

/**
 * Default preparer: reads the base xctestrun with `plutil` (JSON), injects
 * `USE_PORT`, and writes a fresh, uniquely-named xctestrun **next to the base
 * one**. This placement is required, not incidental: an xctestrun's product
 * paths are relative to `__TESTROOT__`, which xcodebuild resolves to the
 * directory containing the xctestrun file — so a copy written to a temp dir
 * makes `xcodebuild test-without-building` fail with "Missing test product".
 * Writing the sibling into the build's Products dir keeps `__TESTROOT__` pointing
 * at the real products. The intermediate JSON goes to a temp dir; only the
 * `.xctestrun` lands beside the products and is removed on teardown. `plutil`
 * ships with macOS, so no extra dependency is added.
 */
export const defaultWdaTestRunPreparer: WdaTestRunPreparer = async ({ xctestrunPath, port }) => {
  const json = await runPlutil(["-convert", "json", "-o", "-", xctestrunPath]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`Could not parse the WebDriverAgent .xctestrun as JSON: ${xctestrunPath}`);
  }
  const injected = injectUsePortIntoXctestrun(parsed, port);
  // Unique per launch: the dynamic port is already unique on this host, and the
  // pid disambiguates concurrent processes sharing the same cache.
  const stem = `${PREPARED_XCTESTRUN_PREFIX}${port}-${process.pid}`;
  const outPath = path.join(path.dirname(xctestrunPath), `${stem}.xctestrun`);
  const jsonPath = path.join(os.tmpdir(), `${stem}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(injected));
  try {
    await runPlutil(["-convert", "xml1", jsonPath, "-o", outPath]);
  } finally {
    fs.rmSync(jsonPath, { force: true });
  }
  return outPath;
};

/**
 * Remove a prepared sibling xctestrun (best effort). Only ever deletes a single
 * file whose name carries our prefix — never a directory, so the WDA build cache
 * it lives in is safe.
 */
function cleanupPreparedTestRun(preparedPath: string | undefined): void {
  if (!preparedPath) {
    return;
  }
  if (!path.basename(preparedPath).startsWith(PREPARED_XCTESTRUN_PREFIX)) {
    return;
  }
  fs.rmSync(preparedPath, { force: true });
}

/** The `xcodebuild test-without-building` args that host WDA against `udid`. */
export function wdaTestRunArgs(xctestrunPath: string, udid: string): string[] {
  return [
    "xcodebuild",
    "test-without-building",
    "-xctestrun",
    xctestrunPath,
    "-destination",
    `id=${udid}`
  ];
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
  /** Spawner for the long-running `xcodebuild test-without-building` WDA host. */
  spawner?: XcrunSpawner;
  /** Builds the per-launch port-injected xctestrun. */
  testRunPreparer?: WdaTestRunPreparer;
  portAllocator?: () => Promise<number>;
  agentConnector?: IosAgentConnector;
  /** Skip WDA build/resolution by supplying the base `.xctestrun` path directly. */
  wdaTestRun?: string;
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
 * Preflight, host WDA via `xcodebuild test-without-building`, launch the target
 * app, and attach, returning a live {@link IosSession}. Actionable errors cover
 * each failure mode: Xcode/simctl missing, no booted simulator (device
 * selection), WDA build failures, agent unreachable (readiness).
 */
export async function launchIosSession(options: LaunchIosOptions): Promise<IosSession> {
  const runner = options.runner ?? execFileXcrunRunner;
  const spawner: XcrunSpawner = options.spawner ?? spawnXcrunProcess;
  const preparer: WdaTestRunPreparer = options.testRunPreparer ?? defaultWdaTestRunPreparer;
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

    const baseTestRun =
      options.wdaTestRun ?? (await resolveWdaTestRun({ runner, logger: options.logger }));

    for (let attempt = 1; attempt <= WDA_STARTUP_ATTEMPTS; attempt += 1) {
      let client: IosAgentClient | undefined;
      let wdaProcess: XcrunProcessHandle | undefined;
      let preparedTestRun: string | undefined;
      let tornDown = false;
      let terminateTarget = false;
      let stage: "prepare" | "wda-launch" | "target-launch" | "connect" = "prepare";
      const teardownAttempt = async (): Promise<void> => {
        if (tornDown) {
          return;
        }
        tornDown = true;
        if (client) {
          await client.close().catch(() => undefined);
        }
        // Killing the xcodebuild test process ends the hosted WDA runner; the
        // best-effort terminate is a belt-and-braces cleanup on the simulator.
        wdaProcess?.kill();
        await terminateApp(runner, udid, WDA_RUNNER_BUNDLE_ID);
        if (terminateTarget) {
          await terminateApp(runner, udid, bundleId);
        }
        cleanupPreparedTestRun(preparedTestRun);
      };

      try {
        const port = await portAllocator();
        preparedTestRun = await preparer({ xctestrunPath: baseTestRun, port });

        stage = "wda-launch";
        wdaProcess = spawner(wdaTestRunArgs(preparedTestRun, udid));

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
