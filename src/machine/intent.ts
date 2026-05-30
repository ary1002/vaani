import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import type { ConversationEvent } from "./events.js";

const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

export type IntentInput = {
  transcript: string;
  currentState: string;
};

const EXTRACT_INTENT_TOOL: Anthropic.Tool = {
  name: "extract_intent",
  description: "Extract the XState event to fire based on the transcript and current conversation state.",
  input_schema: {
    type: "object" as const,
    properties: {
      event_type: {
        type: "string",
        enum: [
          "USER_SPEECH_STARTED",
          "USER_SPEECH_ENDED",
          "PARTIAL_TRANSCRIPT",
          "AGENT_RESPONSE_COMPLETE",
          "OPENING_COMPLETE",
          "CLOSING_TRIGGERED",
          "SESSION_ENDED",
          "INTERRUPTED",
          "RESUME_AFTER_INTERRUPT",
        ],
        description: "The XState event type to fire next.",
      },
    },
    required: ["event_type"],
  },
};

export async function extractIntent(input: IntentInput): Promise<ConversationEvent> {
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 128,
    tools: [EXTRACT_INTENT_TOOL],
    tool_choice: { type: "any" },
    system:
      "You are an intent classifier for a voice agent state machine. " +
      "Given a transcript and the current state, return the single most appropriate XState event. " +
      "CLOSING_TRIGGERED: user says goodbye/thank you/done. " +
      "SESSION_ENDED: user explicitly ends the session. " +
      "AGENT_RESPONSE_COMPLETE: agent has finished its turn. " +
      "OPENING_COMPLETE: opening pleasantries are done, main task begins. " +
      "USER_SPEECH_ENDED: normal end of a user utterance. " +
      "INTERRUPTED: user interrupts the agent mid-speech.",
    messages: [
      {
        role: "user",
        content: `Current state: ${input.currentState}\nTranscript: "${input.transcript}"\n\nCall extract_intent.`,
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("extractIntent: model did not call extract_intent tool");
  }

  const data = toolUse.input as Record<string, unknown>;
  const eventType = String(data["event_type"] ?? "USER_SPEECH_ENDED");

  switch (eventType) {
    case "USER_SPEECH_STARTED":    return { type: "USER_SPEECH_STARTED" };
    case "USER_SPEECH_ENDED":      return { type: "USER_SPEECH_ENDED", transcript: input.transcript };
    case "PARTIAL_TRANSCRIPT":     return { type: "PARTIAL_TRANSCRIPT", text: input.transcript };
    case "AGENT_RESPONSE_COMPLETE":return { type: "AGENT_RESPONSE_COMPLETE" };
    case "OPENING_COMPLETE":       return { type: "OPENING_COMPLETE" };
    case "CLOSING_TRIGGERED":      return { type: "CLOSING_TRIGGERED" };
    case "SESSION_ENDED":          return { type: "SESSION_ENDED" };
    case "INTERRUPTED":            return { type: "INTERRUPTED" };
    case "RESUME_AFTER_INTERRUPT": return { type: "RESUME_AFTER_INTERRUPT" };
    default:                       return { type: "USER_SPEECH_ENDED", transcript: input.transcript };
  }
}
