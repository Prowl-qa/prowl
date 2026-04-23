import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
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

async function waitForFile(filePath: string, timeoutMs = 10000): Promise<void> {
  const startedAt = Date.now();
  while (!fs.existsSync(filePath)) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for file: ${filePath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function waitForChild(
  child: ReturnType<typeof spawn>,
  label: string
): Promise<void> {
  const stderrChunks: string[] = [];
  child.stderr.on("data", (chunk) => {
    stderrChunks.push(String(chunk));
  });

  if (child.exitCode !== null) {
    if (child.exitCode === 0) {
      return;
    }
    throw new Error(
      `${label} failed with exit code ${child.exitCode}: ${stderrChunks.join("").trim()}`
    );
  }

  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(`${label} failed with exit code ${code}: ${stderrChunks.join("").trim()}`)
      );
    });
  });
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
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      fs.writeFileSync(path.join(dir, "history.json"), "{not json");
      expect(readHistory(dir)).toEqual({ entries: [] });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Failed to read history file at ${path.join(dir, "history.json")}:`)
      );
    } finally {
      warnSpy.mockRestore();
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

  it("serializes concurrent writers so entries are not lost", async () => {
    const dir = setupTempDir();
    const gateDir = fs.mkdtempSync(path.join(os.tmpdir(), "prowlqa-history-gate-"));
    try {
      fs.writeFileSync(path.join(dir, "history.json"), JSON.stringify({ entries: [] }));
      const helperPath = path.join(gateDir, "append-helper.ts");
      fs.writeFileSync(
        helperPath,
        `import fs from "node:fs";
import path from "node:path";
import { appendEntry } from ${JSON.stringify(pathToFileURL(path.resolve("src/runner/history.ts")).href)};

const [configDir, gatePath, startedAt] = process.argv.slice(2);
const historyFile = path.join(configDir, "history.json");
const readyFile = path.join(gatePath, \`\${startedAt}.ready\`);
const continueFile = path.join(gatePath, "continue");
const originalReadFileSync = fs.readFileSync.bind(fs);
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));
let intercepted = false;

function sleepSync(ms) {
  Atomics.wait(sleepBuffer, 0, 0, ms);
}

fs.readFileSync = ((...args) => {
  const filePath = args[0];
  if (!intercepted && filePath === historyFile) {
    intercepted = true;
    fs.writeFileSync(readyFile, "");
    while (!fs.existsSync(continueFile)) {
      sleepSync(10);
    }
  }
  return originalReadFileSync(...args);
});

appendEntry(
  configDir,
  {
    hunt: "shared",
    status: "pass",
    durationMs: 10,
    startedAt,
    runDir: startedAt
  },
  100
);
`
      );

      const childOne = spawn(process.execPath, [
        "--experimental-strip-types",
        helperPath,
        dir,
        gateDir,
        "2026-01-01T00:00:00.000Z"
      ]);
      await waitForFile(path.join(gateDir, "2026-01-01T00:00:00.000Z.ready"));

      const childTwo = spawn(process.execPath, [
        "--experimental-strip-types",
        helperPath,
        dir,
        gateDir,
        "2026-01-02T00:00:00.000Z"
      ]);

      await new Promise((resolve) => setTimeout(resolve, 50));
      fs.writeFileSync(path.join(gateDir, "continue"), "");

      await Promise.all([
        waitForChild(childOne, "first history writer"),
        waitForChild(childTwo, "second history writer")
      ]);

      const { entries } = readHistory(dir);
      expect(entries).toHaveLength(2);
      expect(entries.map((entry) => entry.startedAt)).toEqual([
        "2026-01-01T00:00:00.000Z",
        "2026-01-02T00:00:00.000Z"
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(gateDir, { recursive: true, force: true });
    }
  }, 15000);
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

  it("preserves original chronological order after per-hunt pruning", () => {
    const entries: HistoryEntry[] = [
      makeEntry({ hunt: "a", startedAt: "2026-01-01T00:00:00.000Z" }),
      makeEntry({ hunt: "b", startedAt: "2026-01-02T00:00:00.000Z" }),
      makeEntry({ hunt: "a", startedAt: "2026-01-03T00:00:00.000Z" })
    ];

    const pruned = pruneEntries(entries, 1);
    expect(pruned.map((entry) => `${entry.hunt}:${entry.startedAt}`)).toEqual([
      "b:2026-01-02T00:00:00.000Z",
      "a:2026-01-03T00:00:00.000Z"
    ]);
  });
});
