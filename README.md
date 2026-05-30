# Vaani

Real-time voice agent. Speak into a browser, hear a response.

**Stack:** Deepgram Nova-3 (ASR) → Claude Haiku (LLM) → ElevenLabs Turbo v2 (TTS)

## Latency (measured live, not synthetic)

All times are from **end of speech → first audio chunk** played back.

| Hop | p50 |
|-----|-----|
| Utterance detection (endpointing + debounce) | ~500ms |
| LLM first token (cache hit) | ~820ms |
| TTS first chunk (WebSocket) | ~566ms |
| **Total first audio** | **~1400ms** |

ASR latency is 0ms — Deepgram streams audio continuously and fires utterance_end directly.

## Setup

**Requirements:** Node.js ≥ 18, npm

```bash
git clone <repo>
cd vaani
npm install
```

Create a `.env` file:

```
ANTHROPIC_API_KEY=sk-ant-...
DEEPGRAM_API_KEY=...
ELEVENLABS_API_KEY=sk_...
PORT=3000
```

Run:

```bash
npm run dev
```

Open **http://localhost:3000**, click Connect, and start talking.

## Other commands

```bash
npm run test:pipeline   # integration test all 4 stages (VAD, ASR, LLM, TTS)
npm run benchmark       # per-hop latency report → metrics/
npm run simulate        # LLM-vs-LLM eval against personas
```

## Architecture

```
Browser mic → AudioWorklet (16kHz PCM) → WebSocket
  → Deepgram continuous stream (VAD + ASR)
  → utterance_end event
  → Claude Haiku (streamed, system prompt cached)
  → ElevenLabs WebSocket (sentence-boundary streaming)
  → audio_out chunks → browser playback
```

Prompts live in `prompts/`. Never edit in place — create a new version and run `npm run simulate -- --compare v1 v2` before deploying.
