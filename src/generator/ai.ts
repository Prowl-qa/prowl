export type AiProvider = "anthropic" | "openai";

export type AiConfig = {
  provider: AiProvider;
  model: string;
  apiKey: string;
};

export function resolveAiConfig(): AiConfig {
  const provider = (process.env.PROWL_AI_PROVIDER ?? "anthropic") as AiProvider;
  if (provider !== "anthropic" && provider !== "openai") {
    throw new Error(`Unsupported AI provider: ${provider}. Use "anthropic" or "openai".`);
  }

  const apiKey = process.env.PROWL_AI_KEY;
  if (!apiKey) {
    throw new Error(
      "PROWL_AI_KEY environment variable is required. Set it to your Anthropic or OpenAI API key."
    );
  }

  const defaultModel = provider === "anthropic"
    ? "claude-sonnet-4-5-20250929"
    : "gpt-4o";
  const model = process.env.PROWL_AI_MODEL ?? defaultModel;

  return { provider, model, apiKey };
}

export async function generateWithAi(prompt: string, config: AiConfig): Promise<string> {
  if (config.provider === "anthropic") {
    return generateWithAnthropic(prompt, config);
  }
  return generateWithOpenAi(prompt, config);
}

async function generateWithAnthropic(prompt: string, config: AiConfig): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 4096,
      messages: [
        { role: "user", content: prompt }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${body}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text?: string }>;
  };

  const textBlock = data.content.find((c) => c.type === "text");
  if (!textBlock?.text) {
    throw new Error("Anthropic API returned no text content");
  }

  return textBlock.text;
}

async function generateWithOpenAi(prompt: string, config: AiConfig): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "user", content: prompt }
      ],
      max_tokens: 4096
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${body}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
  };

  if (!data.choices?.[0]?.message?.content) {
    throw new Error("OpenAI API returned no content");
  }

  return data.choices[0].message.content;
}
