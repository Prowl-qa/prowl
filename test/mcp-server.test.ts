import { describe, expect, it, vi, beforeEach } from "vitest";

const mockLoadConfig = vi.fn();
const mockListHunts = vi.fn();
const mockRunHunt = vi.fn();
const mockRunSuite = vi.fn();
const mockUpdateBacklog = vi.fn();

vi.mock("../src/config/loader.js", () => ({
  loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
  listHunts: (...args: unknown[]) => mockListHunts(...args)
}));
vi.mock("../src/runner/index.js", () => ({ runHunt: (...args: unknown[]) => mockRunHunt(...args) }));
vi.mock("../src/runner/suite.js", () => ({ runSuite: (...args: unknown[]) => mockRunSuite(...args) }));
vi.mock("../src/backlog/index.js", () => ({ updateBacklogFromSuite: (...args: unknown[]) => mockUpdateBacklog(...args) }));

import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { buildMcpServer } from "../src/mcp/server.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function connectClient(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildMcpServer();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientTransport);
  return client;
}

function payloadOf(res: { content: unknown }): unknown {
  const { content } = res;
  const first = Array.isArray(content) ? content[0] as { type?: unknown; text?: unknown } | undefined : undefined;
  if (!first || first.type !== "text" || typeof first.text !== "string") {
    throw new Error(`payloadOf expected MCP text content, received ${JSON.stringify(content)}`);
  }

  try {
    return JSON.parse(first.text);
  } catch (error) {
    throw new Error(`payloadOf failed to parse JSON: ${errorMessage(error)}; content=${JSON.stringify(content)}`);
  }
}

describe("mcp server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockReturnValue({ config: {}, configPath: "/proj/.prowlqa/config.yml", configDir: "/proj/.prowlqa" });
  });

  it("exposes list_hunts, run_suite, and run_hunt", async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["list_hunts", "run_hunt", "run_suite"]);
    expect(tools.find((t) => t.name === "list_hunts")?.inputSchema).toMatchObject({
      type: "object",
      properties: {},
      additionalProperties: false
    });
    await client.close();
  });

  it("round-trips a list_hunts call", async () => {
    mockLoadConfig.mockReturnValue({ config: {}, configDir: "/proj/.prowlqa" });
    mockListHunts.mockReturnValue(["auth/login", "homepage"]);

    const client = await connectClient();
    const res = await client.callTool({ name: "list_hunts", arguments: {} });
    expect(payloadOf(res)).toEqual({ hunts: ["auth/login", "homepage"] });
    await client.close();
  });

  it("round-trips run_suite including bug-log results", async () => {
    mockRunSuite.mockResolvedValue({
      result: { status: "fail", startedAt: "x", durationMs: 100, totalHunts: 1, passed: 0, failed: 1, skipped: 0, hunts: [] },
      resultPath: "/tmp/ci-result.json"
    });
    mockUpdateBacklog.mockReturnValue({ created: ["QA-001"], regressions: [], skipped: [], backlogPath: "docs/backlog.md" });

    const client = await connectClient();
    const res = await client.callTool({ name: "run_suite", arguments: {} });
    expect(payloadOf(res)).toMatchObject({
      status: "fail",
      failed: 1,
      bugs: { created: ["QA-001"] }
    });
    await client.close();
  });

  it("reports tool errors when a hunt cannot run", async () => {
    mockRunHunt.mockRejectedValue(new Error("Hunt not found: ghost"));

    const client = await connectClient();
    const res = await client.callTool({ name: "run_hunt", arguments: { hunt: "ghost" } });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain("run_hunt failed for args={\\\"hunt\\\":\\\"ghost\\\"}");
    await client.close();
  });

  it("reports contextual tool errors when a suite cannot run", async () => {
    mockRunSuite.mockRejectedValue(new Error("Suite unavailable"));

    const client = await connectClient();
    const res = await client.callTool({ name: "run_suite", arguments: { parallel: 2 } });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain("run_suite failed for args=");
    expect(JSON.stringify(res.content)).toContain("\\\"parallel\\\":2");
    expect(JSON.stringify(res.content)).toContain("Suite unavailable");
    await client.close();
  });

  it("throws clear helper errors for malformed response payloads", () => {
    expect(() => payloadOf({ content: [] })).toThrow("payloadOf expected MCP text content");
    expect(() => payloadOf({ content: [{ type: "text", text: "not json" }] })).toThrow(
      "payloadOf failed to parse JSON"
    );
  });
});
