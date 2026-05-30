// Voice Activity Detection — energy-based RMS implementation (16-bit PCM, 16 kHz, mono).

export type VADEvent =
  | { type: "speech_start" }
  | { type: "speech_end"; audioBuffer: Buffer };

export type VADProvider = {
  /** Feed a raw PCM chunk into the detector. */
  processChunk(chunk: Buffer): void;
  /** Subscribe to VAD events. */
  on(event: "speech_start" | "speech_end", listener: (e: VADEvent) => void): void;
  /** Release resources. */
  destroy(): void;
};

const SPEECH_THRESHOLD = 1200;  // RMS to enter speaking (real speech ≈ 1000–5000; noise floor ≈ 100–600)
const SILENCE_THRESHOLD = 600;  // RMS below which silence timer runs (must be < SPEECH_THRESHOLD)
const SILENCE_DURATION_MS = 500; // ms of sustained silence before speech_end fires
const MIN_SPEECH_MS = 600;       // discard bursts shorter than this (noise suppression)

function rms(chunk: Buffer): number {
  const samples = chunk.byteLength >> 1; // 2 bytes per sample
  if (samples === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const s = chunk.readInt16LE(i * 2);
    sum += s * s;
  }
  return Math.sqrt(sum / samples);
}

export function createVADProvider(): VADProvider {
  const listeners: Record<"speech_start" | "speech_end", Array<(e: VADEvent) => void>> = {
    speech_start: [],
    speech_end: [],
  };

  let speaking = false;
  let speechStartMs = 0;
  let accumulated: Buffer[] = [];
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;

  function emit(event: VADEvent): void {
    for (const listener of listeners[event.type]) {
      listener(event);
    }
  }

  function clearSilenceTimer(): void {
    if (silenceTimer !== null) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
  }

  function endSpeech(): void {
    silenceTimer = null;
    speaking = false;
    const audioBuffer = Buffer.concat(accumulated);
    accumulated = [];
    // Discard bursts that are too short to be real speech.
    if (Date.now() - speechStartMs < MIN_SPEECH_MS) return;
    emit({ type: "speech_end", audioBuffer });
  }

  return {
    processChunk(chunk: Buffer): void {
      const energy = rms(chunk);

      if (!speaking) {
        if (energy > SPEECH_THRESHOLD) {
          speaking = true;
          speechStartMs = Date.now();
          accumulated = [chunk];
          emit({ type: "speech_start" });
        }
      } else {
        accumulated.push(chunk);

        if (energy < SILENCE_THRESHOLD) {
          // Start or reset the silence timer only if not already running.
          if (silenceTimer === null) {
            silenceTimer = setTimeout(endSpeech, SILENCE_DURATION_MS);
          }
        } else {
          // Voice activity detected — cancel pending silence timeout.
          clearSilenceTimer();
        }
      }
    },

    on(event: "speech_start" | "speech_end", listener: (e: VADEvent) => void): void {
      listeners[event].push(listener);
    },

    destroy(): void {
      clearSilenceTimer();
      listeners.speech_start = [];
      listeners.speech_end = [];
      accumulated = [];
    },
  };
}
