import type { Request, Response } from "playwright";
import type { TraceCorrelation } from "../types/index.js";

/** Default request header carrying a distributed-trace id (W3C Trace Context). */
export const DEFAULT_TRACE_HEADER = "traceparent";

/**
 * Extract a trace id from a request header value.
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

/**
 * If the request behind a (failing) response carries the configured trace header,
 * record a correlation linking the request URL/status to its trace id. No-op when
 * the header is absent or empty, so passing apps produce no noise.
 */
export function captureTraceCorrelation(
  response: Pick<Response, "url" | "status" | "request">,
  headerName: string,
  sink: TraceCorrelation[]
): void {
  const request: Pick<Request, "headers"> = response.request();
  const headers = request.headers();
  const value = headers[headerName.toLowerCase()];
  if (!value) return;

  const traceId = parseTraceId(value);
  if (!traceId) return;

  sink.push({
    url: response.url(),
    status: response.status(),
    traceId,
    header: value
  });
}
