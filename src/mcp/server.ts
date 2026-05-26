import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import pkg from "../../package.json";
import { listHuntsTool, runHuntTool, runSuiteTool } from "./tools.js";
import {
  type ProjectRegistry,
  type ResolvedProject,
  listRegisteredProjects,
  loadProjectRegistry,
  resolveProject
} from "./projects.js";

export interface BuildMcpServerOptions {
  /** When provided, a `project` tool argument selects a registered project. */
  registry?: ProjectRegistry | null;
}

export interface StartMcpServerOptions {
  /** Path to a project registry file (overrides env/default discovery). */
  registryPath?: string;
}

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

const PROJECT_ARG_DESCRIPTION =
  "Registered project name to target (from the registry). Omit to use the current working directory.";

/**
 * Builds an MCP server exposing ProwlQA as named tools. By default it operates on
 * the current working directory's `.prowlqa/` project, exactly like the CLI. When a
 * project registry is provided, tools accept an optional `project` argument to
 * target any registered repo. The agent gets a fixed tool surface — it never
 * chooses shell commands.
 */
export function buildMcpServer(options: BuildMcpServerOptions = {}): McpServer {
  const registry = options.registry ?? null;
  const server = new McpServer({ name: "prowlqa", version: pkg.version });

  // Resolve an optional `project` arg. Throws a helpful error if a project is
  // named but no registry is configured.
  const projectFor = (project?: string): ResolvedProject | null => {
    if (!project) return null;
    if (!registry) {
      throw new Error(
        `No project registry is configured, so project "${project}" cannot be resolved. ` +
          "Start the server with `prowlqa mcp --projects <path>` (or set PROWLQA_PROJECTS)."
      );
    }
    return resolveProject(registry, project);
  };

  const configPathFor = (project?: string): string | undefined => {
    return projectFor(project)?.configPath;
  };

  server.registerTool(
    "list_projects",
    {
      description: "List the projects registered with this server. Empty when no registry is configured.",
      inputSchema: z.object({}).strict()
    },
    async (args) => toolResult("list_projects", args, () => ({ projects: listRegisteredProjects(registry) }))
  );

  server.registerTool(
    "list_hunts",
    {
      description: "List all hunts in the target project, in run order.",
      inputSchema: {
        project: z.string().min(1).describe(PROJECT_ARG_DESCRIPTION).optional()
      }
    },
    async (args) => toolResult("list_hunts", args, () => listHuntsTool(configPathFor(args.project)))
  );

  server.registerTool(
    "run_suite",
    {
      description:
        "Run all hunts and, by default, log any failures as deduplicated bug tickets in the project backlog. Returns pass/fail/skip counts and the QA-NNN ticket ids created.",
      inputSchema: {
        project: z.string().min(1).describe(PROJECT_ARG_DESCRIPTION).optional(),
        includeTags: z.array(z.string()).optional(),
        excludeTags: z.array(z.string()).optional(),
        parallel: z.number().int().min(1).optional(),
        logBugs: z.boolean().optional()
      }
    },
    async (args) => toolResult("run_suite", args, () => {
      const project = projectFor(args.project);
      return runSuiteTool(args, { configPath: project?.configPath, projectRoot: project?.root });
    })
  );

  server.registerTool(
    "run_hunt",
    {
      description: "Run a single hunt by name and return its full result.",
      inputSchema: {
        hunt: z.string().min(1),
        project: z.string().min(1).describe(PROJECT_ARG_DESCRIPTION).optional()
      }
    },
    async (args) => toolResult("run_hunt", args, () => runHuntTool(args, configPathFor(args.project)))
  );

  return server;
}

/** Starts the MCP server over stdio and resolves once connected. */
export async function startMcpServer(options: StartMcpServerOptions = {}): Promise<void> {
  const registry = loadProjectRegistry(options.registryPath);
  const server = buildMcpServer({ registry });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
