import type { Response } from "playwright";
import type { TraceCorrelation } from "../types/index.js";

/** Default response header carrying a distributed-trace id (W3C Trace Context). */
export const DEFAULT_TRACE_HEADER = "traceparent";

/**
 * Extract a trace id from a trace header value.
 *
 * For the W3C `traceparent` format (`version-traceid-spanid-flags`, e.g.
 * `00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`) the 32-hex trace id
 * is returned. For a non-standard header that simply carries an id, the trimmed
 * raw value is used. Returns undefined for an empty value.
 */
export function parseTraceId(headerValue: string): string | undefined {
  const raw = headerValue.trim();
  if (raw.length === 0) return undefined;

  const parts = raw.split("-");
  if (parts.length >= 3 && /^[0-9a-f]{32}$/i.test(parts[1])) {
    return parts[1];
  }

  return raw;
}

function readHeader(headers: Record<string, string>, headerName: string): string | undefined {
  const normalizedName = headerName.toLowerCase();
  return headers[normalizedName];
}

function redactValues(text: string, values: readonly string[]): string {
  let redacted = text;
  for (const value of values) {
    if (value.length === 0) continue;
    redacted = redacted.split(value).join("[REDACTED]");
  }
  return redacted;
}

/**
 * If a failing response carries the configured trace header, record a correlation
 * linking the response URL/status to its trace id. No-op when the header is absent
 * or empty, so passing apps produce no noise.
 */
export function captureTraceCorrelation(
  response: Pick<Response, "url" | "status" | "headers">,
  headerName: string,
  sink: TraceCorrelation[],
  redactionValues: readonly string[] = []
): void {
  const value = readHeader(response.headers(), headerName);
  if (!value) return;

  const traceId = parseTraceId(value);
  if (!traceId) return;

  sink.push({
    url: redactValues(response.url(), redactionValues),
    status: response.status(),
    traceId,
    header: value
  });
}
