/**
 * PROWL-059 / ARCH-010 — `xcrun simctl` lifecycle for the iOS simulator target.
 *
 * Thin, injectable wrappers around `xcrun` (both `simctl` for device lifecycle /
 * screenshots and `xcodebuild` for the one-time WebDriverAgent build) plus the
 * pure parsers they depend on. Every command flows through an {@link SimctlRunner}
 * so the whole surface is unit-testable with a fake — `npm test` never needs a
 * booted simulator or Xcode.
 */
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

/** Result of one `xcrun` invocation. */
export type SimctlResult = { stdout: string; stderr: string; code: number };

/** Runs one `xcrun <args>` command to completion and resolves with its output. */
export type SimctlRunner = (
  args: string[],
  options?: { timeoutMs?: number; env?: NodeJS.ProcessEnv }
) => Promise<SimctlResult>;

/** One simulator device from `simctl list devices --json`. */
export type SimDevice = {
  udid: string;
  name: string;
  state: string;
  runtime: string;
  isAvailable: boolean;
};

export type SimulatorReservation = {
  udid: string;
  release(): Promise<void>;
};

export type ReserveSimulatorOptions = {
  /** Override the lock directory root; intended for tests. */
  lockRoot?: string;
};

export const DEFAULT_SIMULATOR_LOCK_ROOT = path.join(os.tmpdir(), "prowl-ios-simulator-locks");

const SIMULATOR_LOCK_OWNER_FILE = "owner.json";

/** Default {@link SimctlRunner}: shells out to the real `xcrun` on PATH. */
export const execFileXcrunRunner: SimctlRunner = (args, options) =>
  new Promise<SimctlResult>((resolve) => {
    execFile(
      "xcrun",
      args,
      {
        encoding: "utf-8",
        timeout: options?.timeoutMs,
        maxBuffer: 32 * 1024 * 1024,
        env: options?.env ? { ...process.env, ...options.env } : process.env
      },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as { code?: unknown }).code === "number"
            ? (error as { code: number }).code
            : error
              ? 1
              : 0;
        const capturedStderr = stderr ?? "";
        resolve({
          stdout: stdout ?? "",
          stderr: capturedStderr.trim() ? capturedStderr : (error?.message ?? ""),
          code
        });
      }
    );
  });

function simulatorLockName(udid: string): string {
  const safe = udid.replace(/[^A-Za-z0-9_.-]/g, "_");
  return `${safe || "simulator"}.lock`;
}

function isErrno(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === code;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isErrno(error, "EPERM");
  }
}

async function removeStaleSimulatorLock(lockPath: string): Promise<boolean> {
  try {
    const ownerText = await readFile(path.join(lockPath, SIMULATOR_LOCK_OWNER_FILE), "utf8");
    const owner = JSON.parse(ownerText) as { pid?: unknown };
    if (
      typeof owner.pid === "number" &&
      Number.isInteger(owner.pid) &&
      owner.pid > 0 &&
      !isProcessAlive(owner.pid)
    ) {
      await rm(lockPath, { recursive: true, force: true });
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function simulatorReservedError(udid: string): Error {
  return new Error(
    `iOS simulator "${udid}" is already reserved by another Prowl process. ` +
      "Wait for that run to finish, or boot/select a different simulator with target.udid."
  );
}

/**
 * Reserve a simulator UDID across processes. The lock is held until `release` is
 * called, preventing one session's teardown from terminating another session's
 * WDA runner or target app on the same simulator.
 */
export async function reserveSimulatorUdid(
  udid: string,
  options: ReserveSimulatorOptions = {}
): Promise<SimulatorReservation> {
  const lockRoot = options.lockRoot ?? DEFAULT_SIMULATOR_LOCK_ROOT;
  const lockPath = path.join(lockRoot, simulatorLockName(udid));
  await mkdir(lockRoot, { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(lockPath);
    } catch (error) {
      if (!isErrno(error, "EEXIST")) {
        throw error instanceof Error ? error : new Error(String(error));
      }
      if (attempt === 0 && (await removeStaleSimulatorLock(lockPath))) {
        continue;
      }
      throw simulatorReservedError(udid);
    }

    let released = false;
    const release = async (): Promise<void> => {
      if (released) {
        return;
      }
      released = true;
      await rm(lockPath, { recursive: true, force: true });
    };

    try {
      await writeFile(
        path.join(lockPath, SIMULATOR_LOCK_OWNER_FILE),
        `${JSON.stringify({ pid: process.pid, udid, createdAt: new Date().toISOString() })}\n`,
        { flag: "wx" }
      );
    } catch (error) {
      await release().catch(() => undefined);
      throw error instanceof Error ? error : new Error(String(error));
    }

    return { udid, release };
  }

  throw simulatorReservedError(udid);
}

/**
 * Allocate a free local TCP port by binding to :0 and releasing it. The returned
 * port is advisory after release; callers that hand it to another process must
 * handle a later bind/readiness failure.
 */
export function findFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const { port } = address;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("Could not allocate a local port")));
      }
    });
  });
}

/**
 * Parse `simctl list devices --json` into a flat device list. The JSON maps
 * runtime identifiers to arrays of devices; the runtime is folded into each row.
 */
export function parseSimctlDevices(json: string): SimDevice[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Could not parse `simctl list devices --json` output.");
  }
  const byRuntime = (parsed as { devices?: Record<string, unknown> } | undefined)?.devices;
  if (!byRuntime || typeof byRuntime !== "object") {
    return [];
  }
  const devices: SimDevice[] = [];
  for (const [runtime, entries] of Object.entries(byRuntime)) {
    if (!Array.isArray(entries)) {
      continue;
    }
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const record = entry as Record<string, unknown>;
      const udid = typeof record.udid === "string" ? record.udid : undefined;
      const name = typeof record.name === "string" ? record.name : undefined;
      const state = typeof record.state === "string" ? record.state : "Unknown";
      if (!udid || !name) {
        continue;
      }
      devices.push({
        udid,
        name,
        state,
        runtime,
        isAvailable: record.isAvailable !== false
      });
    }
  }
  return devices;
}

/** Simulators that are currently booted. */
export function bootedSimulators(devices: SimDevice[]): SimDevice[] {
  return devices.filter((device) => device.state === "Booted");
}

/** Short human label for a simulator (name + short runtime), for error lists. */
function describeSimulator(device: SimDevice): string {
  const runtime = device.runtime.replace(/^com\.apple\.CoreSimulator\.SimRuntime\./, "");
  return `${device.name} [${runtime}] (${device.udid})`;
}

/**
 * Choose which simulator to drive. With `requested` set it must exist and be
 * booted. Otherwise exactly one booted simulator is required; zero or many raise
 * an actionable error listing what was found.
 */
export function selectSimulatorUdid(devices: SimDevice[], requested?: string): string {
  const booted = bootedSimulators(devices);
  if (requested) {
    const match = devices.find((device) => device.udid === requested);
    if (!match) {
      const known = devices.length > 0 ? devices.map((d) => d.udid).join(", ") : "none";
      throw new Error(
        `iOS simulator "${requested}" was not found. Known simulators: ${known}. ` +
          "Check `xcrun simctl list devices`."
      );
    }
    if (match.state !== "Booted") {
      throw new Error(
        `iOS simulator "${requested}" is not booted (state: ${match.state}). ` +
          `Boot it with \`xcrun simctl boot ${requested}\`, then retry.`
      );
    }
    return requested;
  }

  if (booted.length === 0) {
    throw new Error(
      "No booted iOS simulator found. Boot one from Xcode or with " +
        "`xcrun simctl boot <udid>` (see `xcrun simctl list devices available`), then retry."
    );
  }
  if (booted.length > 1) {
    throw new Error(
      `Multiple iOS simulators are booted (${booted.map(describeSimulator).join("; ")}). ` +
        "Set target.udid to pick one."
    );
  }
  return booted[0].udid;
}

/** List all simulators via `simctl list devices --json`. */
export async function listSimulators(runner: SimctlRunner): Promise<SimDevice[]> {
  const result = await runner(["simctl", "list", "devices", "--json"], { timeoutMs: 30000 });
  if (result.code !== 0) {
    throw new Error(
      "`xcrun simctl list devices` failed. Is Xcode installed and are the command-line tools " +
        `selected (\`xcode-select -p\`)? ${(result.stderr.trim() || "").slice(0, 400)}`
    );
  }
  return parseSimctlDevices(result.stdout);
}

/** Install a `.app` bundle onto the simulator. */
export async function installApp(runner: SimctlRunner, udid: string, appPath: string): Promise<void> {
  const result = await runner(["simctl", "install", udid, appPath], { timeoutMs: 120000 });
  if (result.code !== 0) {
    throw new Error(
      `Failed to install "${appPath}" onto simulator ${udid}: ${
        (result.stderr.trim() || result.stdout.trim()).slice(0, 400)
      }`
    );
  }
}

/** Uninstall an app by bundle id (best effort; ignores "not installed"). */
export async function uninstallApp(runner: SimctlRunner, udid: string, bundleId: string): Promise<void> {
  await runner(["simctl", "uninstall", udid, bundleId], { timeoutMs: 60000 }).catch(() => undefined);
}

/**
 * Launch an installed app by bundle id. `childEnv` is forwarded to the launched
 * process via `SIMCTL_CHILD_*` variables (simctl's env-passing convention).
 */
export async function launchApp(
  runner: SimctlRunner,
  udid: string,
  bundleId: string,
  childEnv: Record<string, string> = {}
): Promise<void> {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(childEnv)) {
    env[`SIMCTL_CHILD_${key}`] = value;
  }
  const result = await runner(["simctl", "launch", udid, bundleId], {
    timeoutMs: 60000,
    env: Object.keys(env).length > 0 ? env : undefined
  });
  if (result.code !== 0) {
    throw new Error(
      `Failed to launch "${bundleId}" on simulator ${udid}: ${
        (result.stderr.trim() || result.stdout.trim()).slice(0, 400)
      }. Is it installed?`
    );
  }
}

/** Terminate a running app by bundle id (best effort; ignores "not running"). */
export async function terminateApp(runner: SimctlRunner, udid: string, bundleId: string): Promise<void> {
  await runner(["simctl", "terminate", udid, bundleId], { timeoutMs: 30000 }).catch(() => undefined);
}

/** Capture a PNG screenshot of the simulator directly to `outPath`. */
export async function captureScreenshot(
  runner: SimctlRunner,
  udid: string,
  outPath: string
): Promise<void> {
  const result = await runner(["simctl", "io", udid, "screenshot", outPath], { timeoutMs: 30000 });
  if (result.code !== 0) {
    throw new Error(
      `Failed to capture a simulator screenshot (${udid}): ${
        (result.stderr.trim() || result.stdout.trim()).slice(0, 300)
      }`
    );
  }
}

/** Parse the `x.y[.z]` version out of `xcodebuild -version` output. */
export function parseXcodeVersion(stdout: string): string | null {
  const match = /Xcode\s+([\d.]+)/i.exec(stdout);
  return match?.[1] ?? null;
}

/** Read the installed Xcode version (e.g. `"26.2"`), or null if unavailable. */
export async function xcodeVersion(runner: SimctlRunner): Promise<string | null> {
  const result = await runner(["xcodebuild", "-version"], { timeoutMs: 30000 });
  if (result.code !== 0) {
    return null;
  }
  return parseXcodeVersion(result.stdout);
}
