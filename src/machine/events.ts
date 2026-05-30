// XState event definitions for the conversation machine.
// Only the Intent Extractor (src/machine/intent.ts) should emit these —
// never emit them from LLM response text.

export type UserSpeechStarted = { type: "USER_SPEECH_STARTED" };
export type UserSpeechEnded = { type: "USER_SPEECH_ENDED"; transcript: string };
export type PartialTranscript = { type: "PARTIAL_TRANSCRIPT"; text: string };
export type AgentResponseComplete = { type: "AGENT_RESPONSE_COMPLETE" };
export type OpeningComplete = { type: "OPENING_COMPLETE" };
export type ClosingTriggered = { type: "CLOSING_TRIGGERED" };
export type SessionEnded = { type: "SESSION_ENDED" };
export type Interrupted = { type: "INTERRUPTED" };
export type ResumeAfterInterrupt = { type: "RESUME_AFTER_INTERRUPT" };

export type ConversationEvent =
  | UserSpeechStarted
  | UserSpeechEnded
  | PartialTranscript
  | AgentResponseComplete
  | OpeningComplete
  | ClosingTriggered
  | SessionEnded
  | Interrupted
  | ResumeAfterInterrupt;
