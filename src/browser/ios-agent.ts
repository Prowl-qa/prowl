/**
 * PROWL-059 / ARCH-010 — HTTP/JSON transport for the on-simulator WebDriverAgent.
 *
 * WebDriverAgent (WDA) exposes W3C-WebDriver-shaped endpoints over plain HTTP. On
 * a simulator it is reachable directly at `http://127.0.0.1:<port>` (no tunnel),
 * so this module speaks it with the global `fetch` (no heavy WebDriver SDK, per
 * the `ai.ts` ethos), mirroring the Android agent's ergonomics: a per-request
 * deadline via `AbortController`, unref'd timers, and W3C element-key extraction.
 * It exposes the semantic {@link IosAgentClient} the driver consumes; tests fake
 * either the `fetch` implementation or the client itself.
 */
import type { IosAgentClient, IosQuery } from "./ios-driver.js";
import { iosQueryToLocator } from "./ios-driver.js";

/** The subset of `fetch` this module uses; overridable in tests. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Default per-request deadline for the agent transport. */
export const DEFAULT_WDA_REQUEST_TIMEOUT_MS = 30000;

/** The W3C element-reference key both current and legacy servers may use. */
const W3C_ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf";

export type WdaTransportOptions = {
  /** Base URL, e.g. `http://127.0.0.1:8100`. */
  baseUrl: string;
  requestTimeoutMs?: number;
  fetchImpl?: FetchLike;
};

/** An HTTP-level failure from WDA, carrying the status and parsed body. */
export class WdaHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly webdriverError?: string
  ) {
    super(message);
    this.name = "WdaHttpError";
  }
}

/** Low-level request/response transport with a per-request deadline. */
export class WdaTransport {
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: WdaTransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_WDA_REQUEST_TIMEOUT_MS;
    const injected = options.fetchImpl;
    if (injected) {
      this.fetchImpl = injected;
    } else if (typeof fetch === "function") {
      this.fetchImpl = (url, init) => fetch(url, init);
    } else {
      throw new Error("global fetch is unavailable; Node 20+ is required for the iOS target");
    }
  }

  /**
   * Send one request and return the full parsed JSON body. Rejects with a
   * {@link WdaHttpError} on a non-2xx response, or a timeout error when the
   * per-request deadline elapses.
   */
  async requestFull(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<unknown> {
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
        throw new Error(`WebDriverAgent request ${method} ${path} timed out after ${shown}`);
      }
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    const parsed = parseJson(text);
    if (!response.ok) {
      const wdError = extractWebdriverError(parsed);
      throw new WdaHttpError(
        `WebDriverAgent ${method} ${path} failed (${response.status})${wdError ? `: ${wdError}` : ""}`,
        response.status,
        wdError
      );
    }
    return parsed;
  }

  /** Like {@link requestFull} but returns just the `value` field. */
  async request(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<unknown> {
    const parsed = await this.requestFull(method, path, body, timeoutMs);
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
  if (error instanceof WdaHttpError) {
    return error.status === 404 || (error.webdriverError ?? "").includes("no such element");
  }
  return false;
}

/**
 * Create a WDA session bound to `bundleId` and return its id. WDA activates the
 * app under test named in `alwaysMatch.bundleId`. The session id may arrive at
 * the envelope root or inside `value`, so both are checked.
 */
export async function createWdaSession(transport: WdaTransport, bundleId: string): Promise<string> {
  const body = await transport.requestFull("POST", "/session", {
    capabilities: { alwaysMatch: { bundleId }, firstMatch: [{}] }
  });
  const envelope = (body ?? {}) as Record<string, unknown>;
  const value = (envelope.value ?? {}) as Record<string, unknown>;
  const sessionId =
    (typeof value.sessionId === "string" && value.sessionId) ||
    (typeof envelope.sessionId === "string" && envelope.sessionId) ||
    "";
  if (sessionId.length > 0) {
    return sessionId;
  }
  throw new Error("WebDriverAgent did not return a session id");
}

/** Poll `GET /status` until WDA reports ready or the deadline elapses. */
export async function waitForWdaReady(
  transport: WdaTransport,
  options: { deadlineMs: number; intervalMs?: number } = { deadlineMs: 60000 }
): Promise<void> {
  const interval = options.intervalMs ?? 300;
  const deadline = Date.now() + options.deadlineMs;
  let lastError: unknown;
  for (;;) {
    try {
      const remainingMs = Math.max(1, deadline - Date.now());
      // WDA's /status returns a rich object (no `ready` flag); a 2xx is readiness.
      await transport.request("GET", "/status", undefined, Math.min(remainingMs, 5000));
      return;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() >= deadline) {
      const detail = lastError instanceof Error ? `: ${lastError.message}` : "";
      throw new Error(`WebDriverAgent did not become ready within ${options.deadlineMs}ms${detail}`);
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
 * Build the semantic {@link IosAgentClient} over a live session. `close` deletes
 * the session (best effort); the transport itself is stateless.
 */
export function createWdaAgentClient(transport: WdaTransport, sessionId: string): IosAgentClient {
  const base = `/session/${sessionId}`;

  async function locate(query: IosQuery, path: string): Promise<unknown> {
    return transport.request("POST", `${base}${path}`, iosQueryToLocator(query));
  }

  return {
    async findElement(query: IosQuery): Promise<string | null> {
      try {
        return extractElementId(await locate(query, "/element"));
      } catch (error) {
        if (isNoSuchElement(error)) {
          return null;
        }
        throw error;
      }
    },
    async findElements(query: IosQuery): Promise<string[]> {
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
      // W3C `element/value` takes `{ text }`; WDA types it into the element.
      await transport.request("POST", `${base}/element/${elementId}/value`, { text });
    },
    async getText(elementId: string): Promise<string | null> {
      const value = await transport.request("GET", `${base}/element/${elementId}/text`);
      return typeof value === "string" ? value : value == null ? null : String(value);
    },
    async sendKeys(keys: string[]): Promise<void> {
      // Session-scoped key input to the active element (WDA `/wda/keys`).
      await transport.request("POST", `${base}/wda/keys`, { value: keys });
    },
    async homescreen(): Promise<void> {
      // Session-independent springboard route.
      await transport.request("POST", "/wda/homescreen", {});
    },
    async close(): Promise<void> {
      await transport.request("DELETE", base).catch(() => undefined);
    }
  };
}
