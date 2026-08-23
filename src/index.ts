// Re-export public types
export type {
  Config, Hunt, Step, Assertion,
  Target, WebTarget, MacosTarget, AndroidTarget, IosTarget,
  StepResult, AssertionResult, RunResult, RunArtifacts,
  BrowserEngine, BrowserChannel, Viewport,
  CiResult, CiHuntResult, CiStatus, CiFlakyHunt, CiFailureCluster,
  ReliabilityConfig,
  IfStep, RepeatStep, MockRouteStep, UnmockRouteStep,
  EvalScriptStep, RunScriptStep, AssertScreenshotStep,
  HistoryEntry, HistoryFile
} from "./types/index.js";

// Re-export the experimental macOS target (PROWL-048)
export { createMacDriver, parseMacSelector } from "./browser/mac-driver.js";
export type { MacHelperClient, MacQuery, MacDriverOptions } from "./browser/mac-driver.js";
export {
  launchMacSession, closeMacSession, resolveHelperBinary,
  macdriverBuildInstructions, SpawnMacHelperClient, DEFAULT_REQUEST_TIMEOUT_MS
} from "./browser/mac-helper.js";
export type { MacSession, LaunchMacOptions, SpawnMacHelperOptions } from "./browser/mac-helper.js";

// Re-export the experimental Android target (PROWL-058)
export {
  createAndroidDriver, parseAndroidSelector, androidQueryToLocator,
  unwrapAndroidTextSelector, escapeUiSelectorArg, ANDROID_KEYCODES
} from "./browser/android-driver.js";
export type { AndroidAgentClient, AndroidQuery, AndroidLocator, AndroidDriverOptions } from "./browser/android-driver.js";
export {
  launchAndroidSession, closeAndroidSession, resolveAgentApks,
  defaultAgentConnector, UIA2_REMOTE_PORT
} from "./browser/android-helper.js";
export type { AndroidSession, LaunchAndroidOptions, AgentApks, AgentConnector } from "./browser/android-helper.js";
export {
  Uia2Transport, createUia2AgentClient, createUia2Session,
  waitForAgentReady, extractElementId, Uia2HttpError, DEFAULT_AGENT_REQUEST_TIMEOUT_MS
} from "./browser/android-agent.js";
export type { FetchLike, Uia2TransportOptions } from "./browser/android-agent.js";
export {
  parseAdbDevices, selectDeviceSerial, parseForwardPort, parseAaptPackage,
  bootedDevices, listDevices
} from "./browser/android-adb.js";
export type { AdbDevice, AdbRunner, AdbResult, AdbSpawner } from "./browser/android-adb.js";

// Re-export the experimental iOS simulator target (PROWL-059)
export {
  createIosDriver, parseIosSelector, iosQueryToLocator,
  unwrapIosTextSelector, escapePredicateArg, normalizeXcuiClassName, IOS_PRESS_KEYS
} from "./browser/ios-driver.js";
export type { IosAgentClient, IosQuery, IosLocator, IosDriverOptions } from "./browser/ios-driver.js";
export {
  launchIosSession, closeIosSession, resolveWdaRunner, resolveWdaProject,
  defaultIosAgentConnector, wdaCacheDir, WDA_RUNNER_BUNDLE_ID, WDA_RUNNER_APP_NAME
} from "./browser/ios-helper.js";
export type { IosSession, LaunchIosOptions, IosAgentConnector, ResolveWdaRunnerOptions } from "./browser/ios-helper.js";
export {
  WdaTransport, createWdaAgentClient, createWdaSession,
  waitForWdaReady, WdaHttpError, DEFAULT_WDA_REQUEST_TIMEOUT_MS
} from "./browser/ios-agent.js";
export type { WdaTransportOptions } from "./browser/ios-agent.js";
export {
  parseSimctlDevices, selectSimulatorUdid, bootedSimulators,
  listSimulators, findFreePort, parseXcodeVersion,
  reserveSimulatorUdid, DEFAULT_SIMULATOR_LOCK_ROOT
} from "./browser/ios-simctl.js";
export type {
  SimDevice, SimctlRunner, SimctlResult, SimulatorReservation, ReserveSimulatorOptions
} from "./browser/ios-simctl.js";

export {
  assertStepsSupportedByTarget, assertTargetAppAllowed, assertAndroidAppAllowed,
  androidAppAllowedIdentities, assertIosAppAllowed, iosAppAllowedIdentities,
  readIosBundleIdentifier, webOnlyReason, WEB_ONLY_STEP_TYPES
} from "./config/target.js";

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

// Re-export the macOS analyzer (PROWL-055)
export {
  analyzeMacApp, rankMacSelectors, INTERACTIVE_ROLES, DEFAULT_ANALYZE_TREE_DEPTH
} from "./analyzer/mac.js";
export type {
  MacAnalysisResult, MacAnalysisElement, MacAnalysisWindow,
  MacAxNode, AnalyzeMacOptions
} from "./analyzer/mac.js";

// Re-export the shared native UI-hierarchy XML parser (PROWL-061)
export { parseXml, decodeXmlEntities } from "./analyzer/xml.js";
export type { XmlElement } from "./analyzer/xml.js";

// Re-export the Android analyzer (PROWL-061)
export {
  analyzeAndroidApp, rankAndroidSelectors, parseAndroidHierarchy,
  isAndroidInteractive, ANDROID_INTERACTIVE_CLASSES
} from "./analyzer/android.js";
export type {
  AndroidAnalysisResult, AndroidAnalysisElement, AndroidUiNode,
  AndroidUiSource, AnalyzeAndroidOptions
} from "./analyzer/android.js";

// Re-export the iOS analyzer (PROWL-061)
export {
  analyzeIosApp, rankIosSelectors, parseIosHierarchy,
  isIosInteractive, shortIosType, IOS_INTERACTIVE_TYPES, IOS_WINDOW_TYPE
} from "./analyzer/ios.js";
export type {
  IosAnalysisResult, IosAnalysisElement, IosAnalysisWindow,
  IosUiNode, IosUiSource, AnalyzeIosOptions
} from "./analyzer/ios.js";

// Re-export generator
export { generateHunt } from "./generator/index.js";
export type { GenerateOptions } from "./generator/index.js";
