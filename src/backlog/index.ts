import fs from "node:fs";
import path from "node:path";
import type { CiHuntResult, RunResult } from "../types/index.js";
import type { RunSuiteResult } from "../runner/suite.js";
import { type BugFailure, buildMarker, computeFingerprint } from "./fingerprint.js";
import { classifyFingerprint, extractFingerprints, nextTicketId } from "./parse.js";
import { insertTickets, renderTicket } from "./write.js";

export type { BugFailure } from "./fingerprint.js";
export { SECTION_HEADING } from "./write.js";

export interface UpdateBacklogOptions {
  /** Project root containing docs/. Defaults to process.cwd(). */
  projectRoot?: string;
  /** Overrides the backlog path (default: <projectRoot>/docs/backlog.md). */
  backlogPath?: string;
  /** Overrides the resolved path (default: <projectRoot>/docs/resolved.md). */
  resolvedPath?: string;
  /** Date stamp for new tickets (default: today, YYYY-MM-DD). */
  date?: string;
}

export interface BugLogSummary {
  /** QA-NNN ids created for brand-new failures. */
  created: string[];
  /** QA-NNN ids created for failures that recurred after being resolved. */
  regressions: string[];
  /** QA-NNN ids of already-open tickets that were left untouched. */
  skipped: string[];
  backlogPath: string;
}

/** Read optional backlog state, returning empty content only when the file is absent. */
function readFileOrEmpty(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return "";
    throw new Error(`Failed to read "${filePath}": ${err.message}`);
  }
}

/** Convert a failed CI hunt result into the most specific backlog failure available. */
function buildFailure(hunt: CiHuntResult): BugFailure {
  const failure: BugFailure = {
    hunt: hunt.hunt,
    error: hunt.error ?? "Run failed",
    runDir: hunt.runDir
  };

  if (!hunt.runDir) return failure;

  let run: RunResult;
  try {
    const resultJson = readFileOrEmpty(path.join(hunt.runDir, "result.json"));
    if (!resultJson) return failure;
    run = JSON.parse(resultJson) as RunResult;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return failure; // Malformed result.json; keep the message-only failure.
  }
  if (!run || !Array.isArray(run.steps)) return failure;

  const stepIndex = run.steps.findIndex((step) => step.status === "fail");
  if (stepIndex !== -1) {
    const step = run.steps[stepIndex];
    failure.stepIndex = stepIndex;
    failure.stepType = step.type;
    failure.selector = step.selector;
    if (step.error) failure.error = step.error;
    return failure;
  }

  const failedAssertion = run.assertions?.find((assertion) => assertion.status === "fail");
  if (failedAssertion) {
    failure.stepType = `assert:${failedAssertion.type}`;
    if (failedAssertion.error) failure.error = failedAssertion.error;
  }

  return failure;
}

/** Extract one BugFailure per failed hunt from a completed suite run. */
export function extractFailures(suiteResult: RunSuiteResult): BugFailure[] {
  return suiteResult.result.hunts
    .filter((hunt) => hunt.status === "fail")
    .map(buildFailure);
}

/**
 * Logs failures from a completed suite run as deduplicated bug tickets in the
 * target project's backlog. New failures get a fresh QA-NNN ticket; failures that
 * already have an open ticket are skipped; failures matching a resolved ticket are
 * logged as regressions that reference the old id. Idempotent across runs.
 */
export function updateBacklogFromSuite(
  suiteResult: RunSuiteResult,
  options: UpdateBacklogOptions = {}
): BugLogSummary {
  const projectRoot = options.projectRoot ?? process.cwd();
  const backlogPath = options.backlogPath ?? path.join(projectRoot, "docs", "backlog.md");
  const resolvedPath = options.resolvedPath ?? path.join(projectRoot, "docs", "resolved.md");
  const date = options.date ?? new Date().toISOString().slice(0, 10);

  const summary: BugLogSummary = { created: [], regressions: [], skipped: [], backlogPath };

  const failures = extractFailures(suiteResult);
  if (failures.length === 0) return summary;

  const backlogContent = readFileOrEmpty(backlogPath);
  const resolvedContent = readFileOrEmpty(resolvedPath);

  const activeFps = extractFingerprints(backlogContent);
  const resolvedFps = extractFingerprints(resolvedContent);

  let counter = Number(nextTicketId([backlogContent, resolvedContent]).slice(3));
  const makeId = (): string => `QA-${String(counter++).padStart(3, "0")}`;

  const seenThisRun = new Set<string>();
  const ticketsToAdd: string[] = [];

  for (const failure of failures) {
    const fp = computeFingerprint(failure);
    if (seenThisRun.has(fp)) continue;
    seenThisRun.add(fp);

    const classification = classifyFingerprint(fp, activeFps, resolvedFps);
    if (classification.kind === "open") {
      summary.skipped.push(classification.ticketId);
      continue;
    }

    const id = makeId();
    const regressionOf = classification.kind === "regression" ? classification.resolvedId : undefined;
    ticketsToAdd.push(renderTicket({ id, failure, marker: buildMarker(failure, fp), regressionOf, date }));

    if (regressionOf) {
      summary.regressions.push(id);
    } else {
      summary.created.push(id);
    }
  }

  if (ticketsToAdd.length > 0) {
    fs.mkdirSync(path.dirname(backlogPath), { recursive: true });
    fs.writeFileSync(backlogPath, insertTickets(backlogContent, ticketsToAdd));
  }

  return summary;
}
