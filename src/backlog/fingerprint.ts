import { createHash } from "node:crypto";

/**
 * A single failure worth logging as a bug: a specific hunt failing at a specific
 * spot. `stepType`/`selector`/`stepIndex` are absent when the hunt threw before
 * producing step results (e.g. a missing hunt file).
 */
export interface BugFailure {
  hunt: string;
  stepIndex?: number;
  stepType?: string;
  selector?: string;
  error: string;
  runDir?: string;
}

/**
 * Reduce an error message to its stable "class" by removing volatile details
 * (timeout durations, pixel coordinates, hex ids) so the same underlying failure
 * keeps the same fingerprint across runs.
 */
export function normalizeError(error: string): string {
  return error
    .toLowerCase()
    .replace(/0x[0-9a-f]+/g, "") // hex ids
    .replace(/\b\d+(?:\.\d+)?\s*(?:ms|s|px)\b/g, "") // unit-qualified timings/coordinates
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Stable label for the failing spot within a hunt, e.g. `4:click@#submit`.
 * Used in the human-readable marker. Returns `-` when no step is known.
 */
export function stepLabel(failure: BugFailure): string {
  if (failure.stepType === undefined && failure.selector === undefined) {
    return "-";
  }
  const index = failure.stepIndex === undefined ? "?" : String(failure.stepIndex);
  const type = failure.stepType ?? "?";
  const selector = failure.selector ? `@${failure.selector}` : "";
  return `${index}:${type}${selector}`;
}

/** Keep untrusted metadata from changing the hidden HTML-comment shape. */
function sanitizeMarkerValue(value: string): string {
  return value
    .replace(/\r?\n/g, " ")
    .replace(/-->/g, "--&gt;")
    .trim();
}

/**
 * Identifies "the same bug" across runs: the hunt, the failing step's type and
 * selector, and the normalized error class. The step *index* is deliberately
 * excluded so reordering/inserting steps in a hunt does not spawn a duplicate.
 */
export function computeFingerprint(failure: BugFailure): string {
  const parts = [
    failure.hunt,
    failure.stepType ?? "",
    failure.selector ?? "",
    normalizeError(failure.error)
  ];
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 8);
}

/** Hidden HTML-comment marker embedded in each ticket so re-runs can recognize it. */
export function buildMarker(failure: BugFailure, hash: string): string {
  const hunt = sanitizeMarkerValue(failure.hunt);
  const step = sanitizeMarkerValue(stepLabel(failure));
  return `<!-- prowl:fp=${hash} hunt=${hunt} step=${step} -->`;
}
