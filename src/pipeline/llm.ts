import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";

const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

export type LLMMessage = {
  role: "user" | "assistant";
  content: string;
};

export type LLMStreamOptions = {
  systemPrompt: string;
  messages: LLMMessage[];
  signal: AbortSignal;
  onToken?: (token: string) => void;
};

/**
 * Stream a completion from Claude Haiku. Yields text deltas as they arrive.
 * Sentence boundaries are detected downstream in the pipeline for TTS chunking.
 */
export async function* streamCompletion(
  options: LLMStreamOptions
): AsyncGenerator<string> {
  const stream = client.messages.stream(
    {
      model: "claude-haiku-4-5-20251001",
      max_tokens: 120,
      system: [
        {
          type: "text",
          text: options.systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: options.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    },
    { signal: options.signal }
  );

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      const token = event.delta.text;
      options.onToken?.(token);
      yield token;
    }
  }
}
