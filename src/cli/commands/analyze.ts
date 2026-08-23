import { Command } from "commander";
import chalk from "chalk";
import type { BrowserChannel, Config, Target, Viewport } from "../../types/index.js";
import { launchBrowser, closeBrowser, createPlaywrightDriver } from "../../browser/controller.js";
import { parseBrowserEngine } from "../../browser/engines.js";
import { analyzePage } from "../../analyzer/index.js";
import { analyzeMacApp, type MacAnalysisElement } from "../../analyzer/mac.js";
import { analyzeAndroidApp, type AndroidAnalysisElement } from "../../analyzer/android.js";
import { analyzeIosApp, type IosAnalysisElement } from "../../analyzer/ios.js";
import { launchMacSession } from "../../browser/mac-helper.js";
import { launchAndroidSession } from "../../browser/android-helper.js";
import { launchIosSession } from "../../browser/ios-helper.js";
import {
  assertTargetAppAllowed,
  assertAndroidAppAllowed,
  assertIosAppAllowed
} from "../../config/target.js";
import { findConfigPath, loadConfig, resolveViewport } from "../../config/loader.js";

/** The three native targets `prowl analyze` supports alongside the web target. */
type NativePlatform = "macos" | "android" | "ios";

/** Parse a viewport flag into a named preset or an explicit width/height pair. */
function parseViewportFlag(value: string): string | { width: number; height: number } {
  const match = /^(\d+)x(\d+)$/i.exec(value);
  if (match) {
    return { width: Number(match[1]), height: Number(match[2]) };
  }
  return value;
}

/** Optional config load; returns null only when no default config exists. */
function tryLoadConfig(configPath?: string): Config | null {
  const configLocation = configPath !== undefined
    ? configPath
    : findConfigPath(process.cwd());
  if (configLocation === null) {
    return null;
  }

  try {
    return loadConfig(configLocation).config;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown configuration error";
    throw new Error(`Failed to load config at ${configLocation}: ${message}`);
  }
}

/** Whether an `--app` value looks like an Android `.apk` (decisive for inference). */
function looksLikeApk(app: string): boolean {
  return /\.apk$/i.test(app.trim());
}

/**
 * Decide which native platform a forced `--app` targets. Order: an explicit
 * `--platform` wins; otherwise a loaded config's native `target.type`; otherwise
 * inference from the app value (`.apk` → android, else macOS to preserve the
 * original `--app` = macOS behavior). `.app` paths and bare bundle ids are
 * ambiguous between macOS and iOS, so those default to macOS unless `--platform`
 * or a config says otherwise.
 */
function pickNativePlatform(platformFlag: string | undefined, config: Config | null, app: string): NativePlatform {
  if (platformFlag !== undefined) {
    const normalized = platformFlag.trim().toLowerCase();
    if (normalized === "macos" || normalized === "android" || normalized === "ios") {
      return normalized;
    }
    throw new Error(`Unknown --platform "${platformFlag}". Use one of: macos, android, ios.`);
  }
  const configType = config?.target.type;
  if (configType === "macos" || configType === "android" || configType === "ios") {
    return configType;
  }
  return looksLikeApk(app) ? "android" : "macos";
}

/** Web target: analyze a page's DOM via Playwright. Behavior is unchanged from the original command. */
async function runWebAnalyze(url: string, options: Record<string, unknown>): Promise<void> {
  const engine = parseBrowserEngine(options.browser as string | undefined);
  const channel = options.channel as BrowserChannel | undefined;
  const viewport: Viewport = options.viewport
    ? resolveViewport(parseViewportFlag(options.viewport as string))
    : { width: 1280, height: 720 };

  const session = await launchBrowser({
    headless: !options.headed,
    slowMo: 0,
    timeout: 30000,
    trace: false,
    recordHar: false,
    runDir: process.cwd(),
    engine,
    channel,
    viewport
  });
  const driver = createPlaywrightDriver(session.page);

  try {
    await driver.goto(url, { waitUntil: "networkidle" });
    const result = await analyzePage(driver);

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`\n  ${chalk.bold("Page Analysis:")} ${result.title}`);
      console.log(`  ${chalk.gray("URL:")} ${result.url}\n`);

      if (result.forms.length > 0) {
        console.log(chalk.bold("  Forms:"));
        for (const form of result.forms) {
          const method = form.method ? chalk.cyan(form.method) : "";
          const action = form.action ? chalk.gray(form.action) : "";
          console.log(`    [${form.index}] ${method} ${action} (${form.fieldCount} fields)`);
        }
        console.log();
      }

      if (result.elements.length > 0) {
        console.log(chalk.bold("  Interactive Elements:"));
        for (const el of result.elements) {
          const tag = chalk.cyan(el.tag);
          const type = el.type ? chalk.gray(`[${el.type}]`) : "";
          const bestSelector = el.selectors.testId
            ?? el.selectors.label
            ?? el.selectors.ariaLabel
            ?? el.selectors.css
            ?? el.selectors.name
            ?? "";
          const selectorStr = bestSelector ? chalk.yellow(bestSelector) : chalk.gray("(no selector)");
          const req = el.required ? chalk.red(" *") : "";
          const form = el.formGroup !== undefined ? chalk.gray(` form[${el.formGroup}]`) : "";
          console.log(`    ${tag}${type} ${selectorStr}${req}${form}`);
        }
        console.log();
      }

      if (result.links.length > 0) {
        console.log(chalk.bold("  Links:"));
        for (const link of result.links.slice(0, 20)) {
          const text = link.text || chalk.gray("(no text)");
          console.log(`    ${text} ${chalk.gray("→")} ${chalk.blue(link.href)}`);
        }
        if (result.links.length > 20) {
          console.log(chalk.gray(`    ... and ${result.links.length - 20} more`));
        }
        console.log();
      }

      console.log(chalk.gray(`  ${result.elements.length} elements, ${result.forms.length} forms, ${result.links.length} links\n`));
    }
  } finally {
    await closeBrowser(session);
  }
}

/** Print one macOS analysis element in the human-readable analyze output. */
function printMacElement(el: MacAnalysisElement): void {
  const role = chalk.cyan(el.role);
  const [best] = el.selectors;
  const selectorStr = best ? chalk.yellow(best) : chalk.gray("(no selector)");
  const label = el.title ?? el.description ?? el.value;
  const labelStr = label ? ` ${chalk.gray(`"${label}"`)}` : "";
  const disabled = el.enabled === false ? chalk.gray(" (disabled)") : "";
  console.log(`    ${role} ${selectorStr}${labelStr}${disabled}`);
}

/** macOS target: dump interactive elements, windows, and status-menu items with ranked selectors. */
async function runMacAnalyze(app: string, config: Config | null, options: Record<string, unknown>): Promise<void> {
  const allowedApps = config?.guardrails.allowedApps ?? [];
  assertTargetAppAllowed(allowedApps, app);

  const session = await launchMacSession({ app, timeoutMs: config?.browser.timeout });
  try {
    const result = await analyzeMacApp(session.client, { app: session.bundleId });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`\n  ${chalk.bold("App Analysis:")} ${result.app}\n`);

      if (result.windows.length > 0) {
        console.log(chalk.bold("  Windows:"));
        for (const win of result.windows) {
          const title = win.title ? chalk.gray(`"${win.title}"`) : chalk.gray("(untitled)");
          console.log(`    ${title} ${chalk.yellow(win.selector)}`);
        }
        console.log();
      }

      if (result.elements.length > 0) {
        console.log(chalk.bold("  Interactive Elements:"));
        for (const el of result.elements) {
          printMacElement(el);
        }
        console.log();
      }

      if (result.menuItems.length > 0) {
        console.log(chalk.bold("  Menu Bar:"));
        for (const el of result.menuItems) {
          printMacElement(el);
        }
        console.log();
      }

      console.log(
        chalk.gray(
          `  ${result.elements.length} elements, ${result.windows.length} windows, ${result.menuItems.length} menu items\n`
        )
      );
    }
  } finally {
    await session.client.close();
  }
}

/** Print one Android analysis element in the human-readable analyze output. */
function printAndroidElement(el: AndroidAnalysisElement): void {
  const role = chalk.cyan(el.className);
  const [best] = el.selectors;
  const selectorStr = best ? chalk.yellow(best) : chalk.gray("(no selector)");
  const label = el.contentDesc ?? el.text;
  const labelStr = label ? ` ${chalk.gray(`"${label}"`)}` : "";
  const disabled = el.enabled === false ? chalk.gray(" (disabled)") : "";
  console.log(`    ${role} ${selectorStr}${labelStr}${disabled}`);
}

/** Android target: dump interactive elements with ranked selectors from the UI hierarchy. */
async function runAndroidAnalyze(
  app: string,
  config: Config | null,
  options: Record<string, unknown>,
  deviceSerial?: string
): Promise<void> {
  const allowedApps = config?.guardrails.allowedApps ?? [];
  // Fail fast on a disallowed package id (mirrors the run path's pre-launch
  // guardrail). For `.apk` paths the launcher performs the thorough check after
  // resolving the package name, so we defer to it there.
  if (!looksLikeApk(app)) {
    assertAndroidAppAllowed(allowedApps, app);
  }

  const session = await launchAndroidSession({
    app,
    ...(deviceSerial ? { deviceSerial } : {}),
    timeoutMs: config?.browser.timeout,
    allowedApps
  });
  try {
    const sourceFn = session.client.source;
    if (typeof sourceFn !== "function") {
      throw new Error(
        "The Android agent client does not expose source(); a live uiautomator2 session is required to analyze."
      );
    }
    const result = await analyzeAndroidApp(
      { source: () => sourceFn.call(session.client) },
      { app: session.package }
    );

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`\n  ${chalk.bold("App Analysis:")} ${result.app}\n`);

      if (result.elements.length > 0) {
        console.log(chalk.bold("  Interactive Elements:"));
        for (const el of result.elements) {
          printAndroidElement(el);
        }
        console.log();
      }

      console.log(chalk.gray(`  ${result.elements.length} elements\n`));
    }
  } finally {
    await session.teardown();
  }
}

/** Print one iOS analysis element in the human-readable analyze output. */
function printIosElement(el: IosAnalysisElement): void {
  const role = chalk.cyan(el.type);
  const [best] = el.selectors;
  const selectorStr = best ? chalk.yellow(best) : chalk.gray("(no selector)");
  const label = el.label ?? el.value ?? el.name;
  const labelStr = label ? ` ${chalk.gray(`"${label}"`)}` : "";
  const disabled = el.enabled === false ? chalk.gray(" (disabled)") : "";
  console.log(`    ${role} ${selectorStr}${labelStr}${disabled}`);
}

/** iOS target: dump interactive elements and windows with ranked selectors from the UI hierarchy. */
async function runIosAnalyze(
  app: string,
  config: Config | null,
  options: Record<string, unknown>,
  udid?: string
): Promise<void> {
  const allowedApps = config?.guardrails.allowedApps ?? [];
  // Fail fast on a disallowed bundle id (mirrors the run path's pre-launch
  // guardrail). For `.app` paths the launcher performs the thorough check after
  // reading CFBundleIdentifier, so we defer to it there.
  if (!/\//.test(app) && !/\.app$/i.test(app.trim())) {
    assertIosAppAllowed(allowedApps, app);
  }

  const session = await launchIosSession({
    app,
    ...(udid ? { udid } : {}),
    timeoutMs: config?.browser.timeout,
    allowedApps
  });
  try {
    const sourceFn = session.client.source;
    if (typeof sourceFn !== "function") {
      throw new Error(
        "The iOS agent client does not expose source(); a live WebDriverAgent session is required to analyze."
      );
    }
    const result = await analyzeIosApp(
      { source: () => sourceFn.call(session.client) },
      { app: session.bundleId }
    );

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`\n  ${chalk.bold("App Analysis:")} ${result.app}\n`);

      if (result.windows.length > 0) {
        console.log(chalk.bold("  Windows:"));
        for (const win of result.windows) {
          const title = win.label ?? win.name;
          const titleStr = title ? chalk.gray(`"${title}"`) : chalk.gray("(untitled)");
          console.log(`    ${titleStr} ${chalk.yellow(win.selector)}`);
        }
        console.log();
      }

      if (result.elements.length > 0) {
        console.log(chalk.bold("  Interactive Elements:"));
        for (const el of result.elements) {
          printIosElement(el);
        }
        console.log();
      }

      console.log(chalk.gray(`  ${result.elements.length} elements, ${result.windows.length} windows\n`));
    }
  } finally {
    await session.teardown();
  }
}

/** Route a forced `--app` (or a config native target) to the right native analyzer. */
async function runNativeAnalyze(
  platform: NativePlatform,
  app: string,
  config: Config | null,
  options: Record<string, unknown>,
  device: { deviceSerial?: string; udid?: string }
): Promise<void> {
  if (platform === "android") {
    await runAndroidAnalyze(app, config, options, device.deviceSerial);
    return;
  }
  if (platform === "ios") {
    await runIosAnalyze(app, config, options, device.udid);
    return;
  }
  await runMacAnalyze(app, config, options);
}

/** Build the `prowl analyze` command for web URLs and the macOS/Android/iOS targets. */
export function buildAnalyzeCommand(): Command {
  const command = new Command("analyze")
    .argument("[url]", "URL to analyze (web target)")
    .description("Analyze a page or native app to discover interactive elements and selectors")
    .option("--json", "Output as JSON")
    .option("--app <app>", "Native app to analyze: bundle id / package / .app / .apk (macOS, Android, or iOS)")
    .option("--platform <name>", "Native platform for --app: macos, android, or ios (else inferred)")
    .option("--device <serial>", "Android adb device serial (native Android target)")
    .option("--udid <udid>", "iOS simulator UDID (native iOS target)")
    .option("--browser <engine>", "Browser engine: chromium, firefox, or webkit")
    .option("--channel <name>", "Browser channel: chrome, msedge, etc.")
    .option("--viewport <size>", "Viewport size: WxH or preset (mobile, tablet, desktop)")
    .option("--headed", "Show browser window")
    .option("--config <path>", "Custom config path")
    .action(async (url: string | undefined, options) => {
      try {
        if (options.app && url) {
          throw new Error("Pass either a URL argument (web) or --app (native), not both.");
        }

        // Explicit --app forces a native target. Config is optional (guardrails/timeout/platform).
        if (options.app) {
          const config = tryLoadConfig(options.config as string | undefined);
          const platform = pickNativePlatform(options.platform as string | undefined, config, options.app as string);
          await runNativeAnalyze(platform, options.app as string, config, options, {
            deviceSerial: options.device as string | undefined,
            udid: options.udid as string | undefined
          });
          return;
        }

        // A positional URL always means the web target (byte-identical to the original command).
        if (url) {
          await runWebAnalyze(url, options);
          return;
        }

        // No positional and no --app: fall back to the loaded config's target.
        const config = tryLoadConfig(options.config as string | undefined);
        const target: Target | undefined = config?.target;
        if (target?.type === "macos") {
          await runMacAnalyze(target.app, config, options);
          return;
        }
        if (target?.type === "android") {
          await runAndroidAnalyze(target.app, config, options, (options.device as string | undefined) ?? target.deviceSerial);
          return;
        }
        if (target?.type === "ios") {
          await runIosAnalyze(target.app, config, options, (options.udid as string | undefined) ?? target.udid);
          return;
        }

        throw new Error(
          "analyze needs a target: pass a URL for the web target, or use --app " +
            "<bundle-id|package|.app|.apk> (optionally with --platform), or set a native target.type " +
            "in .prowl/config.yml."
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Analysis failed";
        if (options.json) {
          console.log(JSON.stringify({ error: message }));
        } else {
          console.error(`\n  Error: ${message}\n`);
        }
        process.exitCode = 1;
      }
    });

  return command;
}
