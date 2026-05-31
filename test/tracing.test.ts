import { describe, expect, it } from "vitest";
import { parseTraceId, captureTraceCorrelation, DEFAULT_TRACE_HEADER } from "../src/runner/tracing.js";
import type { TraceCorrelation } from "../src/types/index.js";

// OBS-001 / PROWL-047: correlate hunt failures with the app's distributed-trace id.

describe("parseTraceId", () => {
  it("extracts the 32-hex trace id from a W3C traceparent", () => {
    expect(parseTraceId("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")).toBe(
      "4bf92f3577b34da6a3ce929d0e0e4736"
    );
  });

  it("is case-insensitive on the hex trace id", () => {
    expect(parseTraceId("00-4BF92F3577B34DA6A3CE929D0E0E4736-00f067aa0ba902b7-01")).toBe(
      "4BF92F3577B34DA6A3CE929D0E0E4736"
    );
  });

  it("falls back to the raw trimmed value for a non-standard header", () => {
    expect(parseTraceId("  my-custom-trace-id-123  ")).toBe("my-custom-trace-id-123");
  });

  it("returns undefined for an empty/whitespace value", () => {
    expect(parseTraceId("")).toBeUndefined();
    expect(parseTraceId("   ")).toBeUndefined();
  });

  it("uses the raw value when the middle segment is not a 32-hex id", () => {
    // 3 segments but segment[1] is not a valid trace id -> treat whole thing as the id
    expect(parseTraceId("a-b-c")).toBe("a-b-c");
  });

  it("DEFAULT_TRACE_HEADER is traceparent", () => {
    expect(DEFAULT_TRACE_HEADER).toBe("traceparent");
  });
});

function fakeResponse(url: string, status: number, requestHeaders: Record<string, string>) {
  return {
    url: () => url,
    status: () => status,
    request: () => ({ headers: () => requestHeaders })
  };
}

describe("captureTraceCorrelation", () => {
  it("records a correlation when the request carries the trace header", () => {
    const sink: TraceCorrelation[] = [];
    captureTraceCorrelation(
      fakeResponse("https://app.test/api/checkout", 500, {
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
      }),
      "traceparent",
      sink
    );
    expect(sink).toEqual([
      {
        url: "https://app.test/api/checkout",
        status: 500,
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        header: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
      }
    ]);
  });

  it("matches the header case-insensitively", () => {
    const sink: TraceCorrelation[] = [];
    captureTraceCorrelation(
      fakeResponse("https://app.test/x", 502, {
        traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01"
      }),
      "TraceParent",
      sink
    );
    expect(sink).toHaveLength(1);
    expect(sink[0].traceId).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("supports a custom header name", () => {
    const sink: TraceCorrelation[] = [];
    captureTraceCorrelation(
      fakeResponse("https://app.test/y", 503, { "x-request-id": "req-abc-123" }),
      "x-request-id",
      sink
    );
    expect(sink).toEqual([{ url: "https://app.test/y", status: 503, traceId: "req-abc-123", header: "req-abc-123" }]);
  });

  it("is a no-op when the trace header is absent", () => {
    const sink: TraceCorrelation[] = [];
    captureTraceCorrelation(fakeResponse("https://app.test/z", 500, {}), "traceparent", sink);
    expect(sink).toHaveLength(0);
  });

  it("is a no-op when the header value is empty", () => {
    const sink: TraceCorrelation[] = [];
    captureTraceCorrelation(fakeResponse("https://app.test/z", 500, { traceparent: "" }), "traceparent", sink);
    expect(sink).toHaveLength(0);
  });
});
