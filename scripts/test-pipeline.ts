#!/usr/bin/env tsx
/**
 * Manual integration test for each pipeline stage.
 * Loads credentials from .env automatically.
 *
 * Usage:
 *   npm run test:pipeline
 *
 * What each stage does:
 *   VAD  — feeds synthetic PCM (silence → 440Hz tone → silence) and checks
 *           that speech_start and speech_end fire with a non-empty buffer.
 *   ASR  — opens a Deepgram WebSocket, streams 1s of synthetic audio, closes
 *           cleanly. Transcript will be empty (tone ≠ speech); the test passes
 *           as long as the connection succeeds and no error is thrown.
 *   LLM  — streams a one-sentence completion from Claude Haiku and checks that
 *           tokens arrive.
 *   TTS  — POSTs "Hello." to ElevenLabs and checks that PCM bytes come back.
 */

const { createVADProvider } = await import("../src/pipeline/vad.js");
const { DeepgramASR }       = await import("../src/pipeline/asr.js");
const { ElevenLabsTTS }     = await import("../src/pipeline/tts.js");
const { streamCompletion }  = await import("../src/pipeline/llm.js");
const { config }            = await import("../src/config.js");

// ── Types ────────────────────────────────────────────────────────────────────

type Result = { name: string; passed: boolean; detail: string; ms: number };

function ok(name: string, detail: string, ms: number): Result  { return { name, passed: true,  detail, ms }; }
function err(name: string, detail: string, ms: number): Result { return { name, passed: false, detail, ms }; }

// ── PCM helper ───────────────────────────────────────────────────────────────

function makePCM(durationMs: number, amplitude: number, sampleRate = 16000): Buffer {
  const samples = Math.floor(sampleRate * durationMs / 1000);
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const v = Math.round(Math.sin(2 * Math.PI * 440 * i / sampleRate) * amplitude);
    buf.writeInt16LE(v, i * 2);
  }
  return buf;
}

function feedChunked(processChunk: (b: Buffer) => void, buf: Buffer, chunkBytes = 640): void {
  for (let o = 0; o < buf.length; o += chunkBytes) {
    processChunk(buf.subarray(o, Math.min(o + chunkBytes, buf.length)));
  }
}

// ── Stage tests ──────────────────────────────────────────────────────────────

async function testVAD(): Promise<Result> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const vad = createVADProvider();
    const fired: string[] = [];
    let endBuffer: Buffer | null = null;

    vad.on("speech_start", () => fired.push("speech_start"));
    vad.on("speech_end", (e) => {
      fired.push("speech_end");
      if (e.type === "speech_end") endBuffer = e.audioBuffer;
    });

    // Feed silence then speech. MIN_SPEECH_MS=600 is wall-clock based so we
    // need real time to pass — pause 700ms between speech and silence chunks.
    feedChunked(vad.processChunk.bind(vad), makePCM(100, 80));
    feedChunked(vad.processChunk.bind(vad), makePCM(700, 2000)); // RMS ~1414 > SPEECH_THRESHOLD 1200

    setTimeout(() => {
      // After 700ms real time, feed silence so MIN_SPEECH_MS check passes.
      feedChunked(vad.processChunk.bind(vad), makePCM(600, 80));

      // Wait for SILENCE_DURATION_MS (500ms) + margin.
      setTimeout(() => {
        vad.destroy();
        const ms = Date.now() - t0;
        if (!fired.includes("speech_start"))
          return resolve(err("VAD", "speech_start never fired", ms));
        if (!fired.includes("speech_end"))
          return resolve(err("VAD", "speech_end never fired — silence timer may not have run", ms));
        if (!endBuffer || (endBuffer as Buffer).length === 0)
          return resolve(err("VAD", "speech_end fired but audioBuffer is empty", ms));
        resolve(ok("VAD", `${fired.join(" → ")}, buffer ${(endBuffer as Buffer).length} bytes`, ms));
      }, 700);
    }, 700);
  });
}

async function testASR(): Promise<Result> {
  const t0 = Date.now();
  const abort = new AbortController();
  try {
    const asr = new DeepgramASR(config.DEEPGRAM_API_KEY);
    let partials = 0;
    let finals   = 0;

    const { sendChunk, close } = await asr.startStream(
      () => { partials++; },
      () => { finals++;   },
      abort.signal,
    );

    const audio = makePCM(1000, 1500);
    const CHUNK = 3200; // 100ms at 16kHz
    for (let o = 0; o < audio.length; o += CHUNK) {
      sendChunk(audio.subarray(o, Math.min(o + CHUNK, audio.length)));
      await new Promise((r) => setTimeout(r, 100));
    }

    await close();
    return ok("ASR", `connected OK — partials: ${partials}, finals: ${finals} (synthetic tone → empty transcript is expected)`, Date.now() - t0);
  } catch (e) {
    abort.abort();
    return err("ASR", e instanceof Error ? e.message : String(e), Date.now() - t0);
  }
}

async function testLLM(): Promise<Result> {
  const t0 = Date.now();
  const abort = new AbortController();
  try {
    const tokens: string[] = [];
    for await (const token of streamCompletion({
      systemPrompt: "You are a helpful voice assistant. Respond in one sentence only.",
      messages: [{ role: "user", content: "Say hello." }],
      signal: abort.signal,
    })) {
      tokens.push(token);
    }
    const text = tokens.join("").trim();
    if (!text) return err("LLM", "empty response", Date.now() - t0);
    const preview = text.length > 80 ? text.slice(0, 80) + "…" : text;
    return ok("LLM", `"${preview}"`, Date.now() - t0);
  } catch (e) {
    abort.abort();
    return err("LLM", e instanceof Error ? e.message : String(e), Date.now() - t0);
  }
}

async function testTTS(): Promise<Result> {
  const t0 = Date.now();
  const abort = new AbortController();
  try {
    const tts = new ElevenLabsTTS(config.ELEVENLABS_API_KEY);
    let chunks = 0;
    let bytes  = 0;
    for await (const chunk of tts.stream("Hello.", {}, abort.signal)) {
      chunks++;
      bytes += chunk.length;
    }
    if (bytes === 0) return err("TTS", "no audio bytes returned", Date.now() - t0);
    return ok("TTS", `${chunks} chunk(s), ${bytes} bytes PCM @ 24kHz`, Date.now() - t0);
  } catch (e) {
    abort.abort();
    return err("TTS", e instanceof Error ? e.message : String(e), Date.now() - t0);
  }
}

// ── Runner ───────────────────────────────────────────────────────────────────

const STAGES = [testVAD, testASR, testLLM, testTTS];

console.log("Vaani pipeline test\n");

const results: Result[] = [];
for (const stage of STAGES) {
  const result = await stage();
  results.push(result);
  const icon   = result.passed ? "✓" : "✗";
  const status = result.passed ? "pass" : "FAIL";
  console.log(`  ${result.name.padEnd(4)} ${icon} ${status}  ${result.detail}  (${result.ms}ms)`);
}

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) process.exit(1);
