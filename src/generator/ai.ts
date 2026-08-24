export type AiProvider = "anthropic" | "openai";

export type AiConfig = {
  provider: AiProvider;
  model: string;
  apiKey: string;
  /**
   * API root the request is sent to (no trailing slash, no path). When omitted,
   * falls back to the provider's public API. Set via `PROWL_AI_BASE_URL` so a
   * self-hosted gateway or (later) a managed Prowl proxy can slot in without
   * code changes.
   */
  baseUrl?: string;
};

const DEFAULT_BASE_URL: Record<AiProvider, string> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com"
};

const AI_REQUEST_TIMEOUT_MS = 30000;

type ProviderLabel = "Anthropic" | "OpenAI";

type AnthropicTextResponse = {
  content?: Array<{ type: string; text?: string }>;
};

type OpenAiTextResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

/** The API root for a config, defaulting to the provider's public endpoint. */
function apiRoot(config: AiConfig): string {
  return config.baseUrl ?? DEFAULT_BASE_URL[config.provider];
}

function defaultModelFor(provider: AiProvider): string {
  return provider === "anthropic" ? "claude-sonnet-4-5-20250929" : "gpt-4o";
}

/**
 * Resolve the provider/model/base-url from the environment WITHOUT requiring a
 * key. Returns the partial shape plus the (possibly undefined) key so callers
 * can decide whether a missing key is fatal (generation) or a graceful skip
 * (`assertWithAI`). Throws only on an unsupported provider — a genuine
 * misconfiguration that no caller should silently swallow.
 */
function resolveAiEnv(): { provider: AiProvider; model: string; baseUrl: string; apiKey: string | undefined } {
  const provider = (process.env.PROWL_AI_PROVIDER ?? "anthropic") as AiProvider;
  if (provider !== "anthropic" && provider !== "openai") {
    throw new Error(`Unsupported AI provider: ${provider}. Use "anthropic" or "openai".`);
  }

  const model = process.env.PROWL_AI_MODEL ?? defaultModelFor(provider);
  const baseUrl = normalizeBaseUrl(process.env.PROWL_AI_BASE_URL) ?? DEFAULT_BASE_URL[provider];

  return { provider, model, baseUrl, apiKey: process.env.PROWL_AI_KEY };
}

function normalizeBaseUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveAiConfig(): AiConfig {
  const env = resolveAiEnv();
  if (!env.apiKey) {
    throw new Error(
      "PROWL_AI_KEY environment variable is required. Set it to your Anthropic or OpenAI API key."
    );
  }
  return { provider: env.provider, model: env.model, apiKey: env.apiKey, baseUrl: env.baseUrl };
}

/**
 * Like {@link resolveAiConfig} but returns `null` when no API key is configured
 * instead of throwing. Used by BYOK-optional features (e.g. `assertWithAI`) that
 * must degrade gracefully — skip with a warning — rather than fail the run when
 * the operator has not opted into AI. Forward-compatible with a future managed
 * credit path (BIZ-002): a later resolution step can return a config here even
 * when `PROWL_AI_KEY` is unset, and every caller picks it up unchanged.
 */
export function tryResolveAiConfig(): AiConfig | null {
  const env = resolveAiEnv();
  if (!env.apiKey) {
    return null;
  }
  return { provider: env.provider, model: env.model, apiKey: env.apiKey, baseUrl: env.baseUrl };
}

export async function generateWithAi(prompt: string, config: AiConfig): Promise<string> {
  if (config.provider === "anthropic") {
    return generateWithAnthropic(prompt, config);
  }
  return generateWithOpenAi(prompt, config);
}

async function generateWithAnthropic(prompt: string, config: AiConfig): Promise<string> {
  const data = await postJson<AnthropicTextResponse>(
    "Anthropic",
    `${apiRoot(config)}/v1/messages`,
    anthropicHeaders(config),
    {
      model: config.model,
      max_tokens: 4096,
      messages: [
        { role: "user", content: prompt }
      ]
    }
  );

  return extractAnthropicText(data);
}

async function generateWithOpenAi(prompt: string, config: AiConfig): Promise<string> {
  const data = await postJson<OpenAiTextResponse>(
    "OpenAI",
    `${apiRoot(config)}/v1/chat/completions`,
    openAiHeaders(config),
    {
      model: config.model,
      messages: [
        { role: "user", content: prompt }
      ],
      max_tokens: 4096
    }
  );

  return extractOpenAiText(data);
}

// --- Vision assertions (assertWithAI) -------------------------------------

/** A screenshot plus the natural-language claim to check against it. */
export type AiVisionInput = {
  /** Base64-encoded image bytes (no data: URI prefix). */
  imageBase64: string;
  /** MIME type of the image, e.g. "image/png". */
  mediaType: string;
  /** The natural-language assertion the model must judge. */
  assertion: string;
};

/** The model's verdict on a vision assertion. */
export type AiVisionVerdict = {
  pass: boolean;
  reason: string;
};

/**
 * Build the vision prompt. The model is instructed to return a strict,
 * machine-parseable JSON verdict so the runner never has to interpret prose.
 */
export function buildVisionPrompt(assertion: string): string {
  return [
    "You are a meticulous QA reviewer. You are given a screenshot of an application",
    "and a single assertion describing what should be true about it.",
    "",
    "Assertion:",
    assertion,
    "",
    "Decide whether the assertion holds for the screenshot. Judge ONLY what is",
    "visible; do not assume behavior you cannot see. Be strict: if the assertion",
    "is not clearly satisfied, it fails.",
    "",
    'Reply with ONLY a single JSON object on one line, no markdown, no code fences:',
    '{"pass": <true|false>, "reason": "<one concise sentence explaining the verdict>"}'
  ].join("\n");
}

/**
 * Parse the model's raw text into a verdict. Robust to the model wrapping the
 * JSON in prose or ```json fences, but treats genuinely unparseable output as an
 * ERROR — never a silent pass. That keeps a confused/misbehaving model from
 * quietly greenlighting a broken screen.
 */
export function parseVisionVerdict(raw: string): AiVisionVerdict {
  const cleaned = stripCodeFences(raw).trim();

  // Prefer a full-string parse; fall back to the widest {...} span so leading or
  // trailing prose ("Here is my verdict: {...}") still parses.
  const candidate = extractJsonObject(cleaned);
  if (candidate === null) {
    throw new Error(
      `Could not parse a JSON verdict from the AI response: ${truncateForError(raw)}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new Error(
      `AI verdict was not valid JSON: ${truncateForError(raw)}`
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`AI verdict was not a JSON object: ${truncateForError(raw)}`);
  }

  const record = parsed as Record<string, unknown>;
  if (typeof record.pass !== "boolean") {
    throw new Error(
      `AI verdict is missing a boolean "pass" field: ${truncateForError(raw)}`
    );
  }
  const reason = typeof record.reason === "string" && record.reason.trim().length > 0
    ? record.reason.trim()
    : (record.pass ? "Assertion satisfied." : "Assertion not satisfied.");

  return { pass: record.pass, reason };
}

function stripCodeFences(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fence ? fence[1] : text;
}

function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    return null;
  }
  return trimmed.slice(first, last + 1);
}

function truncateForError(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > 200 ? `${collapsed.slice(0, 199)}…` : collapsed;
}

/**
 * Send a screenshot + assertion to a vision-capable model and return its
 * pass/fail verdict with an explanation. Implemented for both providers via raw
 * `fetch` (no SDKs). Temperature is pinned to 0 for the most deterministic
 * verdict the model can give — AI assertions are inherently non-deterministic,
 * so we minimize the variance and always surface the explanation for audit.
 */
export async function assertWithAiVision(
  input: AiVisionInput,
  config: AiConfig
): Promise<AiVisionVerdict> {
  const raw = config.provider === "anthropic"
    ? await visionWithAnthropic(input, config)
    : await visionWithOpenAi(input, config);
  return parseVisionVerdict(raw);
}

async function visionWithAnthropic(input: AiVisionInput, config: AiConfig): Promise<string> {
  const data = await postJson<AnthropicTextResponse>(
    "Anthropic",
    `${apiRoot(config)}/v1/messages`,
    anthropicHeaders(config),
    {
      model: config.model,
      max_tokens: 1024,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: input.mediaType,
                data: input.imageBase64
              }
            },
            { type: "text", text: buildVisionPrompt(input.assertion) }
          ]
        }
      ]
    }
  );

  return extractAnthropicText(data);
}

async function visionWithOpenAi(input: AiVisionInput, config: AiConfig): Promise<string> {
  const data = await postJson<OpenAiTextResponse>(
    "OpenAI",
    `${apiRoot(config)}/v1/chat/completions`,
    openAiHeaders(config),
    {
      model: config.model,
      max_tokens: 1024,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: buildVisionPrompt(input.assertion) },
            {
              type: "image_url",
              image_url: { url: `data:${input.mediaType};base64,${input.imageBase64}` }
            }
          ]
        }
      ]
    }
  );

  return extractOpenAiText(data);
}

async function postJson<T>(
  provider: ProviderLabel,
  url: string,
  headers: Record<string, string>,
  body: unknown
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS)
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(`${provider} API error (${response.status}): ${responseBody}`);
  }

  return await response.json() as T;
}

function anthropicHeaders(config: AiConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-api-key": config.apiKey,
    "anthropic-version": "2023-06-01"
  };
}

function openAiHeaders(config: AiConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${config.apiKey}`
  };
}

function extractAnthropicText(data: AnthropicTextResponse): string {
  const textBlock = data.content?.find((c) => c.type === "text");
  if (!textBlock?.text) {
    throw new Error("Anthropic API returned no text content");
  }

  return textBlock.text;
}

function extractOpenAiText(data: OpenAiTextResponse): string {
  if (!data.choices?.[0]?.message?.content) {
    throw new Error("OpenAI API returned no content");
  }

  return data.choices[0].message.content;
}
