import { describe, expect, it, vi, afterEach } from "vitest";
import { buildGenerationPrompt, extractYamlFromResponse } from "../src/generator/prompt.js";
import { resolveAiConfig, generateWithAi } from "../src/generator/ai.js";
import type { AnalysisResult } from "../src/analyzer/index.js";

const mockAnalysis: AnalysisResult = {
  url: "https://example.com/login",
  title: "Login - Example App",
  elements: [
    {
      tag: "input",
      type: "email",
      selectors: { testId: '[data-testid="email"]', label: "Email" },
      required: true,
      formGroup: 0
    },
    {
      tag: "input",
      type: "password",
      selectors: { testId: '[data-testid="password"]', label: "Password" },
      required: true,
      formGroup: 0
    },
    {
      tag: "button",
      type: "submit",
      selectors: { testId: '[data-testid="login-btn"]', text: "Sign In" },
      required: false,
      formGroup: 0
    }
  ],
  forms: [
    { index: 0, action: "/api/auth/login", method: "POST", fieldCount: 2 }
  ],
  links: [
    { text: "Forgot password?", href: "/forgot-password", selector: 'a[href="/forgot-password"]' }
  ]
};

describe("buildGenerationPrompt", () => {
  it("includes step type reference", () => {
    const prompt = buildGenerationPrompt(mockAnalysis, "test login");
    expect(prompt).toContain("navigate:");
    expect(prompt).toContain("click:");
    expect(prompt).toContain("fill:");
    expect(prompt).toContain("assert:");
    expect(prompt).toContain("evalScript:");
    expect(prompt).toContain("assertScreenshot:");
  });

  it("includes analysis data", () => {
    const prompt = buildGenerationPrompt(mockAnalysis, "test login");
    expect(prompt).toContain("example.com/login");
    expect(prompt).toContain("email");
    expect(prompt).toContain("password");
    expect(prompt).toContain("Sign In");
  });

  it("includes intent description", () => {
    const prompt = buildGenerationPrompt(mockAnalysis, "test the login flow with valid credentials");
    expect(prompt).toContain("test the login flow with valid credentials");
  });

  it("includes YAML format instructions", () => {
    const prompt = buildGenerationPrompt(mockAnalysis, "test login");
    expect(prompt).toContain("```yaml");
    expect(prompt).toContain("valid ProwlQA YAML");
  });
});

describe("extractYamlFromResponse", () => {
  it("extracts YAML from fenced code block", () => {
    const response = `Here is the hunt file:
\`\`\`yaml
name: Login Test
steps:
  - navigate: "/login"
  - fill: { "Email": "user@test.com" }
\`\`\`
This hunt tests the login flow.`;

    const yaml = extractYamlFromResponse(response);
    expect(yaml).toContain("name: Login Test");
    expect(yaml).toContain("navigate:");
    expect(yaml).not.toContain("```");
    expect(yaml).not.toContain("This hunt tests");
  });

  it("extracts YAML from yml fence", () => {
    const response = `\`\`\`yml
steps:
  - navigate: "/"
\`\`\``;
    const yaml = extractYamlFromResponse(response);
    expect(yaml).toContain("navigate:");
  });

  it("returns raw response when no fences found", () => {
    const response = `steps:
  - navigate: "/"`;
    const yaml = extractYamlFromResponse(response);
    expect(yaml).toBe(response);
  });
});

describe("resolveAiConfig", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws when PROWL_AI_KEY is missing", () => {
    delete process.env.PROWL_AI_KEY;
    expect(() => resolveAiConfig()).toThrow("PROWL_AI_KEY");
  });

  it("defaults to anthropic provider", () => {
    process.env.PROWL_AI_KEY = "test-key";
    delete process.env.PROWL_AI_PROVIDER;
    const config = resolveAiConfig();
    expect(config.provider).toBe("anthropic");
    expect(config.model).toBe("claude-sonnet-4-5-20250929");
  });

  it("resolves openai provider", () => {
    process.env.PROWL_AI_KEY = "test-key";
    process.env.PROWL_AI_PROVIDER = "openai";
    const config = resolveAiConfig();
    expect(config.provider).toBe("openai");
    expect(config.model).toBe("gpt-4o");
  });

  it("uses custom model", () => {
    process.env.PROWL_AI_KEY = "test-key";
    process.env.PROWL_AI_MODEL = "claude-opus-4-6";
    const config = resolveAiConfig();
    expect(config.model).toBe("claude-opus-4-6");
  });

  it("throws on unsupported provider", () => {
    process.env.PROWL_AI_KEY = "test-key";
    process.env.PROWL_AI_PROVIDER = "gemini";
    expect(() => resolveAiConfig()).toThrow("Unsupported AI provider");
  });
});

describe("generateWithAi", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("calls Anthropic API correctly", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: "```yaml\nsteps:\n  - navigate: /\n```" }]
      })
    })) as unknown as typeof fetch;

    const result = await generateWithAi("test prompt", {
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250929",
      apiKey: "test-key"
    });

    expect(result).toContain("navigate");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-api-key": "test-key" })
      })
    );
  });

  it("calls OpenAI API correctly", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "```yaml\nsteps:\n  - navigate: /\n```" } }]
      })
    })) as unknown as typeof fetch;

    const result = await generateWithAi("test prompt", {
      provider: "openai",
      model: "gpt-4o",
      apiKey: "test-key"
    });

    expect(result).toContain("navigate");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-key" })
      })
    );
  });

  it("throws on API error", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => "Unauthorized"
    })) as unknown as typeof fetch;

    await expect(
      generateWithAi("test", {
        provider: "anthropic",
        model: "claude-sonnet-4-5-20250929",
        apiKey: "bad-key"
      })
    ).rejects.toThrow("Anthropic API error (401)");
  });
});
