import { describe, expect, it, vi, afterEach } from "vitest";
import {
  assertWithAiVision,
  buildVisionPrompt,
  parseVisionVerdict,
  tryResolveAiConfig,
  type AiConfig
} from "../src/generator/ai.js";

const anthropicConfig: AiConfig = {
  provider: "anthropic",
  model: "claude-sonnet-4-5-20250929",
  apiKey: "test-key"
};

const openaiConfig: AiConfig = {
  provider: "openai",
  model: "gpt-4o",
  apiKey: "test-key"
};

type ContentBlock = Record<string, unknown>;
type RequestBody = {
  temperature?: number;
  messages: Array<{ content: ContentBlock[] }>;
};

function mockFetchJson(json: unknown): typeof fetch {
  return vi.fn(async () => ({ ok: true, json: async () => json })) as unknown as typeof fetch;
}

/** Pull the JSON-parsed request body out of the last fetch mock call. */
function lastRequestBody(): RequestBody {
  const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1);
  return JSON.parse((call?.[1] as { body: string }).body) as RequestBody;
}

describe("buildVisionPrompt", () => {
  it("embeds the assertion and asks for strict JSON", () => {
    const prompt = buildVisionPrompt("The header shows the user's name");
    expect(prompt).toContain("The header shows the user's name");
    expect(prompt).toContain('{"pass":');
    expect(prompt).toContain("reason");
  });
});

describe("parseVisionVerdict", () => {
  it("parses a clean pass verdict", () => {
    const v = parseVisionVerdict('{"pass": true, "reason": "Both fields are visible."}');
    expect(v).toEqual({ pass: true, reason: "Both fields are visible." });
  });

  it("parses a clean fail verdict", () => {
    const v = parseVisionVerdict('{"pass": false, "reason": "The password field is missing."}');
    expect(v.pass).toBe(false);
    expect(v.reason).toBe("The password field is missing.");
  });

  it("tolerates ```json code fences", () => {
    const v = parseVisionVerdict('```json\n{"pass": true, "reason": "ok"}\n```');
    expect(v).toEqual({ pass: true, reason: "ok" });
  });

  it("tolerates leading/trailing prose around the JSON", () => {
    const v = parseVisionVerdict('Here is my verdict: {"pass": false, "reason": "nope"} Done.');
    expect(v).toEqual({ pass: false, reason: "nope" });
  });

  it("supplies a default reason when the model omits one", () => {
    const v = parseVisionVerdict('{"pass": true}');
    expect(v.pass).toBe(true);
    expect(v.reason.length).toBeGreaterThan(0);
  });

  it("throws when there is no JSON object at all", () => {
    expect(() => parseVisionVerdict("I think it looks fine, yes.")).toThrow(/parse a JSON verdict/);
  });

  it("throws on malformed JSON", () => {
    expect(() => parseVisionVerdict('{"pass": true, "reason": }')).toThrow(/not valid JSON/);
  });

  it("throws when 'pass' is not a boolean (never a silent pass)", () => {
    expect(() => parseVisionVerdict('{"pass": "yes", "reason": "hmm"}')).toThrow(/boolean "pass"/);
  });
});

describe("assertWithAiVision", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("shapes the Anthropic image payload as a base64 image content block", async () => {
    globalThis.fetch = mockFetchJson({
      content: [{ type: "text", text: '{"pass": true, "reason": "looks good"}' }]
    });

    const verdict = await assertWithAiVision(
      { imageBase64: "AAAA", mediaType: "image/png", assertion: "The page loaded" },
      anthropicConfig
    );

    expect(verdict).toEqual({ pass: true, reason: "looks good" });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-api-key": "test-key" })
      })
    );

    const body = lastRequestBody();
    expect(body.temperature).toBe(0);
    const content = body.messages[0].content;
    const imageBlock = content.find((c: ContentBlock) => c.type === "image");
    expect(imageBlock.source).toEqual({
      type: "base64",
      media_type: "image/png",
      data: "AAAA"
    });
    expect(content.some((c: ContentBlock) => c.type === "text")).toBe(true);
  });

  it("shapes the OpenAI image payload as an image_url data URI", async () => {
    globalThis.fetch = mockFetchJson({
      choices: [{ message: { content: '{"pass": false, "reason": "missing button"}' } }]
    });

    const verdict = await assertWithAiVision(
      { imageBase64: "BBBB", mediaType: "image/png", assertion: "The button is visible" },
      openaiConfig
    );

    expect(verdict).toEqual({ pass: false, reason: "missing button" });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-key" })
      })
    );

    const body = lastRequestBody();
    expect(body.temperature).toBe(0);
    const content = body.messages[0].content;
    const imageBlock = content.find((c: ContentBlock) => c.type === "image_url");
    expect(imageBlock.image_url).toEqual({ url: "data:image/png;base64,BBBB" });
    expect(content.some((c: ContentBlock) => c.type === "text")).toBe(true);
  });

  it("honors a custom baseUrl (managed/self-hosted endpoint)", async () => {
    globalThis.fetch = mockFetchJson({
      content: [{ type: "text", text: '{"pass": true, "reason": "ok"}' }]
    });

    await assertWithAiVision(
      { imageBase64: "AAAA", mediaType: "image/png", assertion: "x" },
      { ...anthropicConfig, baseUrl: "https://proxy.prowl.tools" }
    );

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://proxy.prowl.tools/v1/messages",
      expect.anything()
    );
  });

  it("throws on an API error", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => "Unauthorized"
    })) as unknown as typeof fetch;

    await expect(
      assertWithAiVision(
        { imageBase64: "AAAA", mediaType: "image/png", assertion: "x" },
        anthropicConfig
      )
    ).rejects.toThrow("Anthropic API error (401)");
  });
});

describe("tryResolveAiConfig", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns null when no key is configured (graceful skip path)", () => {
    delete process.env.PROWL_AI_KEY;
    expect(tryResolveAiConfig()).toBeNull();
  });

  it("returns a config when a key is present", () => {
    process.env.PROWL_AI_KEY = "test-key";
    delete process.env.PROWL_AI_PROVIDER;
    const config = tryResolveAiConfig();
    expect(config).not.toBeNull();
    expect(config?.provider).toBe("anthropic");
  });

  it("reads a custom base URL from PROWL_AI_BASE_URL", () => {
    process.env.PROWL_AI_KEY = "test-key";
    process.env.PROWL_AI_BASE_URL = "https://proxy.prowl.tools/";
    const config = tryResolveAiConfig();
    // trailing slash is normalized away
    expect(config?.baseUrl).toBe("https://proxy.prowl.tools");
  });

  it("still throws on an unsupported provider (real misconfig, not a skip)", () => {
    process.env.PROWL_AI_KEY = "test-key";
    process.env.PROWL_AI_PROVIDER = "gemini";
    expect(() => tryResolveAiConfig()).toThrow("Unsupported AI provider");
  });
});
