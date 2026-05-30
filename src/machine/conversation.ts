import { createMachine, assign } from "xstate";
import type { ConversationEvent } from "./events.js";

export type ConversationState =
  | "IDLE"
  | "OPENING"
  | "MAIN"
  | "CLOSING"
  | "INTERRUPTED";

export type ConversationContext = {
  sessionId: string;
  turnCount: number;
  lastActiveState: ConversationState;
  partialTranscript: string;
};

export type ConversationMachineInput = {
  sessionId: string;
};

export const conversationMachine = createMachine(
  {
    id: "conversation",
    types: {
      context: {} as ConversationContext,
      events: {} as ConversationEvent,
      input: {} as ConversationMachineInput,
    },
    context: ({ input }) => ({
      sessionId: input.sessionId,
      turnCount: 0,
      lastActiveState: "IDLE" as ConversationState,
      partialTranscript: "",
    }),
    initial: "IDLE",
    states: {
      IDLE: {
        entry: assign({ lastActiveState: "IDLE" }),
        on: {
          USER_SPEECH_STARTED: { target: "OPENING" },
        },
      },
      OPENING: {
        entry: assign({ lastActiveState: "OPENING" }),
        on: {
          OPENING_COMPLETE: { target: "MAIN" },
          INTERRUPTED: { target: "INTERRUPTED" },
          USER_SPEECH_ENDED: {
            actions: assign({ turnCount: ({ context }) => context.turnCount + 1 }),
          },
          PARTIAL_TRANSCRIPT: {
            actions: assign({ partialTranscript: ({ event }) => event.text }),
          },
        },
      },
      MAIN: {
        entry: assign({ lastActiveState: "MAIN" }),
        on: {
          USER_SPEECH_STARTED: { target: "INTERRUPTED" },
          USER_SPEECH_ENDED: {
            actions: assign({ turnCount: ({ context }) => context.turnCount + 1 }),
          },
          PARTIAL_TRANSCRIPT: {
            actions: assign({ partialTranscript: ({ event }) => event.text }),
          },
          AGENT_RESPONSE_COMPLETE: { target: "IDLE" },
          CLOSING_TRIGGERED: { target: "CLOSING" },
          INTERRUPTED: { target: "INTERRUPTED" },
        },
      },
      CLOSING: {
        entry: assign({ lastActiveState: "CLOSING" }),
        on: {
          AGENT_RESPONSE_COMPLETE: { target: "IDLE" },
          INTERRUPTED: { target: "INTERRUPTED" },
          SESSION_ENDED: { target: "IDLE" },
        },
      },
      INTERRUPTED: {
        entry: assign({ lastActiveState: "INTERRUPTED" }),
        on: {
          RESUME_AFTER_INTERRUPT: [
            {
              guard: ({ context }) => context.lastActiveState === "OPENING",
              target: "OPENING",
            },
            {
              guard: ({ context }) => context.lastActiveState === "MAIN",
              target: "MAIN",
            },
            { target: "IDLE" },
          ],
          SESSION_ENDED: { target: "IDLE" },
        },
      },
    },
  }
);
