import { describe, expect, it } from "vitest";
import {
  createWdaAgentClient,
  createWdaSession,
  extractElementId,
  waitForWdaReady,
  WdaHttpError,
  WdaTransport,
  type FetchLike
} from "../src/browser/ios-agent.js";

const W3C_ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf";

type Call = { url: string; method: string; body: unknown };

function recordingFetch(
  handler: (call: Call) => { status?: number; body?: unknown; envelope?: unknown }
): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const call: Call = { url, method: String(init.method), body };
    calls.push(call);
    const { status = 200, body: responseBody, envelope } = handler(call);
    const payload = envelope !== undefined ? envelope : { value: responseBody };
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (responseBody === undefined && envelope === undefined ? "" : JSON.stringify(payload))
    } as unknown as Response;
  };
  return { fetch, calls };
}

function transportWith(
  handler: (call: Call) => { status?: number; body?: unknown; envelope?: unknown },
  requestTimeoutMs = 1000
) {
  const { fetch, calls } = recordingFetch(handler);
  const transport = new WdaTransport({
    baseUrl: "http://127.0.0.1:8100",
    requestTimeoutMs,
    fetchImpl: fetch
  });
  return { transport, calls };
}

describe("extractElementId", () => {
  it("reads both the W3C key and the legacy ELEMENT key", () => {
    expect(extractElementId({ [W3C_ELEMENT_KEY]: "E1" })).toBe("E1");
    expect(extractElementId({ ELEMENT: "E2" })).toBe("E2");
    expect(extractElementId({})).toBeNull();
    expect(extractElementId(null)).toBeNull();
  });
});

describe("createWdaSession", () => {
  it("posts a bundleId capabilities envelope and returns the session id from value", async () => {
    const { transport, calls } = transportWith(() => ({
      body: { sessionId: "S1", capabilities: {} }
    }));
    expect(await createWdaSession(transport, "com.example.App")).toBe("S1");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe("http://127.0.0.1:8100/session");
    expect(calls[0].body).toMatchObject({
      capabilities: { alwaysMatch: { bundleId: "com.example.App" }, firstMatch: [{}] }
    });
  });

  it("also accepts a session id at the envelope root", async () => {
    const { transport } = transportWith(() => ({ envelope: { sessionId: "ROOT", value: {} } }));
    expect(await createWdaSession(transport, "com.example.App")).toBe("ROOT");
  });

  it("throws when no session id comes back", async () => {
    const { transport } = transportWith(() => ({ body: {} }));
    await expect(createWdaSession(transport, "com.example.App")).rejects.toThrow(
      "did not return a session id"
    );
  });
});

describe("WdaTransport error handling", () => {
  it("wraps a non-2xx response in a WdaHttpError carrying the WebDriver error", async () => {
    const { transport } = transportWith(() => ({
      status: 500,
      body: { error: "unknown error", message: "boom" }
    }));
    await expect(transport.request("GET", "/status")).rejects.toBeInstanceOf(WdaHttpError);
    await expect(transport.request("GET", "/status")).rejects.toThrow("unknown error");
  });

  it("rejects with a timeout when the per-request deadline elapses", async () => {
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const transport = new WdaTransport({
      baseUrl: "http://127.0.0.1:8100",
      requestTimeoutMs: 30,
      fetchImpl
    });
    await expect(transport.request("GET", "/status")).rejects.toThrow(
      "WebDriverAgent request GET /status timed out after 30ms"
    );
  });

  it("keeps the timeout active while reading the response body", async () => {
    const fetchImpl: FetchLike = async (_url, init) =>
      ({
        ok: true,
        status: 200,
        text: () =>
          new Promise<string>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new Error("body aborted")));
          })
      }) as unknown as Response;
    const transport = new WdaTransport({
      baseUrl: "http://127.0.0.1:8100",
      requestTimeoutMs: 30,
      fetchImpl
    });
    await expect(transport.request("GET", "/status")).rejects.toThrow(
      "WebDriverAgent request GET /status timed out after 30ms"
    );
  });
});

describe("createWdaAgentClient", () => {
  it("finds an element via a parsed locator and returns its id", async () => {
    const { transport, calls } = transportWith(() => ({ body: { [W3C_ELEMENT_KEY]: "E1" } }));
    const client = createWdaAgentClient(transport, "S1");
    expect(await client.findElement({ by: "accessibilityId", value: "save" })).toBe("E1");
    expect(calls[0].url).toBe("http://127.0.0.1:8100/session/S1/element");
    expect(calls[0].body).toEqual({ using: "accessibility id", value: "save" });
  });

  it("returns null when the element is not found (404)", async () => {
    const { transport } = transportWith(() => ({ status: 404, body: { error: "no such element" } }));
    const client = createWdaAgentClient(transport, "S1");
    expect(await client.findElement({ by: "accessibilityId", value: "missing" })).toBeNull();
  });

  it("collects element ids from findElements", async () => {
    const { transport } = transportWith(() => ({ body: [{ [W3C_ELEMENT_KEY]: "E1" }, { ELEMENT: "E2" }] }));
    const client = createWdaAgentClient(transport, "S1");
    expect(await client.findElements({ by: "text", value: "row" })).toEqual(["E1", "E2"]);
  });

  it("sets text via element/value using the W3C text shape", async () => {
    const { transport, calls } = transportWith(() => ({ body: null }));
    const client = createWdaAgentClient(transport, "S1");
    await client.setValue("E1", "héllo 👋");
    expect(calls[0].url).toBe("http://127.0.0.1:8100/session/S1/element/E1/value");
    expect(calls[0].body).toEqual({ text: "héllo 👋" });
  });

  it("sends raw keys to the active element via /wda/keys", async () => {
    const { transport, calls } = transportWith(() => ({ body: null }));
    const client = createWdaAgentClient(transport, "S1");
    await client.sendKeys(["\n"]);
    expect(calls[0].url).toBe("http://127.0.0.1:8100/session/S1/wda/keys");
    expect(calls[0].body).toEqual({ value: ["\n"] });
  });

  it("returns to the home screen via /wda/homescreen", async () => {
    const { transport, calls } = transportWith(() => ({ body: null }));
    const client = createWdaAgentClient(transport, "S1");
    await client.homescreen();
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe("http://127.0.0.1:8100/wda/homescreen");
  });

  it("reads the UI hierarchy XML via GET /source", async () => {
    const xml = "<XCUIElementTypeApplication name='Settings'/>";
    const { transport, calls } = transportWith(() => ({ body: xml }));
    const client = createWdaAgentClient(transport, "S1");
    expect(await client.source?.()).toBe(xml);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toBe("http://127.0.0.1:8100/source");
  });

  it("gets element text through the session element endpoint", async () => {
    const { transport, calls } = transportWith(() => ({ body: "Ready" }));
    const client = createWdaAgentClient(transport, "S1");
    expect(await client.getText("E1")).toBe("Ready");
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toBe("http://127.0.0.1:8100/session/S1/element/E1/text");
  });

  it("deletes the WDA session on close", async () => {
    const { transport, calls } = transportWith(() => ({ body: null }));
    const client = createWdaAgentClient(transport, "S1");
    await client.close();
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url).toBe("http://127.0.0.1:8100/session/S1");
  });
});

describe("waitForWdaReady", () => {
  it("resolves once /status returns a 2xx", async () => {
    const { transport } = transportWith(() => ({ body: { state: "success" } }));
    await expect(waitForWdaReady(transport, { deadlineMs: 1000 })).resolves.toBeUndefined();
  });

  it("throws an actionable error when WDA never becomes reachable", async () => {
    const { transport } = transportWith(() => ({ status: 500, body: { error: "not up" } }), 100);
    await expect(waitForWdaReady(transport, { deadlineMs: 40, intervalMs: 10 })).rejects.toThrow(
      "did not become ready within 40ms"
    );
  });

  it("caps each status probe by the remaining readiness deadline", async () => {
    const observedTimeouts: Array<number | undefined> = [];
    const transport = {
      request: async (_method: string, _path: string, _body?: unknown, timeoutMs?: number) => {
        observedTimeouts.push(timeoutMs);
        throw new Error("not up");
      }
    } as unknown as WdaTransport;

    await expect(waitForWdaReady(transport, { deadlineMs: 35, intervalMs: 5 })).rejects.toThrow(
      "did not become ready within 35ms"
    );
    expect(observedTimeouts.length).toBeGreaterThan(0);
    expect(observedTimeouts.every((t) => t !== undefined && t > 0 && t <= 35)).toBe(true);
  });
});
