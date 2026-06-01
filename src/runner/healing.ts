import type { Locator, Page } from "playwright";

/**
 * Self-healing selectors (PROWL-023). When an explicit selector matches nothing,
 * derive the human "intent" from the selector and try alternative strategies —
 * fuzzy text, ARIA label, and structural (interactive element + text) — healing
 * ONLY to a candidate that resolves to exactly one element. Opt-in via
 * `guardrails.selfHealing`; never guesses among multiple matches.
 */

export type HealResult = {
  /** The candidate selector that uniquely matched. */
  selector: string;
  /** The original selector that failed. */
  healedFrom: string;
  /** Which strategy produced the match (for reporting). */
  strategy: "text" | "aria" | "structural";
};

const INTERACTIVE_TAGS = ["button", "a", "input", "select", "textarea"];

/**
 * Pull human-meaningful words out of a raw selector. Reads id (`#submit-btn`),
 * class tokens (`.login-form`), and attribute values (`[data-testid="sign-in"]`,
 * `[aria-label='Close']`), splitting on separators and camelCase. Returns the
 * lowercased words (de-duped, in order) and a space-joined label. Mapping is
 * intentionally literal/predictable — no noise-word filtering.
 */
export function extractSelectorIntent(selector: string): { words: string[]; label: string } {
  const raw: string[] = [];

  // #id and .class tokens
  for (const match of selector.matchAll(/[#.]([A-Za-z_][\w-]*)/g)) {
    raw.push(match[1]);
  }
  // attribute values: [attr="value"] / [attr='value'] / [attr=value]
  for (const match of selector.matchAll(/\[[A-Za-z_:-]+\s*[~|^$*]?=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))\]/g)) {
    const value = match[1] ?? match[2] ?? match[3];
    if (value) raw.push(value);
  }

  const words: string[] = [];
  for (const token of raw) {
    for (const part of splitToken(token)) {
      const lower = part.toLowerCase();
      if (lower.length > 0 && !words.includes(lower)) {
        words.push(lower);
      }
    }
  }

  return { words, label: words.join(" ") };
}

function splitToken(token: string): string[] {
  return token
    // camelCase / PascalCase boundaries
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    // separators
    .split(/[\s\-_.:]+/)
    .filter((part) => part.length > 0);
}

/**
 * Build candidate Playwright selectors for a derived intent, in AC priority order:
 * (1) fuzzy text, (2) ARIA label, (3) structural (interactive element + text).
 * Returns [] when the selector carried no usable words.
 */
export function buildHealCandidates(selector: string): Array<{ selector: string; strategy: HealResult["strategy"] }> {
  const { words, label } = extractSelectorIntent(selector);
  if (words.length === 0) return [];

  const escaped = label.replace(/"/g, '\\"');
  const candidates: Array<{ selector: string; strategy: HealResult["strategy"] }> = [];

  // 1. Similar text content (case-insensitive substring via Playwright text engine)
  candidates.push({ selector: `text=${label}`, strategy: "text" });

  // 2. Similar ARIA label (case-insensitive attribute substring)
  candidates.push({ selector: `[aria-label*="${escaped}" i]`, strategy: "aria" });

  // 3. Nearby element with matching structure: an interactive element containing the text
  for (const tag of INTERACTIVE_TAGS) {
    candidates.push({ selector: `${tag}:has-text("${escaped}")`, strategy: "structural" });
  }

  return candidates;
}

/**
 * Attempt to heal a failed selector. Returns a HealResult only when a candidate
 * resolves to exactly one element; otherwise null. Counting is delegated so this
 * is unit-testable with a fake page.
 */
export async function healSelector(
  page: Pick<Page, "locator">,
  selector: string,
  options: { enabled: boolean }
): Promise<HealResult | null> {
  if (!options.enabled) return null;

  for (const candidate of buildHealCandidates(selector)) {
    let count: number;
    try {
      const locator: Pick<Locator, "count"> = page.locator(candidate.selector);
      count = await locator.count();
    } catch {
      continue; // ignore candidates Playwright can't parse
    }
    if (count === 1) {
      return { selector: candidate.selector, healedFrom: selector, strategy: candidate.strategy };
    }
  }

  return null;
}
