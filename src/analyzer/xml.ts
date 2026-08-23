/**
 * PROWL-061 — a tiny, dependency-free XML parser for on-device UI hierarchies.
 *
 * Both native mobile analyzers read an XML page source: Android via the
 * uiautomator2 agent's `GET /source` (a `<hierarchy>` of `<node>` elements) and
 * iOS via WebDriverAgent's `GET /source` (a tree of `<XCUIElementType…>`
 * elements). Both dialects share the same shape — a tree of elements whose data
 * lives entirely in double-quoted attributes, with no meaningful text between
 * tags — so one small scanner serves both, keeping with the repo's "no heavy
 * SDK" ethos (there is no XML parser in our own dependency set, only transitive
 * ones we must not rely on).
 *
 * The scanner is deliberately narrow: it understands element start/end/self-close
 * tags, quoted attributes (single or double), XML declarations, comments, and the
 * five predefined entities plus numeric character references. It ignores text
 * nodes and CDATA (the UI dumps carry none). It never throws on malformed input —
 * it returns the best-effort root element, or null when there is no element at
 * all — so a surprising payload degrades to an empty analysis rather than a crash.
 */

/** A parsed XML element: its tag name, attributes, and child elements. */
export type XmlElement = {
  tag: string;
  attrs: Record<string, string>;
  children: XmlElement[];
};

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'"
};

/** Decode the five predefined XML entities and numeric character references. */
export function decodeXmlEntities(value: string): string {
  if (!value.includes("&")) {
    return value;
  }
  return value.replace(/&(#(?:[xX][0-9a-fA-F]+|[0-9]+)|[a-zA-Z]+);/g, (match, code: string) => {
    if (code[0] === "#") {
      const hex = code[1] === "x" || code[1] === "X";
      const num = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isSafeInteger(num) && num <= 0x10ffff ? String.fromCodePoint(num) : match;
    }
    const named = ENTITIES[code];
    return named ?? match;
  });
}

const ATTR_RE = /([^\s=/]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

/** Parse a start-tag body (`tag attr="v" …`) into its name and decoded attributes. */
function parseTagBody(body: string): { tag: string; attrs: Record<string, string> } {
  const trimmed = body.trim();
  const nameMatch = /^([^\s/>]+)/.exec(trimmed);
  const tag = nameMatch ? nameMatch[1] : "";
  const attrs: Record<string, string> = {};
  const rest = trimmed.slice(tag.length);
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(rest)) !== null) {
    const rawValue = m[3] !== undefined ? m[3] : (m[4] ?? "");
    attrs[m[1]] = decodeXmlEntities(rawValue);
  }
  return { tag, attrs };
}

/**
 * Parse an XML document into its root {@link XmlElement} (best-effort). Returns
 * null when the input contains no element. Malformed markup is tolerated: unknown
 * constructs are skipped and mismatched end tags simply pop the stack.
 */
export function parseXml(input: string): XmlElement | null {
  const n = input.length;
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  let i = 0;

  while (i < n) {
    const lt = input.indexOf("<", i);
    if (lt < 0) {
      break;
    }
    i = lt + 1;
    const ch = input[i];

    if (ch === "?") {
      // XML declaration / processing instruction.
      const end = input.indexOf("?>", i);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (ch === "!") {
      // Comment, DOCTYPE, or CDATA — skip to the closing marker.
      if (input.startsWith("!--", i)) {
        const end = input.indexOf("-->", i);
        i = end < 0 ? n : end + 3;
      } else {
        const end = input.indexOf(">", i);
        i = end < 0 ? n : end + 1;
      }
      continue;
    }
    if (ch === "/") {
      // End tag — pop the current element.
      const gt = input.indexOf(">", i);
      i = gt < 0 ? n : gt + 1;
      stack.pop();
      continue;
    }

    // Start tag (possibly self-closing). Scan to the matching '>' while
    // respecting quoted attribute values (which may contain '>').
    let j = i;
    let quote: string | null = null;
    while (j < n) {
      const c = input[j];
      if (quote !== null) {
        if (c === quote) {
          quote = null;
        }
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === ">") {
        break;
      }
      j += 1;
    }
    const inner = input.slice(i, j);
    i = j + 1;

    const selfClose = inner.endsWith("/");
    const body = selfClose ? inner.slice(0, -1) : inner;
    const { tag, attrs } = parseTagBody(body);
    if (tag.length === 0) {
      continue;
    }
    const element: XmlElement = { tag, attrs, children: [] };
    const parent = stack[stack.length - 1];
    if (parent) {
      parent.children.push(element);
    }
    if (root === null) {
      root = element;
    }
    if (!selfClose) {
      stack.push(element);
    }
  }

  return root;
}
