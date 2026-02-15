export type BrowserEngine = "chromium" | "firefox" | "webkit";

export type BrowserChannel =
  | "chromium"
  | "chrome" | "chrome-beta" | "chrome-canary" | "chrome-dev"
  | "msedge" | "msedge-beta" | "msedge-canary" | "msedge-dev";

export type Viewport = {
  width: number;
  height: number;
};

export type Config = {
  target: {
    url: string;
  };
  browser: {
    headless: boolean;
    slowMo: number;
    timeout: number;
    engine: BrowserEngine;
    channel?: BrowserChannel;
    viewport: Viewport;
  };
  artifacts: {
    screenshots: "on-failure" | "all";
    networkHar: boolean;
    console: boolean;
  };
  assertions: {
    noConsoleErrors: boolean;
    noNetworkErrors: boolean;
    maxTotalTimeMs: number;
    networkIgnorePatterns: string[];
  };
  guardrails: {
    maxSteps: number;
    allowedDomains: string[];
    forbiddenSelectors: string[];
  };
  auth: {
    storageStatePath: string;
  };
};

export type Hunt = {
  name?: string;
  description?: string;
  tags?: string[];
  vars?: Record<string, string>;
  steps: Step[];
  assertions?: Assertion[];
  retry?: {
    maxRetries: number;
    delay?: number;
  };
};

export type NavigateStep = { navigate: string };
export type ClickStep = { click: { selector: string } | string };
export type FillStep = { fill: { selector: string; value: string } | Record<string, string> };
export type TypeStep = { type: string };
export type PressStep = { press: { selector: string; key: string } };
export type WaitForSelectorStep = { waitForSelector: { selector: string; timeout?: number } };
export type WaitStep = { wait: string | { for: string; timeout?: number } };
export type WaitForUrlStep = { waitForUrl: { value: string; timeout?: number } };
export type WaitForNetworkIdleStep = { waitForNetworkIdle: { timeout?: number } };
export type SelectOptionStep = { selectOption: { selector: string; value: string } };
export type SelectStep = { select: Record<string, string> };
export type OnDialogStep = { onDialog: { action: "accept" | "dismiss" } };
export type SetInputFilesStep = { setInputFiles: { selector: string; files: string | string[] } };
export type InlineAssertStep = {
  assert: {
    visible?: string;
    notVisible?: string;
    urlIncludes?: string;
    urlEquals?: string;
  };
};
export type RunHuntStep = { runHunt: string | { name: string; vars?: Record<string, string> } };
export type HoverStep = { hover: { selector: string } };
export type ScrollStep = { scroll: { direction: "up" | "down" | "left" | "right"; amount?: number } };
export type ScrollToStep = { scrollTo: { selector: string } };
export type ScreenshotStep = { screenshot: { name?: string } };

export type Step =
  | NavigateStep
  | ClickStep
  | FillStep
  | TypeStep
  | PressStep
  | WaitStep
  | SelectOptionStep
  | SelectStep
  | OnDialogStep
  | SetInputFilesStep
  | InlineAssertStep
  | RunHuntStep
  | WaitForSelectorStep
  | WaitForUrlStep
  | WaitForNetworkIdleStep
  | HoverStep
  | ScrollStep
  | ScrollToStep
  | ScreenshotStep;

export type Assertion =
  | { selectorExists: string }
  | { selectorNotExists: string }
  | { urlIncludes: string }
  | { urlEquals: string }
  | { noConsoleErrors: boolean }
  | { noNetworkErrors: boolean };

export type StepResult = {
  type: string;
  status: "pass" | "fail";
  durationMs: number;
  selector?: string;
  value?: string;
  error?: string;
  screenshot?: string;
};

export type AssertionResult = {
  type: string;
  value?: string | boolean;
  status: "pass" | "fail";
  error?: string;
};

export type RunArtifacts = {
  summary?: string;
  screenshots?: string[];
  console?: string;
  trace?: string;
  networkHar?: string;
};

export type RunResult = {
  status: "pass" | "fail";
  exitCode: 0 | 1;
  startedAt: string;
  durationMs: number;
  hunt: string;
  targetUrl: string;
  steps: StepResult[];
  assertions: AssertionResult[];
  artifacts: RunArtifacts;
};

export type CiHuntResult = {
  hunt: string;
  status: "pass" | "fail" | "skipped";
  durationMs: number;
  runDir?: string;
  error?: string;
};

export type CiStatus = "pass" | "fail" | "no-hunts" | "all-skipped";

export type CiResult = {
  status: CiStatus;
  startedAt: string;
  durationMs: number;
  totalHunts: number;
  passed: number;
  failed: number;
  skipped: number;
  hunts: CiHuntResult[];
};
