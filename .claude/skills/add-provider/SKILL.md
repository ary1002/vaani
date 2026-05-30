# add-provider skill

Scaffold a new ASR or TTS provider that satisfies the pipeline interface.

## Usage
Describe the provider you want to add. The skill will:
1. Read the relevant interface (`src/pipeline/asr.ts` or `src/pipeline/tts.ts`)
2. Create the provider file with the full interface implemented
3. Run `npm run typecheck` to verify
4. Report what was created and any TODOs remaining

## Examples
- "Add a Sarvam ASR provider"
- "Add an Azure TTS provider"
- "Add a Google Cloud STT provider"

## Rules (enforced)
- No `any` types
- AbortSignal must be respected in every streaming method
- No provider-specific logic in `src/pipeline/asr.ts` or `src/pipeline/tts.ts`
- `npm run typecheck` must pass after the change
