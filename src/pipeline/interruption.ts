import type { Session } from "../server/session.js";

export type InterruptionHandlers = {
  abortTts: () => void;
  abortLlm: () => void;
  restartPipeline: () => Promise<void>;
};

/**
 * Handle a barge-in or interruption event.
 *
 * Order MUST be: abort TTS → abort LLM → restart pipeline.
 *
 * Why this order matters:
 *   1. Abort TTS first — stops audio playback immediately so the agent
 *      doesn't keep talking over the user. If we aborted LLM first, the TTS
 *      stream already in-flight would keep draining to the speaker.
 *   2. Abort LLM second — cancels any in-flight streaming completion. Safe to
 *      do now because TTS is already stopped.
 *   3. Restart pipeline last — resets AbortControllers and re-arms VAD. If we
 *      restarted first, the new AbortController would immediately get the old
 *      abort signal and we'd have a race on the first utterance of the new turn.
 */
export async function handleInterruption(
  session: Session,
  handlers: InterruptionHandlers
): Promise<void> {
  // Step 1: Stop audio output immediately.
  handlers.abortTts();

  // Step 2: Cancel the LLM stream.
  handlers.abortLlm();

  // Step 3: Reset pipeline state and re-arm for the new utterance.
  await handlers.restartPipeline();

  // Reset the per-session AbortController so the next utterance starts clean.
  session.abortController = new AbortController();
}
