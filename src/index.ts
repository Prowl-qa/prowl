// Re-export public types
export type {
  Config, Hunt, Step, Assertion,
  StepResult, AssertionResult, RunResult, RunArtifacts,
  BrowserEngine, BrowserChannel, Viewport,
  CiResult, CiHuntResult, CiStatus, CiFlakyHunt, CiFailureCluster,
  ReliabilityConfig,
  IfStep, RepeatStep, MockRouteStep, UnmockRouteStep,
  EvalScriptStep, RunScriptStep, AssertScreenshotStep,
  HistoryEntry, HistoryFile
} from "./types/index.js";

// Re-export runner
export { runHunt } from "./runner/index.js";
export type { RunOptions } from "./runner/index.js";

// Re-export suite runner
export { runSuite } from "./runner/suite.js";
export type { RunSuiteOptions, RunSuiteResult, RunSuiteHooks } from "./runner/suite.js";

// Re-export automated bug-logging
export { updateBacklogFromSuite, extractFailures } from "./backlog/index.js";
export type { UpdateBacklogOptions, BugLogSummary, BugFailure } from "./backlog/index.js";

// Re-export history
export { readHistory, readHuntHistory } from "./runner/history.js";

// Re-export flake detection
export { computeFlakeScore, rankFlaky, DEFAULT_FLAKY_THRESHOLD } from "./runner/flaky.js";
export type { FlakyScore, RankFlakyOptions } from "./runner/flaky.js";

// Re-export self-healing selectors
export { healSelector, buildHealCandidates, extractSelectorIntent } from "./runner/healing.js";
export type { HealResult } from "./runner/healing.js";

// Re-export failure clustering
export { clusterFailures } from "./runner/clustering.js";
export type { FailureCluster } from "./runner/clustering.js";

// Re-export config utilities
export {
  loadConfig, loadHunt, listHunts,
  loadHuntMeta, loadHuntTags
} from "./config/loader.js";

// Re-export schema for validation
export { huntSchema, configSchema, stepSchema } from "./config/schema.js";

// Re-export interpolation
export { interpolateHunt } from "./config/interpolate.js";

// Re-export analyzer
export { analyzePage } from "./analyzer/index.js";
export type { AnalysisResult, PageElement, PageForm, PageLink } from "./analyzer/index.js";

// Re-export generator
export { generateHunt } from "./generator/index.js";
export type { GenerateOptions } from "./generator/index.js";
