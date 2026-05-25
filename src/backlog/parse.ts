const MARKER_FP = /<!--\s*prowl:fp=([0-9a-f]+)/;
const TICKET_ID = /\bQA-(\d+)\b/;
const TICKET_ID_GLOBAL = /\bQA-(\d+)\b/g;
const HEADING = /^#{1,6}\s/;

/**
 * Map each embedded fingerprint to the QA-NNN ticket id that owns it, by pairing
 * every `prowl:fp=` marker with the most recent ticket heading above it.
 */
export function extractFingerprints(content: string): Map<string, string> {
  const map = new Map<string, string>();
  let currentId: string | undefined;

  for (const line of content.split("\n")) {
    if (HEADING.test(line)) {
      const idMatch = TICKET_ID.exec(line);
      currentId = idMatch ? `QA-${idMatch[1]}` : undefined;
    }
    const fpMatch = MARKER_FP.exec(line);
    if (fpMatch && currentId) {
      map.set(fpMatch[1], currentId);
    }
  }

  return map;
}

/** The next available QA-NNN id across all provided file contents (max + 1, zero-padded). */
export function nextTicketId(contents: string[]): string {
  let max = 0;
  for (const content of contents) {
    for (const match of content.matchAll(TICKET_ID_GLOBAL)) {
      const n = Number(match[1]);
      if (n > max) max = n;
    }
  }
  return `QA-${String(max + 1).padStart(3, "0")}`;
}

export type Classification =
  | { kind: "new" }
  | { kind: "open"; ticketId: string }
  | { kind: "regression"; resolvedId: string };

/**
 * Decide how to handle a failure fingerprint:
 * - already tracked in the active backlog -> `open` (skip, no duplicate)
 * - previously resolved -> `regression` (link the old id)
 * - otherwise -> `new`
 */
export function classifyFingerprint(
  fp: string,
  activeFps: Map<string, string>,
  resolvedFps: Map<string, string>
): Classification {
  const openId = activeFps.get(fp);
  if (openId) return { kind: "open", ticketId: openId };

  const resolvedId = resolvedFps.get(fp);
  if (resolvedId) return { kind: "regression", resolvedId };

  return { kind: "new" };
}
