/**
 * PROWL-048 / ARCH-002 — transport + launch/teardown for the macOS target.
 *
 * Spawns the `prowl-macdriver` Swift helper in `serve` mode and speaks its
 * newline-delimited JSON protocol (one request/response per line, matched by
 * id). The helper is built locally (`swift build` in `macdriver/`) and is NOT
 * bundled in the npm package, so binary resolution fails with a clear "build
 * the helper" message rather than crashing.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMacDriver, type MacHelperClient } from "./mac-driver.js";
import type { SessionDriver } from "./driver.js";

export const HELPER_BINARY = "prowl-macdriver";

export function macdriverBuildInstructions(): string {
  return (
    "The macOS target requires the experimental `prowl-macdriver` helper, which is " +
    "not shipped in the npm package. Build it locally:\n" +
    "  cd macdriver && swift build -c release\n" +
    "or point Prowl at a prebuilt binary via the PROWL_MACDRIVER_BIN environment variable."
  );
}

function getPackageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.parse(dir).root;
  while (dir !== root) {
    if (fs.existsSync(path.join(dir, "package.json"))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return root;
}

/**
 * Resolve the helper binary path. Order: `PROWL_MACDRIVER_BIN`, then the
 * release then debug build under `macdriver/.build/`. Throws with build
 * instructions when none is found.
 */
export function resolveHelperBinary(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.PROWL_MACDRIVER_BIN;
  if (override) {
    if (!fs.existsSync(override)) {
      throw new Error(
        `PROWL_MACDRIVER_BIN points at a missing file: ${override}\n${macdriverBuildInstructions()}`
      );
    }
    return override;
  }

  const root = getPackageRoot();
  const candidates = [
    path.join(root, "macdriver", ".build", "release", HELPER_BINARY),
    path.join(root, "macdriver", ".build", "debug", HELPER_BINARY)
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Could not find the ${HELPER_BINARY} helper binary.\n${macdriverBuildInstructions()}`);
}

type Pending = {
  cmd: string;
  resolve: (result: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** Default per-request deadline for the helper transport. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

export type SpawnMacHelperOptions = {
  /** Per-request deadline; a request that gets no response by then rejects. */
  requestTimeoutMs?: number;
};

/** A {@link MacHelperClient} backed by a spawned `prowl-macdriver serve` process. */
export class SpawnMacHelperClient implements MacHelperClient {
  private readonly child: ChildProcess;
  private readonly pending = new Map<number, Pending>();
  private readonly requestTimeoutMs: number;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private nextId = 1;
  private closed = false;

  constructor(binaryPath: string, options: SpawnMacHelperOptions = {}) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.child = spawn(binaryPath, ["serve"], { stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout?.setEncoding("utf-8");
    this.child.stderr?.setEncoding("utf-8");
    this.child.stdout?.on("data", (chunk: string) => this.onStdout(chunk));
    this.child.stderr?.on("data", (chunk: string) => {
      this.stderrBuffer = (this.stderrBuffer + chunk).slice(-4000);
    });
    this.child.on("error", (error) => this.failAll(error));
    this.child.on("exit", (code) => {
      if (!this.closed) {
        const detail = this.stderrBuffer.trim();
        this.failAll(
          new Error(`prowl-macdriver exited unexpectedly (code ${code ?? "null"})${detail ? `: ${detail}` : ""}`)
        );
      }
    });
  }

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newlineIndex = this.stdoutBuffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        this.dispatch(line);
      }
      newlineIndex = this.stdoutBuffer.indexOf("\n");
    }
  }

  private dispatch(line: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return; // ignore non-JSON noise
    }
    const id = typeof message.id === "number" ? message.id : undefined;
    if (id === undefined) {
      return;
    }
    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (message.ok === true) {
      pending.resolve((message.result as Record<string, unknown>) ?? {});
    } else {
      pending.reject(new Error(typeof message.error === "string" ? message.error : "prowl-macdriver error"));
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  /** Number of in-flight requests awaiting a response (for teardown/tests). */
  get pendingCount(): number {
    return this.pending.size;
  }

  request(cmd: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (this.closed) {
      return Promise.reject(new Error("prowl-macdriver client is closed"));
    }
    const id = this.nextId++;
    const payload = JSON.stringify({ id, cmd, ...params });
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          const shown =
            this.requestTimeoutMs >= 1000
              ? `${Math.round(this.requestTimeoutMs / 1000)}s`
              : `${this.requestTimeoutMs}ms`;
          reject(new Error(`prowl-macdriver request "${cmd}" timed out after ${shown}`));
        }
      }, this.requestTimeoutMs);
      // Don't let a pending deadline keep the event loop alive on its own.
      timer.unref?.();
      this.pending.set(id, { cmd, resolve, reject, timer });
      this.child.stdin?.write(payload + "\n", (error) => {
        if (error && this.pending.delete(id)) {
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    try {
      this.child.stdin?.write(JSON.stringify({ cmd: "shutdown" }) + "\n");
      this.child.stdin?.end();
    } catch {
      // best effort
    }
    await new Promise<void>((resolve) => {
      if (this.child.exitCode !== null || this.child.signalCode !== null) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        this.child.kill("SIGKILL");
        resolve();
      }, 2000);
      this.child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.failAll(new Error("prowl-macdriver client is closed"));
  }
}

export type MacSession = {
  client: MacHelperClient;
  driver: SessionDriver;
  bundleId: string;
};

export type LaunchMacOptions = {
  /** Bundle id or absolute `.app` path. */
  app: string;
  timeoutMs?: number;
  /** Inject a helper client (tests / a prebuilt binary); defaults to spawning the helper. */
  clientFactory?: () => MacHelperClient;
};

/** Launch/attach the target app through the helper and build a {@link MacDriver}. */
export async function launchMacSession(options: LaunchMacOptions): Promise<MacSession> {
  // Give the transport headroom over the app-level timeout so a legitimately
  // slow verb (launch, waitFor) isn't killed early by the request deadline.
  const requestTimeoutMs = Math.max(options.timeoutMs ?? 10000, DEFAULT_REQUEST_TIMEOUT_MS) + 5000;
  const client = options.clientFactory
    ? options.clientFactory()
    : new SpawnMacHelperClient(resolveHelperBinary(), { requestTimeoutMs });
  const timeoutSeconds = (options.timeoutMs ?? 10000) / 1000;

  try {
    const trust = await client.request("check");
    if (trust.trusted !== true) {
      throw new Error(
        "Prowl's macOS target is not trusted for Accessibility. Grant the hosting terminal/app " +
          "permission in System Settings → Privacy & Security → Accessibility, then retry."
      );
    }
    const launched = await client.request("launch", { app: options.app, timeout: timeoutSeconds });
    const bundleId = String(launched.bundleId ?? options.app);
    const driver = createMacDriver(client, { appLabel: bundleId });
    return { client, driver, bundleId };
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
}

/** Quit the target app (best effort) and shut the helper down. */
export async function closeMacSession(session: MacSession): Promise<void> {
  try {
    await session.client.request("quit");
  } catch {
    // best effort — the app may already be gone
  } finally {
    await session.client.close();
  }
}
