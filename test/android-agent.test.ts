import { describe, expect, it } from "vitest";
import {
  createUia2AgentClient,
  createUia2Session,
  extractElementId,
  Uia2HttpError,
  Uia2Transport,
  waitForAgentReady,
  type FetchLike
} from "../src/browser/android-agent.js";

const W3C_ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf";

type Call = { url: string; method: string; body: unknown };

function recordingFetch(
  handler: (call: Call) => { status?: number; body?: unknown }
): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const call: Call = { url, method: String(init.method), body };
    calls.push(call);
    const { status = 200, body: responseBody } = handler(call);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (responseBody === undefined ? "" : JSON.stringify({ value: responseBody }))
    } as unknown as Response;
  };
  return { fetch, calls };
}

function transportWith(handler: (call: Call) => { status?: number; body?: unknown }, requestTimeoutMs = 1000) {
  const { fetch, calls } = recordingFetch(handler);
  const transport = new Uia2Transport({
    baseUrl: "http://127.0.0.1:6790/wd/hub",
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

describe("createUia2Session", () => {
  it("posts a W3C capabilities envelope and returns the session id", async () => {
    const { transport, calls } = transportWith(() => ({ body: { sessionId: "S1", capabilities: {} } }));
    expect(await createUia2Session(transport)).toBe("S1");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe("http://127.0.0.1:6790/wd/hub/session");
    expect(calls[0].body).toMatchObject({ capabilities: { alwaysMatch: {} } });
  });

  it("throws when no session id comes back", async () => {
    const { transport } = transportWith(() => ({ body: {} }));
    await expect(createUia2Session(transport)).rejects.toThrow("did not return a session id");
  });
});

describe("Uia2Transport error handling", () => {
  it("wraps a non-2xx response in a Uia2HttpError carrying the WebDriver error", async () => {
    const { transport } = transportWith(() => ({ status: 500, body: { error: "unknown error", message: "boom" } }));
    await expect(transport.request("GET", "/status")).rejects.toBeInstanceOf(Uia2HttpError);
    await expect(transport.request("GET", "/status")).rejects.toThrow("unknown error");
  });

  it("rejects with a timeout when the per-request deadline elapses", async () => {
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const transport = new Uia2Transport({
      baseUrl: "http://127.0.0.1:6790/wd/hub",
      requestTimeoutMs: 30,
      fetchImpl
    });
    await expect(transport.request("GET", "/status")).rejects.toThrow(
      "uiautomator2 request GET /status timed out after 30ms"
    );
  });

  it("uses a per-request timeout override when provided", async () => {
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const transport = new Uia2Transport({
      baseUrl: "http://127.0.0.1:6790/wd/hub",
      requestTimeoutMs: 1000,
      fetchImpl
    });
    await expect(transport.request("GET", "/status", undefined, 25)).rejects.toThrow(
      "uiautomator2 request GET /status timed out after 25ms"
    );
  });
});

describe("createUia2AgentClient", () => {
  it("finds an element and returns its id, sending the server's native locator shape", async () => {
    const { transport, calls } = transportWith(() => ({ body: { [W3C_ELEMENT_KEY]: "E1" } }));
    const client = createUia2AgentClient(transport, "S1", { appPackage: "com.app" });
    expect(await client.findElement({ by: "id", value: "save" })).toBe("E1");
    expect(calls[0].url).toBe("http://127.0.0.1:6790/wd/hub/session/S1/element");
    expect(calls[0].body).toEqual({ strategy: "id", selector: "com.app:id/save", context: "" });
  });

  it("returns null when the element is not found (404)", async () => {
    const { transport } = transportWith(() => ({ status: 404, body: { error: "no such element" } }));
    const client = createUia2AgentClient(transport, "S1");
    expect(await client.findElement({ by: "id", value: "missing" })).toBeNull();
  });

  it("collects element ids from findElements", async () => {
    const { transport } = transportWith(() => ({ body: [{ [W3C_ELEMENT_KEY]: "E1" }, { ELEMENT: "E2" }] }));
    const client = createUia2AgentClient(transport, "S1");
    expect(await client.findElements({ by: "text", value: "row" })).toEqual(["E1", "E2"]);
  });

  it("sends unicode-safe text via element/value", async () => {
    const { transport, calls } = transportWith(() => ({ body: null }));
    const client = createUia2AgentClient(transport, "S1");
    await client.setValue("E1", "héllo 👋");
    expect(calls[0].url).toBe("http://127.0.0.1:6790/wd/hub/session/S1/element/E1/value");
    expect(calls[0].body).toEqual({ text: "héllo 👋" });
  });

  it("gets element text through the session element endpoint", async () => {
    const { transport, calls } = transportWith(() => ({ body: "Ready" }));
    const client = createUia2AgentClient(transport, "S1");
    expect(await client.getText("E1")).toBe("Ready");
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toBe("http://127.0.0.1:6790/wd/hub/session/S1/element/E1/text");
  });

  it("presses a key code through the appium device endpoint", async () => {
    const { transport, calls } = transportWith(() => ({ body: null }));
    const client = createUia2AgentClient(transport, "S1");
    await client.pressKeyCode(66);
    expect(calls[0].url).toBe("http://127.0.0.1:6790/wd/hub/session/S1/appium/device/press_keycode");
    expect(calls[0].body).toEqual({ keycode: 66 });
  });

  it("decodes a base64 screenshot into PNG bytes", async () => {
    const base64 = Buffer.from("PNGDATA").toString("base64");
    const { transport } = transportWith(() => ({ body: base64 }));
    const client = createUia2AgentClient(transport, "S1");
    expect((await client.screenshotPng()).toString()).toBe("PNGDATA");
  });

  it("reads the UI hierarchy XML via GET /source", async () => {
    const xml = "<hierarchy rotation='0'><node class='android.widget.Button'/></hierarchy>";
    const { transport, calls } = transportWith(() => ({ body: xml }));
    const client = createUia2AgentClient(transport, "S1");
    expect(await client.source?.()).toBe(xml);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toBe("http://127.0.0.1:6790/wd/hub/session/S1/source");
  });

  it("rejects non-string UI hierarchy responses", async () => {
    const { transport } = transportWith(() => ({ body: { unexpected: true } }));
    const client = createUia2AgentClient(transport, "S1");

    await expect(client.source?.()).rejects.toThrow(
      "uiautomator2 /source did not return XML text; cannot analyze Android UI hierarchy"
    );
  });

  it("deletes the uiautomator2 session on close", async () => {
    const { transport, calls } = transportWith(() => ({ body: null }));
    const client = createUia2AgentClient(transport, "S1");
    await client.close();
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url).toBe("http://127.0.0.1:6790/wd/hub/session/S1");
  });

  it("reads the screen size from /window/rect, ignoring x/y (PROWL-080)", async () => {
    const { transport, calls } = transportWith(() => ({ body: { x: 0, y: 0, width: 1080, height: 2400 } }));
    const client = createUia2AgentClient(transport, "S1");
    expect(await client.windowSize()).toEqual({ width: 1080, height: 2400 });
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toBe("http://127.0.0.1:6790/wd/hub/session/S1/window/rect");
  });

  it("posts a pointer action sequence to /actions (PROWL-080)", async () => {
    const { transport, calls } = transportWith(() => ({ body: null }));
    const client = createUia2AgentClient(transport, "S1");
    const seq = {
      type: "pointer" as const,
      id: "finger1",
      parameters: { pointerType: "touch" as const },
      actions: [{ type: "pointerUp" as const, button: 0 }]
    };
    await client.performActions(seq);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe("http://127.0.0.1:6790/wd/hub/session/S1/actions");
    expect(calls[0].body).toEqual({ actions: [seq] });
  });
});

describe("waitForAgentReady", () => {
  it("resolves once the agent reports ready", async () => {
    const { transport } = transportWith(() => ({ body: { ready: true } }));
    await expect(waitForAgentReady(transport, { deadlineMs: 1000 })).resolves.toBeUndefined();
  });

  it("throws an actionable error when the agent never becomes reachable", async () => {
    const { transport } = transportWith(() => ({ status: 500, body: { error: "not ready" } }), 100);
    await expect(waitForAgentReady(transport, { deadlineMs: 40, intervalMs: 10 })).rejects.toThrow(
      "did not become ready within 40ms"
    );
  });

  it("caps each status probe by the remaining readiness deadline", async () => {
    const observedTimeouts: Array<number | undefined> = [];
    const transport = {
      request: async (_method: string, _path: string, _body?: unknown, timeoutMs?: number) => {
        observedTimeouts.push(timeoutMs);
        throw new Error("not ready");
      }
    } as unknown as Uia2Transport;

    await expect(waitForAgentReady(transport, { deadlineMs: 35, intervalMs: 5 })).rejects.toThrow(
      "did not become ready within 35ms"
    );
    expect(observedTimeouts.length).toBeGreaterThan(0);
    expect(observedTimeouts.every((timeout) => timeout !== undefined && timeout > 0 && timeout <= 35)).toBe(
      true
    );
  });
});
