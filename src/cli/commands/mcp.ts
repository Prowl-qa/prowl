import { Command } from "commander";
import { startMcpServer } from "../../mcp/server.js";

export function buildMcpCommand(): Command {
  return new Command("mcp")
    .description("Start an MCP server (stdio) exposing ProwlQA tools to AI agents")
    .action(async () => {
      await startMcpServer();
    });
}
