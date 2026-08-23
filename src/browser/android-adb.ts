/**
 * PROWL-058 / ARCH-009 — adb lifecycle for the Android target.
 *
 * Thin, injectable wrappers around the `adb` CLI plus the pure parsers they
 * depend on. Every command flows through an {@link AdbRunner} (device
 * lifecycle, install, forward) or an {@link AdbSpawner} (the long-running
 * `am instrument` agent process), so the whole surface is unit-testable with a
 * fake — `npm test` never needs a real device or emulator.
 */
import { execFile, spawn } from "node:child_process";

/** Result of one adb invocation. */
export type AdbResult = { stdout: string; stderr: string; code: number };

/** Runs one adb command to completion and resolves with its captured output. */
export type AdbRunner = (args: string[], options?: { timeoutMs?: number }) => Promise<AdbResult>;

/** A handle to a spawned long-running adb process (the instrumentation server). */
export type AdbProcessHandle = { kill(): void };

/** Spawns a long-running adb command (e.g. `am instrument -w`) in the background. */
export type AdbSpawner = (args: string[]) => AdbProcessHandle;

/** One row of `adb devices -l`. */
export type AdbDevice = { serial: string; state: string; description: Record<string, string> };

/** Default {@link AdbRunner}: shells out to the real `adb` on PATH. */
export const execFileAdbRunner: AdbRunner = (args, options) =>
  new Promise<AdbResult>((resolve) => {
    execFile(
      "adb",
      args,
      { encoding: "utf-8", timeout: options?.timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as { code?: unknown }).code === "number"
            ? ((error as { code: number }).code)
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

/** Default {@link AdbSpawner}: spawns a detached-output `adb` child. */
export const spawnAdbProcess: AdbSpawner = (args) => {
  const child = spawn("adb", args, { stdio: "ignore" });
  child.on("error", () => {
    /* surfaced via readiness/preflight, not here */
  });
  return { kill: () => child.kill() };
};

/** Prefix adb args with `-s <serial>` when a serial is set. */
export function withSerial(serial: string | undefined, args: string[]): string[] {
  return serial ? ["-s", serial, ...args] : args;
}

/**
 * Parse `adb devices -l` output into structured rows. The header line
 * (`List of devices attached`) and blank lines are skipped.
 */
export function parseAdbDevices(stdout: string): AdbDevice[] {
  const devices: AdbDevice[] = [];
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^list of devices attached/i.test(line)) {
      continue;
    }
    const [serial, state, ...rest] = line.split(/\s+/);
    if (!serial || !state) {
      continue;
    }
    const description: Record<string, string> = {};
    for (const token of rest) {
      const eq = token.indexOf(":");
      if (eq > 0) {
        description[token.slice(0, eq)] = token.slice(eq + 1);
      }
    }
    devices.push({ serial, state, description });
  }
  return devices;
}

/** Devices that are fully booted and usable (`device` state). */
export function bootedDevices(devices: AdbDevice[]): AdbDevice[] {
  return devices.filter((device) => device.state === "device");
}

/**
 * Choose which device to drive. With `requested` set it must be attached and
 * booted. Otherwise exactly one booted device is required; zero or many raise an
 * actionable error listing what was found.
 */
export function selectDeviceSerial(devices: AdbDevice[], requested?: string): string {
  const booted = bootedDevices(devices);
  if (requested) {
    const match = devices.find((device) => device.serial === requested);
    if (!match) {
      const attached = devices.length > 0 ? devices.map((d) => d.serial).join(", ") : "none";
      throw new Error(
        `Android device "${requested}" is not attached. Attached devices: ${attached}. ` +
          "Check `adb devices -l`."
      );
    }
    if (match.state !== "device") {
      throw new Error(
        `Android device "${requested}" is present but not ready (state: ${match.state}). ` +
          "Boot or authorize it, then retry."
      );
    }
    return requested;
  }

  if (booted.length === 0) {
    throw new Error(
      "No booted Android device found. Start an emulator or connect a device with USB debugging, " +
        "then confirm it appears in `adb devices -l`."
    );
  }
  if (booted.length > 1) {
    throw new Error(
      `Multiple Android devices attached (${booted.map((d) => d.serial).join(", ")}). ` +
        "Set target.deviceSerial to pick one."
    );
  }
  return booted[0].serial;
}

/** List attached devices via `adb devices -l`. */
export async function listDevices(runner: AdbRunner): Promise<AdbDevice[]> {
  const result = await runner(["devices", "-l"], { timeoutMs: 10000 });
  if (result.code !== 0) {
    throw new Error(
      `\`adb devices\` failed (exit ${result.code}). Is adb on PATH and the server running? ` +
        (result.stderr.trim() || "").slice(0, 400)
    );
  }
  return parseAdbDevices(result.stdout);
}

/**
 * Parse the local port `adb forward tcp:0 tcp:<remote>` prints (dynamic port
 * allocation). adb echoes the chosen local port on stdout.
 */
export function parseForwardPort(stdout: string): number {
  const port = Number.parseInt(stdout.trim(), 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Could not parse a forwarded port from adb output: "${stdout.trim()}"`);
  }
  return port;
}

/** Parse the package name out of `aapt dump badging <apk>` output. */
export function parseAaptPackage(stdout: string): string | null {
  const match = /package:\s*name='([^']+)'/.exec(stdout);
  return match?.[1] ?? null;
}

/** Forward a dynamically allocated local port to the device's `remotePort`. */
export async function forwardDynamicPort(
  runner: AdbRunner,
  serial: string,
  remotePort: number
): Promise<number> {
  const result = await runner(withSerial(serial, ["forward", "tcp:0", `tcp:${remotePort}`]), {
    timeoutMs: 10000
  });
  if (result.code !== 0) {
    throw new Error(`adb forward failed (exit ${result.code}): ${result.stderr.trim()}`);
  }
  return parseForwardPort(result.stdout);
}

/** Remove a previously created port forward (best effort). */
export async function removeForward(runner: AdbRunner, serial: string, localPort: number): Promise<void> {
  await runner(withSerial(serial, ["forward", "--remove", `tcp:${localPort}`]), { timeoutMs: 10000 }).catch(
    () => undefined
  );
}

/** Install an APK (`-r` replace, `-g` grant runtime perms, `-t` allow test apks). */
export async function installApk(runner: AdbRunner, serial: string, apkPath: string): Promise<void> {
  const result = await runner(withSerial(serial, ["install", "-r", "-t", "-g", apkPath]), {
    timeoutMs: 120000
  });
  if (result.code !== 0 || /failure/i.test(result.stdout)) {
    throw new Error(
      `Failed to install APK "${apkPath}" (exit ${result.code}): ${
        (result.stderr.trim() || result.stdout.trim()).slice(0, 400)
      }`
    );
  }
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function runnerPhaseError(message: string, error: unknown): Error {
  return new Error(`${message}: ${formatUnknownError(error)}`, { cause: error });
}

/**
 * Parse the launcher component (`pkg/.Activity`) out of
 * `cmd package resolve-activity --brief` output — the last non-empty line.
 * Returns null when nothing resolves (package absent or has no launcher).
 */
export function parseResolvedComponent(stdout: string, pkg: string): string | null {
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    // A component line looks like `com.pkg/.Activity` or `com.pkg/com.pkg.Activity`.
    if (/^[\w.]+\/[\w.$]+$/.test(lines[i]) && lines[i].startsWith(`${pkg}/`)) {
      return lines[i];
    }
  }
  return null;
}

/**
 * Launch a package's default LAUNCHER activity. Resolves the launcher component
 * with `cmd package resolve-activity` and starts it with `am start -n` — a
 * deterministic, TTY-independent path. (The previous `monkey`-based launch was
 * unreliable when adb runs it without a PTY — e.g. execFile in CI — where some
 * emulator images, notably API 35 `google_apis`, emit debug noise and exit
 * non-zero even on success. `am start` has none of that ambiguity.)
 */
export async function launchPackage(runner: AdbRunner, serial: string, pkg: string): Promise<void> {
  let resolved: AdbResult;
  try {
    resolved = await runner(
      withSerial(serial, [
        "shell",
        "cmd",
        "package",
        "resolve-activity",
        "--brief",
        "-c",
        "android.intent.category.LAUNCHER",
        pkg
      ]),
      { timeoutMs: 30000 }
    );
  } catch (error) {
    throw runnerPhaseError(
      `Failed to resolve the launcher activity for Android package "${pkg}" via adb`,
      error
    );
  }
  const component = parseResolvedComponent(resolved.stdout, pkg);
  if (resolved.code !== 0 || !component) {
    throw new Error(
      `Could not resolve a launcher activity for Android package "${pkg}" (exit ${resolved.code})` +
        `${(resolved.stdout + resolved.stderr).trim() ? `: ${(resolved.stdout + resolved.stderr).trim().slice(0, 300)}` : ""}. Is it installed?`
    );
  }
  let start: AdbResult;
  try {
    start = await runner(withSerial(serial, ["shell", "am", "start", "-n", component]), {
      timeoutMs: 30000
    });
  } catch (error) {
    throw runnerPhaseError(
      `Failed to launch Android package "${pkg}" with \`am start\` (${component}) via adb`,
      error
    );
  }
  if (start.code !== 0 || /error|does not exist|cannot start/i.test(start.stdout + start.stderr)) {
    throw new Error(
      `Failed to launch Android package "${pkg}" (${component}, exit ${start.code}): ${
        (start.stdout + start.stderr).trim().slice(0, 400)
      }.`
    );
  }
}

/** Force-stop a package (teardown). */
export async function forceStop(runner: AdbRunner, serial: string, pkg: string): Promise<void> {
  await runner(withSerial(serial, ["shell", "am", "force-stop", pkg]), { timeoutMs: 30000 });
}

/** Clear a package's data for a deterministic cold start (`pm clear`). */
export async function clearPackage(runner: AdbRunner, serial: string, pkg: string): Promise<void> {
  const result = await runner(withSerial(serial, ["shell", "pm", "clear", pkg]), { timeoutMs: 30000 });
  if (result.code !== 0 || !/success/i.test(result.stdout)) {
    throw new Error(
      `Failed to clear Android package "${pkg}" for cold start (exit ${result.code}): ${
        (result.stdout + result.stderr).trim().slice(0, 300)
      }`
    );
  }
}

/**
 * Start the uiautomator2 instrumentation server as a background process. The
 * `am instrument -w` call blocks for the server's lifetime, so it is spawned,
 * not awaited; the returned handle is killed during teardown.
 */
export function startInstrumentation(spawner: AdbSpawner, serial: string): AdbProcessHandle {
  return spawner(
    withSerial(serial, [
      "shell",
      "am",
      "instrument",
      "-w",
      "-e",
      "disableAnalytics",
      "true",
      "io.appium.uiautomator2.server.test/androidx.test.runner.AndroidJUnitRunner"
    ])
  );
}
