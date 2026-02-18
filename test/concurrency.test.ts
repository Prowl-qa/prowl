import { describe, expect, it } from "vitest";
import { runWithConcurrency } from "../src/utils/concurrency.js";

describe("runWithConcurrency", () => {
  it("runs tasks sequentially with concurrency=1", async () => {
    const order: number[] = [];
    const tasks = [0, 1, 2].map((i) => async () => {
      order.push(i);
      return i;
    });

    const results = await runWithConcurrency(tasks, 1);

    expect(order).toEqual([0, 1, 2]);
    expect(results).toEqual([
      { status: "fulfilled", value: 0 },
      { status: "fulfilled", value: 1 },
      { status: "fulfilled", value: 2 }
    ]);
  });

  it("runs up to N tasks concurrently", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const tasks = Array.from({ length: 6 }, (_, i) => async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 10));
      concurrent--;
      return i;
    });

    const results = await runWithConcurrency(tasks, 3);

    expect(maxConcurrent).toBeLessThanOrEqual(3);
    expect(maxConcurrent).toBeGreaterThan(1);
    expect(results).toHaveLength(6);
    for (let i = 0; i < 6; i++) {
      expect(results[i]).toEqual({ status: "fulfilled", value: i });
    }
  });

  it("captures errors as rejected results", async () => {
    const tasks = [
      async () => "ok",
      async () => { throw new Error("boom"); },
      async () => "also ok"
    ];

    const results = await runWithConcurrency(tasks, 2);

    expect(results[0]).toEqual({ status: "fulfilled", value: "ok" });
    expect(results[1].status).toBe("rejected");
    expect((results[1] as { status: "rejected"; reason: Error }).reason.message).toBe("boom");
    expect(results[2]).toEqual({ status: "fulfilled", value: "also ok" });
  });

  it("preserves original order of results", async () => {
    const tasks = [
      async () => { await new Promise((r) => setTimeout(r, 30)); return "slow"; },
      async () => { return "fast"; },
      async () => { await new Promise((r) => setTimeout(r, 10)); return "medium"; }
    ];

    const results = await runWithConcurrency(tasks, 3);

    expect(results[0]).toEqual({ status: "fulfilled", value: "slow" });
    expect(results[1]).toEqual({ status: "fulfilled", value: "fast" });
    expect(results[2]).toEqual({ status: "fulfilled", value: "medium" });
  });

  it("handles empty task list", async () => {
    const results = await runWithConcurrency([], 3);
    expect(results).toEqual([]);
  });
});
