import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockStartMcpServer = vi.fn();

vi.mock("../src/mcp/server.js", () => ({
  startMcpServer: () => mockStartMcpServer()
}));

import { buildMcpCommand } from "../src/cli/commands/mcp.js";

describe("mcp command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts the MCP server", async () => {
    mockStartMcpServer.mockResolvedValue(undefined);

    await buildMcpCommand().parseAsync(["node", "prowlqa", "mcp"]);

    expect(mockStartMcpServer).toHaveBeenCalledTimes(1);
  });

  it("reports startup failures and exits non-zero", async () => {
    mockStartMcpServer.mockRejectedValue(new Error("transport unavailable"));
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${code}`);
    }) as never);

    await expect(buildMcpCommand().parseAsync(["node", "prowlqa", "mcp"])).rejects.toThrow("process.exit:1");

    expect(console.error).toHaveBeenCalledWith("Failed to start MCP server: transport unavailable");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
