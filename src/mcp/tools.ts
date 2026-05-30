import path from "node:path";
import { runHunt } from "../runner/index.js";
import { runSuite } from "../runner/suite.js";
import { updateBacklogFromSuite } from "../backlog/index.js";
import { loadConfig, listHunts } from "../config/loader.js";
import type { RunResult } from "../types/index.js";

/** Arguments accepted by the MCP `run_suite` tool. */
export interface RunSuiteToolArgs {
  includeTags?: string[];
  excludeTags?: string[];
  parallel?: number;
  /** Log failures to the project backlog (default true). */
  logBugs?: boolean;
}

/** JSON payload returned by the MCP `run_suite` tool. */
export interface RunSuiteToolResult {
  status: string;
  totalHunts: number;
  passed: number;
  failed: number;
  skipped: number;
  resultPath: string | null;
  bugs: {
    created: string[];
    regressions: string[];
    alreadyOpen: string[];
    backlogPath: string | null;
  };
}

export interface RunSuiteToolOptions {
  /** Config path for a registered project; omitted uses cwd discovery. */
  configPath?: string;
  /** Authoritative project root for backlog writes; defaults to config parent. */
  projectRoot?: string;
}

/**
 * Hunt names in run order. Targets the project resolved from `configPath` (a
 * registered project's config), or the current working directory when omitted.
 */
export function listHuntsTool(configPath?: string): { hunts: string[] } {
  const { configDir } = loadConfig(configPath);
  return { hunts: listHunts(configDir) };
}

/**
 * Run the full hunt suite and (by default) log any failures as deduplicated bug
 * tickets in the project backlog. Returns pass/fail counts plus the QA-NNN ticket
 * ids the bug-logger created. Targets the project resolved from `configPath`, or
 * the current working directory when omitted.
 */
export async function runSuiteTool(
  args: RunSuiteToolArgs = {},
  options: RunSuiteToolOptions = {}
): Promise<RunSuiteToolResult> {
  const { configPath: resolvedConfigPath, configDir, config } = loadConfig(options.configPath);
  const projectRoot = options.projectRoot ?? path.dirname(configDir);
  const suite = await runSuite({
    configPath: resolvedConfigPath,
    includeTags: args.includeTags,
    excludeTags: args.excludeTags,
    parallel: args.parallel
  });

  // Precedence: a per-call logBugs arg wins, then config.bugLog.enabled, else on by default.
  const bugLogCfg = config.bugLog ?? {};
  const logBugs = args.logBugs ?? bugLogCfg.enabled ?? true;

  // Config paths resolve against the project root (not the server cwd) so MCP
  // multi-project mode writes into the correct repo. When only backlogPath is set,
  // resolvedPath defaults to a sibling resolved.md so the pair stays together.
  const backlogPath = bugLogCfg.backlogPath
    ? path.resolve(projectRoot, bugLogCfg.backlogPath)
    : undefined;
  const resolvedPath = bugLogCfg.resolvedPath
    ? path.resolve(projectRoot, bugLogCfg.resolvedPath)
    : backlogPath
      ? path.join(path.dirname(backlogPath), "resolved.md")
      : undefined;

  const bugs = logBugs
    ? updateBacklogFromSuite(suite, { projectRoot, backlogPath, resolvedPath })
    : { created: [], regressions: [], skipped: [], backlogPath: null };

  const { status, totalHunts, passed, failed, skipped } = suite.result;
  return {
    status,
    totalHunts,
    passed,
    failed,
    skipped,
    resultPath: suite.resultPath,
    bugs: {
      created: bugs.created,
      regressions: bugs.regressions,
      alreadyOpen: bugs.skipped,
      backlogPath: bugs.backlogPath
    }
  };
}

/**
 * Run a single hunt by name and return its full result plus the run directory.
 * Targets the project resolved from `configPath`, or the cwd when omitted.
 */
export async function runHuntTool(
  args: { hunt: string },
  configPath?: string
): Promise<RunResult & { runDir: string }> {
  const { result, runDir } = await runHunt({
    huntName: args.hunt,
    ...(configPath ? { configPath } : {})
  });
  return { ...result, runDir };
}
