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

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const entry = value as Record<string, unknown>;
  return (
    typeof entry.hunt === "string" &&
    (entry.status === "pass" || entry.status === "fail") &&
    typeof entry.durationMs === "number" &&
    Number.isFinite(entry.durationMs) &&
    typeof entry.startedAt === "string" &&
    (entry.runDir === undefined || typeof entry.runDir === "string")
  );
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
      const validatedEntries = (parsed as { entries: unknown[] }).entries.filter(isHistoryEntry);
      return { entries: validatedEntries };
    }
    return { entries: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Failed to read history file at ${filePath}: ${message}`);
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

  while (Date.now() - startedAt < LOCK_TIMEOUT_MS) {
    let fd: number;
    try {
      fd = fs.openSync(lockPath, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        sleepSync(LOCK_RETRY_MS);
        continue;
      }
      throw error;
    }

    try {
      return fn();
    } finally {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore close failures during cleanup.
      }
      fs.rmSync(lockPath, { force: true });
    }
  }

  throw new Error(
    `Failed to acquire history lock before timeout (${LOCK_TIMEOUT_MS}ms): ${lockPath}; started waiting at ${new Date(startedAt).toISOString()}`
  );
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
