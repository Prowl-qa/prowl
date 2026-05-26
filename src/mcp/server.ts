import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import pkg from "../../package.json";
import { listHuntsTool, runHuntTool, runSuiteTool } from "./tools.js";

type TextToolResult = { content: Array<{ type: "text"; text: string }> };

/** Serialize a tool payload into the MCP text-content response format. */
function textResult(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/** Convert unknown thrown values into user-facing error text. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** JSON-stringify diagnostic values without throwing from circular structures. */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "undefined";
  } catch {
    return "[unserializable]";
  }
}

/** Run a tool implementation and rethrow failures with tool-specific context. */
async function toolResult(
  toolName: string,
  args: unknown,
  action: () => unknown | Promise<unknown>
): Promise<TextToolResult> {
  try {
    return textResult(await action());
  } catch (error) {
    throw new Error(`${toolName} failed for args=${safeStringify(args)}: ${errorMessage(error)}`, {
      cause: error
    });
  }
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
      inputSchema: z.object({}).strict()
    },
    async (args) => toolResult("list_hunts", args, () => listHuntsTool())
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
    async (args) => toolResult("run_suite", args, () => runSuiteTool(args))
  );

  server.registerTool(
    "run_hunt",
    {
      description: "Run a single hunt by name and return its full result.",
      inputSchema: {
        hunt: z.string().min(1)
      }
    },
    async (args) => toolResult("run_hunt", args, () => runHuntTool(args))
  );

  return server;
}

/** Starts the MCP server over stdio and resolves once connected. */
export async function startMcpServer(): Promise<void> {
  const server = buildMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
