import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { generateHunt } from "../../generator/index.js";
import type { AnalysisResult } from "../../analyzer/index.js";

async function readStdin(): Promise<string | null> {
  if (process.stdin.isTTY) return null;

  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => resolve(data || null));
    // Timeout after 100ms if no data
    setTimeout(() => resolve(data || null), 100);
  });
}

export function buildGenerateCommand(): Command {
  const command = new Command("generate")
    .description("Generate a hunt file from page analysis and intent using AI")
    .option("--url <url>", "URL to analyze and generate for")
    .option("--intent <description>", "What to test (required)")
    .option("--output <name>", "Hunt file name (saved to .prowlqa/hunts/)")
    .option("--stdout", "Print YAML to stdout instead of saving")
    .option("--browser <engine>", "Browser engine for analysis")
    .option("--viewport <size>", "Viewport for analysis")
    .option("--config <path>", "Custom config path")
    .action(async (options) => {
      try {
        const intent = options.intent as string;
        if (!intent) {
          console.error(chalk.red("  --intent is required"));
          process.exitCode = 1;
          return;
        }

        let analysis: AnalysisResult | undefined;

        // Try reading piped stdin first
        const stdinData = await readStdin();
        if (stdinData) {
          try {
            analysis = JSON.parse(stdinData) as AnalysisResult;
          } catch {
            console.error(chalk.red("  Failed to parse piped JSON input"));
            process.exitCode = 1;
            return;
          }
        }

        if (!analysis && !options.url) {
          console.error(chalk.red("  Either --url or piped analysis JSON is required"));
          process.exitCode = 1;
          return;
        }

        const spinner = ora("Generating hunt...").start();

        try {
          const yamlStr = await generateHunt({
            url: options.url,
            analysis,
            intent,
            browser: options.browser,
            viewport: options.viewport
          });

          spinner.succeed("Hunt generated");

          if (options.stdout) {
            console.log(yamlStr);
          } else if (options.output) {
            let configDir: string | undefined;
            try {
              const { loadConfig } = await import("../../config/loader.js");
              const result = loadConfig(options.config);
              configDir = result.configDir;
            } catch {
              configDir = path.join(process.cwd(), ".prowlqa");
            }

            const huntsDir = path.join(configDir, "hunts");
            fs.mkdirSync(huntsDir, { recursive: true });
            const fileName = options.output.endsWith(".yml")
              ? options.output
              : `${options.output}.yml`;
            const filePath = path.join(huntsDir, fileName);
            fs.writeFileSync(filePath, yamlStr + "\n", "utf-8");
            console.log(chalk.green(`  Saved to ${filePath}`));
          } else {
            // Default: print to stdout
            console.log(yamlStr);
          }
        } catch (error) {
          spinner.fail("Generation failed");
          throw error;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Generation failed";
        console.error(`\n  Error: ${message}\n`);
        process.exitCode = 1;
      }
    });

  return command;
}
