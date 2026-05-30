import Fastify from "fastify";
import websocketPlugin from "@fastify/websocket";
import staticPlugin from "@fastify/static";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { InboundMessageSchema } from "./protocol.js";
import { createSession, getSession, destroySession } from "./session.js";
import { DeepgramASR } from "../pipeline/asr.js";
import { ElevenLabsTTS } from "../pipeline/tts.js";
import { streamCompletion } from "../pipeline/llm.js";
import { handleInterruption } from "../pipeline/interruption.js";
import { config } from "../config.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const app = Fastify({ logger: true });

await app.register(websocketPlugin);
await app.register(staticPlugin, {
  root: join(__dirname, "../../public"),
  prefix: "/",
});

// A push-based async iterable queue — bridges the LLM token loop (producer)
// to the TTS WebSocket sender (consumer) running concurrently.
function createQueue<T>() {
  const buf: Array<T | null> = [];
  let wake: (() => void) | null = null;
  const notify = () => { const r = wake; wake = null; r?.(); };
  return {
    push(item: T)  { buf.push(item);  notify(); },
    end()          { buf.push(null);  notify(); },
    async *[Symbol.asyncIterator](): AsyncGenerator<T> {
      while (true) {
        while (buf.length > 0) {
          const item = buf.shift()!;
          if (item === null) return;
          yield item;
        }
        await new Promise<void>(r => { wake = r; });
      }
    },
  };
}

const SYSTEM_PROMPT = readFileSync(
  join(__dirname, "../../prompts/agent-v2.md"),
  "utf8"
);
const SENTENCE_BOUNDARY_RE = /(?<=[.!?])(\s+|$)/;

interface WebSocketMessageEvent {
  toString(): string;
}

interface ActiveStream {
  sendChunk(chunk: Buffer): void;
  close(): Promise<void>;
}

interface ConnectionState {
  // One persistent Deepgram stream per session; audio flows in continuously.
  deepgramStream: ActiveStream | null;
}

app.get("/ws", { websocket: true }, (socket, _req) => {
  app.log.info("WebSocket client connected");

  const connectionState = new Map<string, ConnectionState>();

  function send(data: object): void {
    (socket as unknown as { send(data: string): void }).send(JSON.stringify(data));
  }

  function sendError(code: string, message: string): void {
    send({ type: "error", code, message });
  }

  // ── LLM → TTS pipeline ─────────────────────────────────────────────────────
  // Called after ASR delivers a final transcript. Does not touch ASR at all.
  async function runLlmTts(
    sessionId: string,
    transcript: string,
    turnId: string,
    speechEndTime: number,
    asrFinalTime: number,
  ): Promise<void> {
    const session = getSession(sessionId);
    if (!session) { sendError("NO_SESSION", `Session ${sessionId} not found`); return; }

    const { signal } = session.abortController;
    const tts = new ElevenLabsTTS(config.ELEVENLABS_API_KEY);

    let llmFirstTokenTime = 0;
    let firstAudioTime = 0;
    let sentenceCount = 0;

    try {
      const sentenceQueue = createQueue<string>();

      // ── LLM → sentence queue (producer) ────────────────────────────────────
      // Runs concurrently with TTS so ElevenLabs starts generating audio for
      // sentence N while Claude is still writing sentence N+1.
      const llmTask = (async () => {
        let tokenBuffer = "";
        for await (const token of streamCompletion({
          systemPrompt: SYSTEM_PROMPT,
          messages: [{ role: "user", content: transcript }],
          signal,
        })) {
          if (!llmFirstTokenTime) {
            llmFirstTokenTime = Date.now();
            app.log.info({ turnId, latencyMs: llmFirstTokenTime - speechEndTime }, "LLM first token");
          }
          send({ type: "agent_text_delta", text: token, turnId });

          tokenBuffer += token;
          const parts = tokenBuffer.split(SENTENCE_BOUNDARY_RE);
          let i = 0;
          while (i + 1 < parts.length) {
            const s = parts[i]!.trim();
            if (s) { sentenceQueue.push(s); sentenceCount++; }
            i += 2;
          }
          tokenBuffer = parts[parts.length - 1] ?? "";
        }
        const last = tokenBuffer.trim();
        if (last) { sentenceQueue.push(last); sentenceCount++; }
        sentenceQueue.end();
      })();

      // ── TTS WebSocket → audio_out (consumer) ───────────────────────────────
      for await (const pcmChunk of tts.streamUtterance(sentenceQueue, {}, signal)) {
        if (!firstAudioTime) {
          firstAudioTime = Date.now();
          app.log.info({ turnId, latencyMs: firstAudioTime - speechEndTime }, "First audio chunk");
        }
        send({ type: "audio_out", data: pcmChunk.toString("base64"), turnId });
      }

      await llmTask; // ensure LLM errors surface

      const latencyMs = Date.now() - speechEndTime;
      app.log.info({
        turnId, latencyMs,
        asrLatencyMs:       asrFinalTime - speechEndTime,
        llmFirstTokenMs:    llmFirstTokenTime ? llmFirstTokenTime - speechEndTime : null,
        firstAudioMs:       firstAudioTime    ? firstAudioTime    - speechEndTime : null,
        sentenceCount,
      }, "Turn complete");
      send({ type: "turn_complete", turnId, latencyMs });

    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        app.log.info({ turnId }, "Pipeline aborted (interruption)");
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      app.log.error({ turnId, err }, "Pipeline error");
      sendError("PIPELINE_ERROR", message);
    }
  }

  // ── Message handler ─────────────────────────────────────────────────────────
  (socket as unknown as {
    on(event: "message", listener: (raw: WebSocketMessageEvent) => void): void;
    on(event: "close",   listener: () => void): void;
    send(data: string): void;
  }).on("message", (raw: WebSocketMessageEvent) => {
    let parsed: unknown;
    try { parsed = JSON.parse(raw.toString()); }
    catch { app.log.warn("Received non-JSON message"); return; }

    const result = InboundMessageSchema.safeParse(parsed);
    if (!result.success) {
      app.log.warn({ issues: result.error.issues }, "Invalid inbound message");
      return;
    }

    const msg = result.data;

    // ── start_session ───────────────────────────────────────────────────────
    if (msg.type === "start_session") {
      const session = createSession(msg.sessionId, msg.language);
      const state: ConnectionState = { deepgramStream: null };
      connectionState.set(msg.sessionId, state);

      const asr = new DeepgramASR(config.DEEPGRAM_API_KEY);

      asr.startContinuousStream(
        {
          onSpeechStart: () => {
            app.log.info({ sessionId: msg.sessionId }, "Deepgram: speech_start");
            send({ type: "agent_state_change", state: "MAIN" });
          },

          onPartial: (partial) => {
            const turnId = `${msg.sessionId}-${session.turnCount}`;
            send({ type: "transcript_partial", text: partial.text, turnId });
          },

          onFinal: (final) => {
            app.log.debug({ text: final.text }, "Deepgram: sentence final");
          },

          onUtteranceEnd: (fullText) => {
            const utteranceEndTime = Date.now();
            // Reset abort controller for this new turn.
            session.abortController = new AbortController();
            const turnId = `${session.sessionId}-${session.turnCount++}`;

            app.log.info({ sessionId: msg.sessionId, turnId, text: fullText }, "Deepgram: utterance_end — starting LLM/TTS");
            send({ type: "transcript_final", text: fullText, turnId });

            void runLlmTts(session.sessionId, fullText, turnId, utteranceEndTime, utteranceEndTime);
          },
        },
        session.abortController.signal,
      ).then((stream) => {
        state.deepgramStream = stream;
        app.log.info({ sessionId: msg.sessionId }, "Deepgram continuous stream open");
      }).catch((err: unknown) => {
        app.log.error({ err }, "Failed to open Deepgram continuous stream");
        sendError("ASR_ERROR", err instanceof Error ? err.message : String(err));
      });

      send({ type: "session_started", sessionId: msg.sessionId });
    }

    // ── audio_chunk ─────────────────────────────────────────────────────────
    if (msg.type === "audio_chunk") {
      const chunk = Buffer.from(msg.data, "base64");
      for (const [, state] of connectionState) {
        state.deepgramStream?.sendChunk(chunk);
      }
    }

    // ── interrupt ───────────────────────────────────────────────────────────
    if (msg.type === "interrupt") {
      const session = getSession(msg.sessionId);
      if (!session) { sendError("NO_SESSION", `Session ${msg.sessionId} not found`); return; }

      const oldController = session.abortController;
      handleInterruption(session, {
        abortTts:        () => { oldController.abort(); },
        abortLlm:        () => { /* same controller */ },
        restartPipeline: async () => {
          app.log.info({ sessionId: msg.sessionId }, "Pipeline restarted after interruption");
        },
      }).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        app.log.error({ sessionId: msg.sessionId, err }, "Interruption handler error");
        sendError("INTERRUPT_ERROR", message);
      });
    }

    // ── end_session ─────────────────────────────────────────────────────────
    if (msg.type === "end_session") {
      const state = connectionState.get(msg.sessionId);
      if (state) {
        void state.deepgramStream?.close();
        connectionState.delete(msg.sessionId);
      }
      destroySession(msg.sessionId);
    }
  });

  socket.on("close", () => {
    app.log.info("WebSocket client disconnected");
    for (const [sessionId, state] of connectionState) {
      void state.deepgramStream?.close();
      destroySession(sessionId);
    }
    connectionState.clear();
  });
});

const port = Number(process.env["PORT"] ?? 3000);
await app.listen({ port, host: "0.0.0.0" });
