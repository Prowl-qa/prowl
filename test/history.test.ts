import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendEntry,
  pruneEntries,
  readHistory,
  readHuntHistory
} from "../src/runner/history.js";
import type { HistoryEntry } from "../src/types/index.js";

function setupTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-history-"));
}

function makeEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    hunt: "login-flow",
    status: "pass",
    durationMs: 1234,
    startedAt: "2026-04-22T00:00:00.000Z",
    ...overrides
  };
}

describe("readHistory", () => {
  it("returns empty entries when history.json does not exist", () => {
    const dir = setupTempDir();
    try {
      expect(readHistory(dir)).toEqual({ entries: [] });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns empty entries when history.json is malformed", () => {
    const dir = setupTempDir();
    try {
      fs.writeFileSync(path.join(dir, "history.json"), "{not json");
      expect(readHistory(dir)).toEqual({ entries: [] });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns empty entries when history.json is missing the entries field", () => {
    const dir = setupTempDir();
    try {
      fs.writeFileSync(path.join(dir, "history.json"), JSON.stringify({ foo: 1 }));
      expect(readHistory(dir)).toEqual({ entries: [] });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads previously written entries", () => {
    const dir = setupTempDir();
    try {
      const entry = makeEntry();
      appendEntry(dir, entry, 100);
      expect(readHistory(dir)).toEqual({ entries: [entry] });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("appendEntry", () => {
  it("creates history.json on first write", () => {
    const dir = setupTempDir();
    try {
      appendEntry(dir, makeEntry(), 100);
      const filePath = path.join(dir, "history.json");
      expect(fs.existsSync(filePath)).toBe(true);
      const written = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      expect(written.entries).toHaveLength(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("appends without dropping entries when under maxRuns", () => {
    const dir = setupTempDir();
    try {
      appendEntry(dir, makeEntry({ startedAt: "2026-01-01T00:00:00.000Z" }), 5);
      appendEntry(dir, makeEntry({ startedAt: "2026-01-02T00:00:00.000Z" }), 5);
      appendEntry(dir, makeEntry({ startedAt: "2026-01-03T00:00:00.000Z" }), 5);
      const { entries } = readHistory(dir);
      expect(entries.map((e) => e.startedAt)).toEqual([
        "2026-01-01T00:00:00.000Z",
        "2026-01-02T00:00:00.000Z",
        "2026-01-03T00:00:00.000Z"
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prunes oldest entries per-hunt when maxRuns exceeded", () => {
    const dir = setupTempDir();
    try {
      for (let i = 1; i <= 5; i++) {
        appendEntry(
          dir,
          makeEntry({ startedAt: `2026-01-0${i}T00:00:00.000Z` }),
          3
        );
      }
      const { entries } = readHistory(dir);
      expect(entries.map((e) => e.startedAt)).toEqual([
        "2026-01-03T00:00:00.000Z",
        "2026-01-04T00:00:00.000Z",
        "2026-01-05T00:00:00.000Z"
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prunes per-hunt independently", () => {
    const dir = setupTempDir();
    try {
      for (let i = 1; i <= 4; i++) {
        appendEntry(
          dir,
          makeEntry({ hunt: "login", startedAt: `2026-01-0${i}T00:00:00.000Z` }),
          2
        );
      }
      for (let i = 1; i <= 3; i++) {
        appendEntry(
          dir,
          makeEntry({ hunt: "signup", startedAt: `2026-02-0${i}T00:00:00.000Z` }),
          2
        );
      }

      const login = readHuntHistory(dir, "login");
      const signup = readHuntHistory(dir, "signup");

      expect(login.map((e) => e.startedAt)).toEqual([
        "2026-01-03T00:00:00.000Z",
        "2026-01-04T00:00:00.000Z"
      ]);
      expect(signup.map((e) => e.startedAt)).toEqual([
        "2026-02-02T00:00:00.000Z",
        "2026-02-03T00:00:00.000Z"
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("readHuntHistory", () => {
  it("filters to a single hunt and preserves order", () => {
    const dir = setupTempDir();
    try {
      appendEntry(dir, makeEntry({ hunt: "a", startedAt: "2026-01-01T00:00:00.000Z" }), 100);
      appendEntry(dir, makeEntry({ hunt: "b", startedAt: "2026-01-02T00:00:00.000Z" }), 100);
      appendEntry(dir, makeEntry({ hunt: "a", startedAt: "2026-01-03T00:00:00.000Z" }), 100);

      const a = readHuntHistory(dir, "a");
      expect(a).toHaveLength(2);
      expect(a[0].startedAt).toBe("2026-01-01T00:00:00.000Z");
      expect(a[1].startedAt).toBe("2026-01-03T00:00:00.000Z");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns empty array for a hunt with no history", () => {
    const dir = setupTempDir();
    try {
      expect(readHuntHistory(dir, "missing")).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("pruneEntries", () => {
  it("caps each hunt independently", () => {
    const entries: HistoryEntry[] = [
      makeEntry({ hunt: "a", startedAt: "2026-01-01T00:00:00.000Z" }),
      makeEntry({ hunt: "a", startedAt: "2026-01-02T00:00:00.000Z" }),
      makeEntry({ hunt: "a", startedAt: "2026-01-03T00:00:00.000Z" }),
      makeEntry({ hunt: "b", startedAt: "2026-01-04T00:00:00.000Z" })
    ];
    const pruned = pruneEntries(entries, 2);
    const aHistory = pruned.filter((e) => e.hunt === "a");
    const bHistory = pruned.filter((e) => e.hunt === "b");
    expect(aHistory.map((e) => e.startedAt)).toEqual([
      "2026-01-02T00:00:00.000Z",
      "2026-01-03T00:00:00.000Z"
    ]);
    expect(bHistory.map((e) => e.startedAt)).toEqual([
      "2026-01-04T00:00:00.000Z"
    ]);
  });
});
