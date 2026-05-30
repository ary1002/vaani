// TTS provider interface + ElevenLabs implementation.
// Every provider MUST implement TTSProvider. No provider-specific logic in pipeline code.

import fetch from "node-fetch";
import WebSocket from "ws";

export type TTSOptions = {
  voice?: string;
  speed?: number;
};

export type TTSProvider = {
  /**
   * Stream TTS audio for the given text.
   * Yields PCM audio buffers — sentence by sentence, NOT the full response.
   * Sentence-boundary streaming is intentional: first chunk arrives before
   * the full response is generated.
   */
  stream(
    text: string,
    options: TTSOptions,
    signal: AbortSignal
  ): AsyncIterable<Buffer>;

  /** Provider name for logging. */
  readonly name: string;
};

// ── ElevenLabs stub ──────────────────────────────────────────────────────────

export class ElevenLabsTTS implements TTSProvider {
  readonly name = "elevenlabs";

  constructor(
    private readonly apiKey: string,
    private readonly voiceId: string = "21m00Tcm4TlvDq8ikWAM" // Rachel
  ) {}

  /**
   * Stream all sentences of one agent utterance over a single WebSocket.
   * Sentences are consumed from `sentences` as the LLM produces them;
   * audio chunks are yielded as ElevenLabs sends them — both happen concurrently,
   * so TTS is already returning audio for sentence 1 while LLM generates sentence 2.
   */
  async *streamUtterance(
    sentences: AsyncIterable<string>,
    options: TTSOptions,
    signal: AbortSignal
  ): AsyncIterable<Buffer> {
    const voiceId = options.voice ?? this.voiceId;
    const url =
      `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input` +
      `?model_id=eleven_turbo_v2&output_format=pcm_24000`;

    const ws = new WebSocket(url, { headers: { "xi-api-key": this.apiKey } });

    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });

    if (signal.aborted) { ws.close(); throw new DOMException("Aborted", "AbortError"); }

    // BOS: open the ElevenLabs generation pipeline.
    ws.send(JSON.stringify({
      text: " ",
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      try_trigger_generation: false,
    }));

    // Bridge WS events → async generator via a simple chunk queue.
    const chunks: Buffer[] = [];
    let streamDone = false;
    let wsError: Error | null = null;
    let notify: (() => void) | null = null;
    const wake = () => { const r = notify; notify = null; r?.(); };

    ws.on("message", (raw) => {
      let msg: { audio?: string | null; isFinal?: boolean };
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.audio) { chunks.push(Buffer.from(msg.audio, "base64")); wake(); }
      if (msg.isFinal) { streamDone = true; wake(); }
    });
    ws.on("error", (err) => { wsError = err as Error; streamDone = true; wake(); });
    ws.on("close", ()  => { streamDone = true; wake(); });

    const onAbort = () => { ws.close(); streamDone = true; wake(); };
    signal.addEventListener("abort", onAbort, { once: true });

    // Feed sentences to ElevenLabs as the LLM produces them (runs concurrently).
    const sender = (async () => {
      for await (const sentence of sentences) {
        if (signal.aborted || ws.readyState !== WebSocket.OPEN) break;
        ws.send(JSON.stringify({ text: sentence + " ", try_trigger_generation: true }));
      }
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ text: "" })); // EOS — flush remaining audio
      }
    })();

    try {
      while (!streamDone || chunks.length > 0) {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        if (chunks.length > 0) { yield chunks.shift()!; continue; }
        await new Promise<void>(r => { notify = r; });
      }
      if (wsError) throw wsError;
    } finally {
      signal.removeEventListener("abort", onAbort);
      await sender.catch(() => {});
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
        ws.close();
    }
  }

  async *stream(
    text: string,
    options: TTSOptions,
    signal: AbortSignal
  ): AsyncIterable<Buffer> {
    const voiceId = options.voice ?? this.voiceId;
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=pcm_24000`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
      signal: signal as unknown as Parameters<typeof fetch>[1] extends { signal?: infer S } ? S : never,
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs TTS error: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error("ElevenLabs TTS error: response body is null");
    }

    for await (const chunk of response.body) {
      if (signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as unknown as Uint8Array);
    }
  }
}
