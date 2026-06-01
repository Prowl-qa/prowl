import { describe, expect, it } from "vitest";
import { clusterFailures } from "../src/runner/clustering.js";
import type { BugFailure } from "../src/backlog/fingerprint.js";

// PROWL-034 / P7-004: failure clustering.

function failure(hunt: string, over: Partial<BugFailure> = {}): BugFailure {
  return { hunt, error: "boom", ...over };
}

describe("clusterFailures", () => {
  it("groups hunts that share step type, selector, and normalized error", () => {
    const clusters = clusterFailures([
      failure("a", { stepType: "click", selector: "#submit", error: "Timeout 5000ms" }),
      failure("b", { stepType: "click", selector: "#submit", error: "Timeout 9000ms" }),
      failure("c", { stepType: "click", selector: "#submit", error: "Timeout 30000ms" })
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({
      stepType: "click",
      selector: "#submit",
      count: 3,
      hunts: ["a", "b", "c"]
    });
  });

  it("keeps distinct causes in separate clusters", () => {
    const clusters = clusterFailures([
      failure("a", { stepType: "click", selector: "#submit", error: "Timeout" }),
      failure("b", { stepType: "fill", selector: "#email", error: "not found" })
    ]);
    expect(clusters).toHaveLength(2);
  });

  it("sorts clusters by size (largest first), then cause", () => {
    const clusters = clusterFailures([
      failure("a", { stepType: "fill", selector: "#email", error: "not found" }),
      failure("b", { stepType: "click", selector: "#submit", error: "Timeout" }),
      failure("c", { stepType: "click", selector: "#submit", error: "Timeout" })
    ]);
    expect(clusters[0].count).toBe(2);
    expect(clusters[0].selector).toBe("#submit");
    expect(clusters[1].count).toBe(1);
  });

  it("de-duplicates the same hunt within a cluster", () => {
    const clusters = clusterFailures([
      failure("a", { stepType: "click", selector: "#x", error: "e" }),
      failure("a", { stepType: "click", selector: "#x", error: "e" })
    ]);
    expect(clusters[0].count).toBe(1);
    expect(clusters[0].hunts).toEqual(["a"]);
  });

  it("returns an empty array for no failures", () => {
    expect(clusterFailures([])).toEqual([]);
  });

  it("builds a readable cause description", () => {
    const clusters = clusterFailures([
      failure("a", { stepType: "click", selector: "#submit", error: "Timeout 5000ms" })
    ]);
    expect(clusters[0].cause).toBe("click (#submit): Timeout 5000ms");
  });

  it("describes a stepless failure with 'run'", () => {
    const clusters = clusterFailures([failure("a", { error: "Hunt file not found" })]);
    expect(clusters[0].cause).toBe("run: Hunt file not found");
  });
});
