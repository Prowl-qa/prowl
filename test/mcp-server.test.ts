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

async function connectClient(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildMcpServer();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientTransport);
  return client;
}

function payloadOf(res: { content: unknown }): unknown {
  const content = res.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text);
}

describe("mcp server", () => {
  beforeEach(() => vi.clearAllMocks());

  it("exposes list_hunts, run_suite, and run_hunt", async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["list_hunts", "run_hunt", "run_suite"]);
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
    await client.close();
  });
});
