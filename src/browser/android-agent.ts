/**
 * PROWL-058 / ARCH-009 — HTTP/JSON transport for the on-device uiautomator2 agent.
 *
 * `appium-uiautomator2-server` exposes W3C-WebDriver-shaped endpoints over plain
 * HTTP. This module speaks them with the global `fetch` (no heavy WebDriver SDK,
 * per the `ai.ts` ethos), mirroring the mac-helper client's ergonomics: a
 * per-request deadline via `AbortController`, and cleanup on
 * every path. It exposes the semantic {@link AndroidAgentClient} the driver
 * consumes; tests fake either the `fetch` implementation or the client itself.
 */
import type { AndroidAgentClient, AndroidQuery } from "./android-driver.js";
import { androidQueryToLocator } from "./android-driver.js";

/** The subset of `fetch` this module uses; overridable in tests. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Default per-request deadline for the agent transport. */
export const DEFAULT_AGENT_REQUEST_TIMEOUT_MS = 30000;

/** The W3C element-reference key both current and legacy servers may use. */
const W3C_ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf";

export type Uia2TransportOptions = {
  /** Base URL including the `/wd/hub` prefix, e.g. `http://127.0.0.1:6790/wd/hub`. */
  baseUrl: string;
  requestTimeoutMs?: number;
  fetchImpl?: FetchLike;
};

/** An HTTP-level failure from the agent, carrying the status and parsed body. */
export class Uia2HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly webdriverError?: string
  ) {
    super(message);
    this.name = "Uia2HttpError";
  }
}

/** Low-level request/response transport with a per-request deadline. */
export class Uia2Transport {
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: Uia2TransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_AGENT_REQUEST_TIMEOUT_MS;
    const injected = options.fetchImpl;
    if (injected) {
      this.fetchImpl = injected;
    } else if (typeof fetch === "function") {
      this.fetchImpl = (url, init) => fetch(url, init);
    } else {
      throw new Error("global fetch is unavailable; Node 20+ is required for the Android target");
    }
  }

  /**
   * Send one request and return the parsed `value` field. Rejects with a
   * {@link Uia2HttpError} on a non-2xx response, or a timeout error when the
   * per-request deadline elapses.
   */
  async request(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<unknown> {
    const requestTimeoutMs = timeoutMs ?? this.requestTimeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    timer.unref?.();
    const url = `${this.baseUrl}${path}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        signal: controller.signal,
        headers: body !== undefined ? { "content-type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
    } catch (error) {
      if (controller.signal.aborted) {
        const shown =
          requestTimeoutMs >= 1000
            ? `${Math.round(requestTimeoutMs / 1000)}s`
            : `${requestTimeoutMs}ms`;
        throw new Error(`uiautomator2 request ${method} ${path} timed out after ${shown}`);
      }
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    const parsed = parseJson(text);
    if (!response.ok) {
      const wdError = extractWebdriverError(parsed);
      throw new Uia2HttpError(
        `uiautomator2 ${method} ${path} failed (${response.status})${wdError ? `: ${wdError}` : ""}`,
        response.status,
        wdError
      );
    }
    return (parsed as { value?: unknown } | undefined)?.value;
  }
}

function parseJson(text: string): unknown {
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function extractWebdriverError(parsed: unknown): string | undefined {
  const value = (parsed as { value?: unknown } | undefined)?.value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const error = typeof record.error === "string" ? record.error : undefined;
    const message = typeof record.message === "string" ? record.message : undefined;
    return error ?? message;
  }
  return undefined;
}

/** Extract an element id from a W3C element-reference object, or null. */
export function extractElementId(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = record[W3C_ELEMENT_KEY] ?? record.ELEMENT;
  return typeof id === "string" ? id : null;
}

function isNoSuchElement(error: unknown): boolean {
  if (error instanceof Uia2HttpError) {
    return error.status === 404 || (error.webdriverError ?? "").includes("no such element");
  }
  return false;
}

/**
 * Create a uiautomator2 session and return its id. Uses the W3C `capabilities`
 * envelope; the server ignores the empty match set and starts a default session.
 */
export async function createUia2Session(transport: Uia2Transport): Promise<string> {
  const value = await transport.request("POST", "/session", {
    capabilities: { alwaysMatch: {}, firstMatch: [{}] }
  });
  const record = (value ?? {}) as Record<string, unknown>;
  const sessionId = record.sessionId;
  if (typeof sessionId === "string" && sessionId.length > 0) {
    return sessionId;
  }
  throw new Error("uiautomator2 did not return a session id");
}

/** Poll `GET /status` until the agent reports ready or the deadline elapses. */
export async function waitForAgentReady(
  transport: Uia2Transport,
  options: { deadlineMs: number; intervalMs?: number } = { deadlineMs: 30000 }
): Promise<void> {
  const interval = options.intervalMs ?? 300;
  const deadline = Date.now() + options.deadlineMs;
  let lastError: unknown;
  for (;;) {
    try {
      const remainingMs = Math.max(1, deadline - Date.now());
      const value = await transport.request("GET", "/status", undefined, Math.min(remainingMs, 5000));
      const ready = (value as { ready?: unknown } | undefined)?.ready;
      if (ready === undefined || ready === true) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    if (Date.now() >= deadline) {
      const detail = lastError instanceof Error ? `: ${lastError.message}` : "";
      throw new Error(`uiautomator2 agent did not become ready within ${options.deadlineMs}ms${detail}`);
    }
    await sleep(Math.min(interval, Math.max(0, deadline - Date.now())));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/**
 * Build the semantic {@link AndroidAgentClient} over a live session. `close`
 * deletes the session (best effort); the transport itself is stateless.
 */
export function createUia2AgentClient(transport: Uia2Transport, sessionId: string): AndroidAgentClient {
  const base = `/session/${sessionId}`;

  async function locate(query: AndroidQuery, path: string): Promise<unknown> {
    return transport.request("POST", `${base}${path}`, androidQueryToLocator(query));
  }

  return {
    async findElement(query: AndroidQuery): Promise<string | null> {
      try {
        return extractElementId(await locate(query, "/element"));
      } catch (error) {
        if (isNoSuchElement(error)) {
          return null;
        }
        throw error;
      }
    },
    async findElements(query: AndroidQuery): Promise<string[]> {
      const value = await locate(query, "/elements");
      if (!Array.isArray(value)) {
        return [];
      }
      return value.map((entry) => extractElementId(entry)).filter((id): id is string => id !== null);
    },
    async click(elementId: string): Promise<void> {
      await transport.request("POST", `${base}/element/${elementId}/click`, {});
    },
    async setValue(elementId: string, text: string): Promise<void> {
      // W3C `element/value` takes `{ text }`; uiautomator2 sets it unicode-safely.
      await transport.request("POST", `${base}/element/${elementId}/value`, { text });
    },
    async getText(elementId: string): Promise<string | null> {
      const value = await transport.request("GET", `${base}/element/${elementId}/text`);
      return typeof value === "string" ? value : value == null ? null : String(value);
    },
    async pressKeyCode(keyCode: number): Promise<void> {
      await transport.request("POST", `${base}/appium/device/press_keycode`, { keycode: keyCode });
    },
    async screenshotPng(): Promise<Buffer> {
      const value = await transport.request("GET", `${base}/screenshot`);
      if (typeof value !== "string") {
        throw new Error("uiautomator2 screenshot did not return base64 data");
      }
      return Buffer.from(value, "base64");
    },
    async close(): Promise<void> {
      await transport.request("DELETE", base).catch(() => undefined);
    }
  };
}
