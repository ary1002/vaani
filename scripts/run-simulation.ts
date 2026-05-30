#!/usr/bin/env tsx
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { PERSONAS } from "../src/eval/personas.js";
import { runSimulation, comparePrompts } from "../src/eval/simulate.js";
import { judgeConversation, computeRunMetrics } from "../src/eval/judge.js";

const { values } = parseArgs({
  options: {
    prompt: { type: "string" },
    persona: { type: "string" },
    interactive: { type: "boolean", default: false },
    compare: { type: "string", multiple: true },
  },
  allowPositionals: false,
});

async function main(): Promise<void> {
  if (values.compare && values.compare.length === 2) {
    const [fileA, fileB] = values.compare as [string, string];
    const [promptA, promptB] = await Promise.all([readFile(fileA, "utf8"), readFile(fileB, "utf8")]);
    console.log(`Comparing:\n  A: ${fileA}\n  B: ${fileB}\n`);
    const result = await comparePrompts(promptA, promptB, PERSONAS);
    console.log(`Pass rate A: ${(result.promptA * 100).toFixed(1)}%`);
    console.log(`Pass rate B: ${(result.promptB * 100).toFixed(1)}%`);
    console.log(`Delta: ${(result.delta * 100).toFixed(1)}%`);
    return;
  }

  if (!values.prompt) {
    console.error("Usage: npm run simulate -- --prompt prompts/agent-v1.md [--persona <id>]");
    process.exit(1);
  }

  const systemPrompt = await readFile(values.prompt, "utf8");
  const personas = values.persona
    ? PERSONAS.filter((p) => p.id === values.persona)
    : PERSONAS;

  if (personas.length === 0) {
    console.error(`No personas found matching id: ${values.persona}`);
    process.exit(1);
  }

  console.log(`Running simulation with ${personas.length} persona(s)...\n`);

  const verdicts = [];
  for (const persona of personas) {
    console.log(`  Persona: ${persona.name} (${persona.id})`);
    const result = await runSimulation({ agentSystemPrompt: systemPrompt, persona });
    const verdict = await judgeConversation({
      persona_goal: persona.goal_for_judge,
      transcript: result.turns,
    });
    verdicts.push(verdict);
    console.log(
      `    goal_achieved=${verdict.goal_achieved} constraint_violated=${verdict.constraint_violated}`
    );
  }

  const metrics = computeRunMetrics(verdicts);
  console.log(`\nResults:`);
  console.log(`  Total: ${metrics.total}`);
  console.log(`  Goal achieved: ${(metrics.goal_achieved_tpr * 100).toFixed(1)}%`);
  console.log(`  Constraint violations: ${(metrics.constraint_violation_rate * 100).toFixed(1)}%`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
