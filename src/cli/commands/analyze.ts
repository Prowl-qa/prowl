import { Command } from "commander";
import chalk from "chalk";
import { chromium, firefox, webkit } from "playwright";
import type { BrowserEngine, BrowserChannel, Viewport } from "../../types/index.js";
import { analyzePage } from "../../analyzer/index.js";
import { resolveViewport } from "../../config/loader.js";

const ENGINES = { chromium, firefox, webkit } as const;

function parseViewportFlag(value: string): string | { width: number; height: number } {
  const match = /^(\d+)x(\d+)$/i.exec(value);
  if (match) {
    return { width: Number(match[1]), height: Number(match[2]) };
  }
  return value;
}

export function buildAnalyzeCommand(): Command {
  const command = new Command("analyze")
    .argument("<url>", "URL to analyze")
    .description("Analyze a page to discover interactive elements and selectors")
    .option("--json", "Output as JSON")
    .option("--browser <engine>", "Browser engine: chromium, firefox, or webkit")
    .option("--channel <name>", "Browser channel: chrome, msedge, etc.")
    .option("--viewport <size>", "Viewport size: WxH or preset (mobile, tablet, desktop)")
    .option("--headed", "Show browser window")
    .option("--config <path>", "Custom config path")
    .action(async (url: string, options) => {
      try {
        const engine = (options.browser as BrowserEngine) ?? "chromium";
        const channel = options.channel as BrowserChannel | undefined;
        const viewport: Viewport = options.viewport
          ? resolveViewport(parseViewportFlag(options.viewport as string))
          : { width: 1280, height: 720 };

        const browserEngine = ENGINES[engine];
        const browser = await browserEngine.launch({
          headless: !options.headed,
          channel
        });

        const context = await browser.newContext({ viewport });
        const page = await context.newPage();

        try {
          await page.goto(url, { waitUntil: "networkidle" });
          const result = await analyzePage(page);

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
          await context.close();
          await browser.close();
        }
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
