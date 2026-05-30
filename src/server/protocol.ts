import { z } from "zod";

// ── Inbound messages (client → server) ──────────────────────────────────────

export const AudioChunkSchema = z.object({
  type: z.literal("audio_chunk"),
  data: z.string(), // base64-encoded PCM
  sampleRate: z.number().int().positive(),
});

export const StartSessionSchema = z.object({
  type: z.literal("start_session"),
  sessionId: z.string().uuid(),
  language: z.enum(["english", "hindi", "hinglish"]).default("english"),
});

export const EndSessionSchema = z.object({
  type: z.literal("end_session"),
  sessionId: z.string().uuid(),
});

export const InterruptSchema = z.object({
  type: z.literal("interrupt"),
  sessionId: z.string().uuid(),
});

export const InboundMessageSchema = z.discriminatedUnion("type", [
  AudioChunkSchema,
  StartSessionSchema,
  EndSessionSchema,
  InterruptSchema,
]);

export type AudioChunk = z.infer<typeof AudioChunkSchema>;
export type StartSession = z.infer<typeof StartSessionSchema>;
export type EndSession = z.infer<typeof EndSessionSchema>;
export type Interrupt = z.infer<typeof InterruptSchema>;
export type InboundMessage = z.infer<typeof InboundMessageSchema>;

// ── Outbound messages (server → client) ─────────────────────────────────────

export type SessionStarted = {
  type: "session_started";
  sessionId: string;
};

export type TranscriptPartial = {
  type: "transcript_partial";
  text: string;
  turnId: string;
};

export type TranscriptFinal = {
  type: "transcript_final";
  text: string;
  turnId: string;
};

export type AudioOut = {
  type: "audio_out";
  data: string; // base64-encoded PCM
  turnId: string;
};

export type AgentTextDelta = {
  type: "agent_text_delta";
  text: string;
  turnId: string;
};

export type AgentStateChange = {
  type: "agent_state_change";
  state: "IDLE" | "OPENING" | "MAIN" | "CLOSING" | "INTERRUPTED";
};

export type TurnComplete = {
  type: "turn_complete";
  turnId: string;
  latencyMs: number;
};

export type ErrorMessage = {
  type: "error";
  code: string;
  message: string;
};

export type OutboundMessage =
  | SessionStarted
  | TranscriptPartial
  | TranscriptFinal
  | AudioOut
  | AgentTextDelta
  | AgentStateChange
  | TurnComplete
  | ErrorMessage;
