import { describe, expect, it } from "vitest";
import { parseXml, decodeXmlEntities } from "../src/analyzer/xml.js";

describe("decodeXmlEntities", () => {
  it("decodes the five predefined entities", () => {
    expect(decodeXmlEntities("a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;")).toBe(
      `a & b < c > d "e" 'f'`
    );
  });

  it("decodes decimal and hex numeric character references", () => {
    expect(decodeXmlEntities("&#65;&#x42;&#x1F600;")).toBe("AB\u{1F600}");
    expect(decodeXmlEntities("&#x10ffff;")).toBe("\u{10FFFF}");
  });

  it("leaves unsafe or out-of-range numeric character references untouched", () => {
    expect(decodeXmlEntities("bad &#x110000; and &#999999999999999999999999; and &#1A;")).toBe(
      "bad &#x110000; and &#999999999999999999999999; and &#1A;"
    );
  });

  it("leaves unknown entities and plain text untouched", () => {
    expect(decodeXmlEntities("keep &nope; and plain")).toBe("keep &nope; and plain");
    expect(decodeXmlEntities("no entities here")).toBe("no entities here");
  });
});

describe("parseXml", () => {
  it("parses a nested tree, self-closing tags, and decoded attributes", () => {
    const xml =
      `<?xml version='1.0' encoding='UTF-8'?>` +
      `<hierarchy rotation="0">` +
      `<node class="android.widget.FrameLayout" text="A &amp; B">` +
      `<node class="android.widget.Button" text="Save"/>` +
      `</node>` +
      `</hierarchy>`;
    const root = parseXml(xml);
    expect(root?.tag).toBe("hierarchy");
    expect(root?.attrs.rotation).toBe("0");
    expect(root?.children).toHaveLength(1);

    const frame = root?.children[0];
    expect(frame?.attrs.class).toBe("android.widget.FrameLayout");
    expect(frame?.attrs.text).toBe("A & B");
    expect(frame?.children).toHaveLength(1);
    expect(frame?.children[0].attrs.text).toBe("Save");
    expect(frame?.children[0].children).toHaveLength(0);
  });

  it("keeps '>' inside quoted attribute values from breaking the tag", () => {
    const root = parseXml(`<node label="a > b" name="x"/>`);
    expect(root?.attrs.label).toBe("a > b");
    expect(root?.attrs.name).toBe("x");
  });

  it("skips comments and returns the first element as the root", () => {
    const root = parseXml(`<!-- header --><root><child/></root>`);
    expect(root?.tag).toBe("root");
    expect(root?.children[0].tag).toBe("child");
  });

  it("returns null when there is no element", () => {
    expect(parseXml("")).toBeNull();
    expect(parseXml("   \n  ")).toBeNull();
    expect(parseXml("<?xml version='1.0'?>")).toBeNull();
  });

  it("tolerates a stray mismatched end tag without throwing", () => {
    const root = parseXml(`<a><b/></c></a>`);
    expect(root?.tag).toBe("a");
    expect(root?.children.map((c) => c.tag)).toEqual(["b"]);
  });
});
