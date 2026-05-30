# run-evals skill

Run the LLM-as-judge evaluation harness against the current prompt and personas.

## Usage
Invoke with optional flags:
- `--persona <id>` — run a single persona instead of all 6
- `--prompt <path>` — override the default prompt file

## What it does
1. Loads personas from `src/eval/personas.ts`
2. Runs `runSimulation` for each persona
3. Calls `judgeConversation` on each transcript
4. Computes and prints `RunMetrics` (TPR, TNR, constraint violation rate)

## Output
Prints a summary table. Full transcripts are logged via `src/eval/logger.ts`.

## Prerequisites
- `ANTHROPIC_API_KEY` must be set
- `npm run typecheck` should pass before running evals
