import type { BugFailure } from "./fingerprint.js";

/** Heading of the dedicated, agent-owned section in the target project's backlog. */
export const SECTION_HEADING = "## QA Findings (automated)";

export interface RenderTicketOptions {
  id: string;
  failure: BugFailure;
  marker: string;
  /** When set, this failure previously had a resolved ticket — link it as a regression. */
  regressionOf?: string;
  /** YYYY-MM-DD */
  date: string;
}

export function renderTicket(opts: RenderTicketOptions): string {
  const { id, failure, marker, regressionOf, date } = opts;

  const spot = failure.stepType
    ? `${failure.stepType}${failure.selector ? ` (${failure.selector})` : ""}`
    : "run failed before steps executed";

  const lines: string[] = [];
  lines.push(`### ${id}: ${failure.hunt} — ${spot}`);
  lines.push(marker);
  lines.push(`**Logged**: ${date}`);
  if (regressionOf) {
    lines.push(`**Regression of**: ${regressionOf} (previously resolved — see resolved.md)`);
  }
  lines.push(`**Hunt**: ${failure.hunt}`);
  const stepDesc = failure.stepType
    ? `step ${failure.stepIndex ?? "?"} — ${failure.stepType}${failure.selector ? ` ${failure.selector}` : ""}`
    : "n/a (hunt did not produce step results)";
  lines.push(`**Failing step**: ${stepDesc}`);
  lines.push(`**Error**: ${failure.error}`);
  if (failure.runDir) {
    lines.push(`**Artifacts**: ${failure.runDir}`);
  }

  return lines.join("\n");
}

/**
 * Append rendered tickets into the agent-owned section, creating the section at
 * the end of the file if it does not exist. Existing content is preserved.
 */
export function insertTickets(content: string, tickets: string[]): string {
  if (tickets.length === 0) return content;
  const block = tickets.join("\n\n");

  const headingIndex = content.indexOf(SECTION_HEADING);
  if (headingIndex === -1) {
    const base = content.replace(/\n*$/, "");
    const prefix = base ? `${base}\n\n` : "";
    return `${prefix}${SECTION_HEADING}\n\n${block}\n`;
  }

  // Insert at the end of the section: just before the next top-level heading, or EOF.
  const afterHeading = headingIndex + SECTION_HEADING.length;
  const rest = content.slice(afterHeading);
  const nextHeadingRel = rest.search(/\n## /);
  const insertAt = nextHeadingRel === -1 ? content.length : afterHeading + nextHeadingRel;

  const before = content.slice(0, insertAt).replace(/\n*$/, "");
  const after = content.slice(insertAt);
  return `${before}\n\n${block}\n${after}`;
}
