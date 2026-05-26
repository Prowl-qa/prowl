import { Command } from "commander";
import { startMcpServer } from "../../mcp/server.js";

/** Convert MCP startup failures into concise CLI output. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Build the CLI command that starts the stdio MCP server. */
export function buildMcpCommand(): Command {
  return new Command("mcp")
    .description("Start an MCP server (stdio) exposing ProwlQA tools to AI agents")
    .option(
      "--projects <path>",
      "Path to a project registry (YAML) so tools can target multiple repos by name"
    )
    .action(async (options) => {
      try {
        await startMcpServer({ registryPath: options.projects });
      } catch (error) {
        console.error(`Failed to start MCP server: ${errorMessage(error)}`);
        process.exit(1);
      }
    });
}
