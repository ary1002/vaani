# Vaani - Voice Pipeline

## What this is
Real-time voice agent pipeline. WebSocket server → VAD → ASR → LLM → TTS → client.
Target: <800ms speech-end to first audio out.

## Run commands
| Task | Command |
|------|---------|
| Dev server | `npm run dev` |
| Type check | `npm run typecheck` |
| Unit tests | `npm test` |
| Latency benchmark | `npm run benchmark` |
| Simulation harness | `npm run simulate -- --prompt prompts/agent-v1.md` |
| Compare prompts | `npm run simulate -- --compare v1 v2` |

## Hard rules

**Never break the provider interface.**  
ASR and TTS are swappable. Every provider must satisfy the interface in
`src/pipeline/asr.ts` and `src/pipeline/tts.ts`. If you add a provider,
implement the interface. Do not add provider-specific logic to pipeline code.

**Never let the LLM decide state transitions.**  
The XState machine in `src/machine/conversation.ts` owns state.
The LLM receives current state in its prompt and responds within it.
The Intent Extractor (`src/machine/intent.ts`) emits events that drive transitions.
If you find yourself writing prompt logic that changes which state to enter — stop,
put it in the machine instead.

**Never ship a prompt change without running simulation.**  
Prompts live in `prompts/`. Before changing any prompt file, run:
`npm run simulate -- --compare <current> <new>`
Pass rate must not drop. If it does, fix the prompt, not the threshold.

**Interruption handling is a race condition.**  
The three operations in `src/pipeline/interruption.ts` — abort TTS, abort LLM,
restart pipeline — must happen in that order. Do not refactor this without
understanding why the order matters (agent talking over itself).

## Architecture invariants
- Sentence-boundary TTS streaming is intentional. Do not buffer full LLM output before TTS.
- Partial ASR transcripts feed the LLM before final transcript. Do not wait for final.
- AbortController is per-session, reset on every new utterance.
- Latency is logged per-hop. Do not remove instrumentation from pipeline files.

## Adding a new ASR provider
Use the `add-provider` skill: `.claude/skills/add-provider/SKILL.md`

## Running evals
Use the `run-evals` skill: `.claude/skills/run-evals/SKILL.md`

## Where things live
- Pipeline stages: `src/pipeline/`
- Conversation machine: `src/machine/`
- Eval harness: `src/eval/`
- Prompt versions: `prompts/` — versioned, never edit in place, always create new file
- Latency output: `metrics/`