import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import pkg from "../../package.json";
import { listHuntsTool, runHuntTool, runSuiteTool } from "./tools.js";

function textResult(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/**
 * Builds an MCP server exposing ProwlQA as named tools. Operates on the current
 * working directory's `.prowlqa/` project, exactly like the CLI. The agent gets a
 * fixed tool surface — it never chooses shell commands.
 */
export function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "prowlqa", version: pkg.version });

  server.registerTool(
    "list_hunts",
    {
      description: "List all hunts in the current project, in run order.",
      inputSchema: {}
    },
    () => textResult(listHuntsTool())
  );

  server.registerTool(
    "run_suite",
    {
      description:
        "Run all hunts and, by default, log any failures as deduplicated bug tickets in the project backlog. Returns pass/fail/skip counts and the QA-NNN ticket ids created.",
      inputSchema: {
        includeTags: z.array(z.string()).optional(),
        excludeTags: z.array(z.string()).optional(),
        parallel: z.number().int().min(1).optional(),
        logBugs: z.boolean().optional()
      }
    },
    async (args) => textResult(await runSuiteTool(args))
  );

  server.registerTool(
    "run_hunt",
    {
      description: "Run a single hunt by name and return its full result.",
      inputSchema: {
        hunt: z.string().min(1)
      }
    },
    async (args) => textResult(await runHuntTool(args))
  );

  return server;
}

/** Starts the MCP server over stdio and resolves once connected. */
export async function startMcpServer(): Promise<void> {
  const server = buildMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
