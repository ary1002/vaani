// ASR provider interface + Deepgram implementation.
// Every provider MUST implement ASRProvider. No provider-specific logic in pipeline code.

import WebSocket from "ws";

export type PartialTranscript = {
  type: "partial";
  text: string;
  confidence: number;
};

export type FinalTranscript = {
  type: "final";
  text: string;
  confidence: number;
  durationMs: number;
};

export type ASRTranscript = PartialTranscript | FinalTranscript;

export type ASRProvider = {
  /**
   * Begin streaming audio. Calls onPartial with interim results as they arrive —
   * do NOT wait for final before forwarding to LLM.
   */
  startStream(
    onPartial: (t: PartialTranscript) => void,
    onFinal: (t: FinalTranscript) => void,
    signal: AbortSignal
  ): Promise<{ sendChunk: (chunk: Buffer) => void; close: () => Promise<void> }>;

  /** Provider name for logging. */
  readonly name: string;
};

// ── Deepgram ─────────────────────────────────────────────────────────────────

// One-shot stream: open, send audio, close, get final.
const DEEPGRAM_URL =
  "wss://api.deepgram.com/v1/listen" +
  "?model=nova-3&interim_results=true&encoding=linear16&sample_rate=16000&channels=1";

// Continuous stream: open once per session, audio flows in forever.
// endpointing=500   — Deepgram's own VAD: declares is_final after 500ms silence.
// vad_events=true   — emits SpeechStarted events so we can update UI state.
// utterance_end_ms  — fires UtteranceEnd after 1000ms silence, marking turn end.
const DEEPGRAM_CONTINUOUS_URL =
  "wss://api.deepgram.com/v1/listen" +
  "?model=nova-3&interim_results=true&encoding=linear16&sample_rate=16000&channels=1" +
  "&endpointing=300&vad_events=true";

export type ContinuousStreamCallbacks = {
  onPartial:      (t: PartialTranscript) => void;
  onFinal:        (t: FinalTranscript) => void;
  onSpeechStart:  () => void;
  /** Fired when Deepgram detects end-of-utterance. fullText is all is_final sentences joined. */
  onUtteranceEnd: (fullText: string) => void;
};

type DeepgramMessage = {
  type: string;
  is_final: boolean;
  duration?: number;
  channel: {
    alternatives: Array<{ transcript: string; confidence: number }>;
  };
};

export class DeepgramASR implements ASRProvider {
  readonly name = "deepgram";

  constructor(private readonly apiKey: string) {}

  async startStream(
    onPartial: (t: PartialTranscript) => void,
    onFinal: (t: FinalTranscript) => void,
    signal: AbortSignal
  ): Promise<{ sendChunk: (chunk: Buffer) => void; close: () => Promise<void> }> {
    const ws = new WebSocket(DEEPGRAM_URL, {
      headers: { Authorization: `Token ${this.apiKey}` },
    });

    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });

    let active = true;

    ws.on("message", (data) => {
      if (!active) return;
      let msg: DeepgramMessage;
      try {
        msg = JSON.parse(data.toString()) as DeepgramMessage;
      } catch {
        return;
      }
      if (msg.type !== "Results") return;
      const alt = msg.channel?.alternatives?.[0];
      if (alt === undefined || alt.transcript === "") return;

      if (msg.is_final) {
        onFinal({
          type: "final",
          text: alt.transcript,
          confidence: alt.confidence,
          durationMs: (msg.duration ?? 0) * 1000,
        });
      } else {
        onPartial({
          type: "partial",
          text: alt.transcript,
          confidence: alt.confidence,
        });
      }
    });

    const doClose = () => {
      active = false;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };

    // Abort: close the socket and stop forwarding events.
    signal.addEventListener("abort", doClose, { once: true });

    const sendChunk = (chunk: Buffer): void => {
      if (active && ws.readyState === WebSocket.OPEN) {
        ws.send(chunk);
      }
    };

    const close = (): Promise<void> => {
      if (!active) return Promise.resolve();
      signal.removeEventListener("abort", doClose);
      active = false;
      return new Promise<void>((resolve) => {
        if (ws.readyState === WebSocket.CLOSED) {
          resolve();
          return;
        }
        ws.once("close", () => resolve());
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      });
    };

    return { sendChunk, close };
  }

  /**
   * Open a persistent Deepgram stream for the lifetime of a session.
   * Audio flows in continuously; Deepgram's acoustic VAD fires the callbacks.
   * Use this instead of startStream + a local energy-based VAD.
   */
  startContinuousStream(
    callbacks: ContinuousStreamCallbacks,
    signal: AbortSignal
  ): Promise<{ sendChunk: (chunk: Buffer) => void; close: () => Promise<void> }> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(DEEPGRAM_CONTINUOUS_URL, {
        headers: { Authorization: `Token ${this.apiKey}` },
      });

      ws.once("error", reject);
      ws.once("open", () => {
        let active = true;
        let utteranceBuffer: string[] = [];
        // Debounce: fire onUtteranceEnd 200ms after the last is_final sentence.
        // Combined with endpointing=300, total silence detection ≈ 500ms.
        let debounceTimer: ReturnType<typeof setTimeout> | null = null;

        const flushUtterance = () => {
          debounceTimer = null;
          const fullText = utteranceBuffer.join(" ").trim();
          utteranceBuffer = [];
          if (fullText) callbacks.onUtteranceEnd(fullText);
        };

        ws.on("message", (data) => {
          if (!active) return;
          let msg: DeepgramMessage & { type: string };
          try { msg = JSON.parse(data.toString()) as DeepgramMessage & { type: string }; }
          catch { return; }

          if (msg.type === "SpeechStarted") {
            // New speech started — cancel any pending flush from a previous pause.
            if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
            callbacks.onSpeechStart();
            return;
          }

          if (msg.type !== "Results") return;
          const alt = msg.channel?.alternatives?.[0];
          if (!alt || alt.transcript === "") return;

          if (msg.is_final) {
            utteranceBuffer.push(alt.transcript);
            callbacks.onFinal({
              type: "final",
              text: alt.transcript,
              confidence: alt.confidence,
              durationMs: (msg.duration ?? 0) * 1000,
            });
            // Reset debounce — wait 200ms after the last final before triggering.
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(flushUtterance, 200);
          } else {
            callbacks.onPartial({
              type: "partial",
              text: alt.transcript,
              confidence: alt.confidence,
            });
          }
        });

        const doClose = () => {
          active = false;
          if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
            ws.close();
        };

        signal.addEventListener("abort", doClose, { once: true });

        resolve({
          sendChunk: (chunk: Buffer) => {
            if (active && ws.readyState === WebSocket.OPEN) ws.send(chunk);
          },
          close: () => {
            if (!active) return Promise.resolve();
            signal.removeEventListener("abort", doClose);
            active = false;
            return new Promise<void>((res) => {
              if (ws.readyState === WebSocket.CLOSED) { res(); return; }
              ws.once("close", () => res());
              if (ws.readyState === WebSocket.OPEN) ws.close();
            });
          },
        });
      });
    });
  }
}
