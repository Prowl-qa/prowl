import { Command } from "commander";
import chalk from "chalk";
import type { BrowserChannel, Config, Viewport } from "../../types/index.js";
import { launchBrowser, closeBrowser, createPlaywrightDriver } from "../../browser/controller.js";
import { parseBrowserEngine } from "../../browser/engines.js";
import { analyzePage } from "../../analyzer/index.js";
import { analyzeMacApp, type MacAnalysisElement } from "../../analyzer/mac.js";
import { launchMacSession } from "../../browser/mac-helper.js";
import { assertTargetAppAllowed } from "../../config/target.js";
import { findConfigPath, loadConfig, resolveViewport } from "../../config/loader.js";

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

/** Build the `prowl analyze` command for both web URLs and macOS app targets. */
export function buildAnalyzeCommand(): Command {
  const command = new Command("analyze")
    .argument("[url]", "URL to analyze (web target)")
    .description("Analyze a page or macOS app to discover interactive elements and selectors")
    .option("--json", "Output as JSON")
    .option("--app <app>", "macOS app to analyze: bundle id or /path/to/App.app (macOS target)")
    .option("--browser <engine>", "Browser engine: chromium, firefox, or webkit")
    .option("--channel <name>", "Browser channel: chrome, msedge, etc.")
    .option("--viewport <size>", "Viewport size: WxH or preset (mobile, tablet, desktop)")
    .option("--headed", "Show browser window")
    .option("--config <path>", "Custom config path")
    .action(async (url: string | undefined, options) => {
      try {
        if (options.app && url) {
          throw new Error("Pass either a URL argument (web) or --app (macOS), not both.");
        }

        // Explicit --app forces the macOS target. Config is optional (for guardrails/timeout).
        if (options.app) {
          await runMacAnalyze(options.app as string, tryLoadConfig(options.config as string | undefined), options);
          return;
        }

        // A positional URL always means the web target (byte-identical to the original command).
        if (url) {
          await runWebAnalyze(url, options);
          return;
        }

        // No positional and no --app: fall back to the loaded config's target.
        const config = tryLoadConfig(options.config as string | undefined);
        if (config?.target.type === "macos") {
          await runMacAnalyze(config.target.app, config, options);
          return;
        }

        throw new Error(
          "analyze needs a target: pass a URL for the web target, or use --app <bundle-id|.app-path> " +
            "(or set target.type: macos in .prowl/config.yml) for the macOS target."
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
