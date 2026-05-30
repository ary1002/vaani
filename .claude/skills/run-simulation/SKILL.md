# run-simulation skill

Run the simulation harness to test a prompt or compare two prompt versions.

## Usage
```
npm run simulate -- --prompt prompts/agent-v1.md
npm run simulate -- --prompt prompts/agent-v1.md --persona cooperative-en-1
npm run simulate -- --compare prompts/agent-v1.md prompts/agent-v2.md
```

## What it does
- Runs LLM-vs-LLM simulation sessions for each selected persona
- Judges each transcript using Claude Haiku as evaluator
- Prints per-persona results and aggregate metrics
- In `--compare` mode, prints the pass rate delta between two prompt files

## Hard rule
Never accept a prompt change that drops pass rate. If `--compare` shows a negative delta, fix the prompt.
