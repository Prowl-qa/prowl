import fs from "node:fs";
import path from "node:path";
import type { HistoryEntry, HistoryFile } from "../types/index.js";

const HISTORY_FILE = "history.json";
const LOCK_FILE_SUFFIX = ".lock";
const LOCK_RETRY_MS = 10;
const LOCK_TIMEOUT_MS = 5000;
const SLEEP_BUFFER = new Int32Array(new SharedArrayBuffer(4));

function historyPath(configDir: string): string {
  return path.join(configDir, HISTORY_FILE);
}

export function readHistory(configDir: string): HistoryFile {
  const filePath = historyPath(configDir);
  if (!fs.existsSync(filePath)) {
    return { entries: [] };
  }
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "entries" in parsed &&
      Array.isArray((parsed as { entries: unknown }).entries)
    ) {
      return { entries: (parsed as HistoryFile).entries };
    }
    return { entries: [] };
  } catch {
    return { entries: [] };
  }
}

export function readHuntHistory(configDir: string, huntName: string): HistoryEntry[] {
  const { entries } = readHistory(configDir);
  return entries.filter((entry) => entry.hunt === huntName);
}

export function pruneEntries(entries: HistoryEntry[], maxRuns: number): HistoryEntry[] {
  const perHunt = new Map<string, HistoryEntry[]>();
  for (const entry of entries) {
    const list = perHunt.get(entry.hunt) ?? [];
    list.push(entry);
    perHunt.set(entry.hunt, list);
  }

  const keptEntries = new Set<HistoryEntry>();
  for (const list of perHunt.values()) {
    const kept = list.length > maxRuns ? list.slice(list.length - maxRuns) : list;
    for (const entry of kept) {
      keptEntries.add(entry);
    }
  }
  return entries.filter((entry) => keptEntries.has(entry));
}

function sleepSync(ms: number): void {
  Atomics.wait(SLEEP_BUFFER, 0, 0, ms);
}

function withHistoryLock<T>(configDir: string, fn: () => T): T {
  const filePath = historyPath(configDir);
  const lockPath = `${filePath}${LOCK_FILE_SUFFIX}`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const startedAt = Date.now();
  let acquired = false;

  while (!acquired) {
    let fd: number | undefined;
    try {
      fd = fs.openSync(lockPath, "wx");
      acquired = true;
      const result = fn();
      fs.closeSync(fd);
      fs.rmSync(lockPath, { force: true });
      return result;
    } catch (error) {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
          // Ignore close failures during cleanup.
        }
        fs.rmSync(lockPath, { force: true });
      }
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
          throw new Error(`Timed out waiting for history lock: ${lockPath}`);
        }
        sleepSync(LOCK_RETRY_MS);
        continue;
      }
      throw error;
    }
  }
}

export function appendEntry(
  configDir: string,
  entry: HistoryEntry,
  maxRuns: number
): void {
  const filePath = historyPath(configDir);
  withHistoryLock(configDir, () => {
    const current = readHistory(configDir);
    const next = pruneEntries([...current.entries, entry], maxRuns);
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify({ entries: next }, null, 2)}\n`);
    fs.renameSync(tempPath, filePath);
  });
}
