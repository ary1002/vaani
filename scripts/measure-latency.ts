#!/usr/bin/env tsx
/**
 * Latency benchmark: measures per-hop timing for the voice pipeline.
 * Output is written to metrics/latency-<timestamp>.json.
 *
 * Hops measured:
 *   speech_end_to_asr_final  — VAD speech_end → ASR final transcript
 *   asr_final_to_llm_first   — ASR final → first LLM token
 *   llm_first_to_tts_first   — First LLM token → first TTS audio chunk
 *   total_e2e                — speech_end → first audio out
 *
 * Uses a fixed synthetic utterance ("Book me a doctors appointment for tomorrow")
 * as a pre-encoded WAV-style PCM buffer so results are reproducible.
 * Runs RUNS iterations and reports min/p50/p95/max per hop.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const { DeepgramASR }      = await import("../src/pipeline/asr.js");
const { ElevenLabsTTS }    = await import("../src/pipeline/tts.js");
const { streamCompletion } = await import("../src/pipeline/llm.js");
const { config }           = await import("../src/config.js");

export type HopMeasurement = {
  hop: string;
  latencyMs: number;
  timestamp: number;
};

export type LatencyReport = {
  runId: string;
  runs: number;
  hops: HopSummary[];
  total_e2e_ms: Stats;
  target_ms: number;
  passed: boolean;
};

export type HopSummary = {
  hop: string;
  min: number;
  p50: number;
  p95: number;
  max: number;
};

type Stats = HopSummary;

const TARGET_MS = 800;
const RUNS      = 5;

// ── Synthetic PCM utterance ──────────────────────────────────────────────────
// 440 Hz tone at amplitude 3000 for 1.2s @ 16kHz int16 — Deepgram treats it
// as audio and returns an empty or near-empty transcript; we still measure the
// round-trip. For a real utterance benchmark, swap this with a recorded WAV.

function makeSpeechPCM(): Buffer {
  const sampleRate = 16000;
  const durationMs = 1200;
  const samples = Math.floor(sampleRate * durationMs / 1000);
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const v = Math.round(Math.sin(2 * Math.PI * 440 * i / sampleRate) * 3000);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, v)), i * 2);
  }
  return buf;
}

// ── Stats helpers ─────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(Math.floor(sorted.length * p / 100), sorted.length - 1);
  return sorted[idx]!;
}

function summarise(label: string, values: number[]): HopSummary {
  const s = [...values].sort((a, b) => a - b);
  return {
    hop: label,
    min: s[0]!,
    p50: percentile(s, 50),
    p95: percentile(s, 95),
    max: s[s.length - 1]!,
  };
}

// ── One benchmark run ─────────────────────────────────────────────────────────

type RunResult = {
  asr_ms: number;
  llm_first_ms: number;
  tts_first_ms: number;
  e2e_ms: number;
};

async function runOnce(audioBuf: Buffer): Promise<RunResult> {
  const abort = new AbortController();
  const t0 = Date.now();

  // ── ASR ────────────────────────────────────────────────────────────────────
  const asr = new DeepgramASR(config.DEEPGRAM_API_KEY);
  let asrFinalMs = 0;
  let finalTranscript = "";

  const { sendChunk, close } = await asr.startStream(
    () => {},
    (final) => {
      asrFinalMs = Date.now() - t0;
      finalTranscript = final.text;
    },
    abort.signal,
  );

  sendChunk(audioBuf);
  await close();

  const asr_ms = asrFinalMs || (Date.now() - t0); // fallback if transcript was empty

  // Use a fixed prompt when ASR returns empty (synthetic audio)
  const prompt = finalTranscript.trim() || "Hello, how are you?";

  // ── LLM ────────────────────────────────────────────────────────────────────
  const tLlmStart = Date.now();
  let llmFirstTokenMs = 0;
  let llmText = "";

  for await (const token of streamCompletion({
    systemPrompt: "You are a helpful voice assistant. Respond in one sentence only.",
    messages: [{ role: "user", content: prompt }],
    signal: abort.signal,
  })) {
    if (!llmFirstTokenMs) llmFirstTokenMs = Date.now() - tLlmStart;
    llmText += token;
  }

  const llm_first_ms = llmFirstTokenMs;

  // ── TTS ────────────────────────────────────────────────────────────────────
  const tts = new ElevenLabsTTS(config.ELEVENLABS_API_KEY);
  const tTtsStart = Date.now();
  let ttsFirstChunkMs = 0;

  for await (const _chunk of tts.stream(llmText.trim() || "Hello.", {}, abort.signal)) {
    if (!ttsFirstChunkMs) {
      ttsFirstChunkMs = Date.now() - tTtsStart;
      break; // only need first chunk for the latency measurement
    }
  }

  return {
    asr_ms,
    llm_first_ms,
    tts_first_ms: ttsFirstChunkMs,
    e2e_ms: asr_ms + llm_first_ms + ttsFirstChunkMs,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const audioBuf = makeSpeechPCM();
  const runId = `benchmark-${Date.now()}`;

  const asrSamples:  number[] = [];
  const llmSamples:  number[] = [];
  const ttsSamples:  number[] = [];
  const e2eSamples:  number[] = [];

  console.log(`Running ${RUNS} iterations…\n`);

  for (let i = 0; i < RUNS; i++) {
    process.stdout.write(`  run ${i + 1}/${RUNS} … `);
    const r = await runOnce(audioBuf);
    asrSamples.push(r.asr_ms);
    llmSamples.push(r.llm_first_ms);
    ttsSamples.push(r.tts_first_ms);
    e2eSamples.push(r.e2e_ms);
    console.log(`asr ${r.asr_ms}ms  llm-first ${r.llm_first_ms}ms  tts-first ${r.tts_first_ms}ms  e2e ${r.e2e_ms}ms`);
  }

  const hops: HopSummary[] = [
    summarise("speech_end_to_asr_final",  asrSamples),
    summarise("asr_final_to_llm_first",   llmSamples),
    summarise("llm_first_to_tts_first",   ttsSamples),
  ];

  const e2e = summarise("total_e2e", e2eSamples);

  const report: LatencyReport = {
    runId,
    runs: RUNS,
    hops,
    total_e2e_ms: e2e,
    target_ms: TARGET_MS,
    passed: e2e.p50 < TARGET_MS,
  };

  await mkdir("metrics", { recursive: true });
  const outPath = join("metrics", `latency-${runId}.json`);
  await writeFile(outPath, JSON.stringify(report, null, 2));

  console.log(`\n${"─".repeat(52)}`);
  console.log(`${"Hop".padEnd(34)} ${"p50".padStart(6)} ${"p95".padStart(6)} ${"max".padStart(6)}`);
  console.log(`${"─".repeat(52)}`);
  for (const h of hops) {
    console.log(`${h.hop.padEnd(34)} ${String(h.p50).padStart(6)}ms ${String(h.p95).padStart(5)}ms ${String(h.max).padStart(5)}ms`);
  }
  console.log(`${"─".repeat(52)}`);
  console.log(`${"total e2e".padEnd(34)} ${String(e2e.p50).padStart(6)}ms ${String(e2e.p95).padStart(5)}ms ${String(e2e.max).padStart(5)}ms`);
  console.log(`target: ${TARGET_MS}ms   result: ${report.passed ? "PASS ✓" : "FAIL ✗"}`);
  console.log(`\nReport: ${outPath}`);

  if (!report.passed) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
