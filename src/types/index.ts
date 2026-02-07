export type Config = {
  target: {
    url: string;
  };
  browser: {
    headless: boolean;
    slowMo: number;
    timeout: number;
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
  vars?: Record<string, string>;
  steps: Step[];
  assertions?: Assertion[];
};

export type NavigateStep = { navigate: string };
export type ClickStep = { click: { selector: string } };
export type FillStep = { fill: { selector: string; value: string } };
export type PressStep = { press: { selector: string; key: string } };
export type WaitForSelectorStep = { waitForSelector: { selector: string; timeout?: number } };
export type WaitForUrlStep = { waitForUrl: { value: string; timeout?: number } };
export type WaitForNetworkIdleStep = { waitForNetworkIdle: { timeout?: number } };
export type SelectOptionStep = { selectOption: { selector: string; value: string } };
export type OnDialogStep = { onDialog: { action: "accept" | "dismiss" } };
export type SetInputFilesStep = { setInputFiles: { selector: string; files: string | string[] } };
export type ScreenshotStep = { screenshot: { name?: string } };

export type Step =
  | NavigateStep
  | ClickStep
  | FillStep
  | PressStep
  | SelectOptionStep
  | OnDialogStep
  | SetInputFilesStep
  | WaitForSelectorStep
  | WaitForUrlStep
  | WaitForNetworkIdleStep
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
