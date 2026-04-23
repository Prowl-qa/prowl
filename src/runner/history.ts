import fs from "node:fs";
import path from "node:path";
import type { HistoryEntry, HistoryFile } from "../types/index.js";

const HISTORY_FILE = "history.json";

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

  const pruned: HistoryEntry[] = [];
  for (const list of perHunt.values()) {
    const kept = list.length > maxRuns ? list.slice(list.length - maxRuns) : list;
    pruned.push(...kept);
  }
  return pruned;
}

export function appendEntry(
  configDir: string,
  entry: HistoryEntry,
  maxRuns: number
): void {
  const current = readHistory(configDir);
  const next = pruneEntries([...current.entries, entry], maxRuns);
  const filePath = historyPath(configDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({ entries: next }, null, 2)}\n`);
}
