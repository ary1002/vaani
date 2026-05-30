import { randomUUID } from "crypto";
import type { Persona } from "./personas.js";
import { composePersonaPrompt } from "./personas.js";
import type { TurnRecord } from "./judge.js";
import { judgeConversation } from "./judge.js";
import { streamCompletion } from "../pipeline/llm.js";
import { logSessionStart, logSessionEnd, logTurn } from "./logger.js";

export type SimulationConfig = {
  agentSystemPrompt: string;
  persona: Persona;
  maxTurns?: number;
};

export type SimulationResult = {
  sessionId: string;
  turns: TurnRecord[];
  durationMs: number;
};

const GOODBYE_RE = /\b(goodbye|bye|thank you[,.]? goodbye|thanks[,.]? goodbye|have a good day|that'?s all|all done|end the call)\b/i;

async function collectStream(gen: AsyncGenerator<string>): Promise<string> {
  const parts: string[] = [];
  for await (const token of gen) parts.push(token);
  return parts.join("");
}

export async function runSimulation(config: SimulationConfig): Promise<SimulationResult> {
  const sessionId = randomUUID();
  const maxTurns = config.maxTurns ?? 10;
  const turns: TurnRecord[] = [];
  const startMs = Date.now();

  // Message history from each side's perspective.
  // agentMsgs: user = persona utterances, assistant = agent utterances.
  // personaMsgs: user = agent utterances, assistant = persona utterances.
  const agentMsgs: { role: "user" | "assistant"; content: string }[] = [];
  const personaMsgs: { role: "user" | "assistant"; content: string }[] = [];

  const personaSystemPrompt = composePersonaPrompt(config.persona);
  const abortController = new AbortController();
  const signal = abortController.signal;

  logSessionStart(sessionId);

  for (let i = 0; i < maxTurns; i++) {
    // ── Persona turn ────────────────────────────────────────────────────────
    const personaStart = Date.now();
    const personaText = await collectStream(
      streamCompletion({ systemPrompt: personaSystemPrompt, messages: personaMsgs, signal })
    );
    const personaTurn: TurnRecord = { role: "user", content: personaText };
    turns.push(personaTurn);
    agentMsgs.push({ role: "user", content: personaText });
    personaMsgs.push({ role: "assistant", content: personaText });

    logTurn({
      sessionId,
      turn: i * 2,
      input: i === 0 ? "(session start)" : turns[turns.length - 2]?.content ?? "",
      output: personaText,
      latencyMs: Date.now() - personaStart,
      model: "claude-haiku-4-5-20251001",
    });

    if (GOODBYE_RE.test(personaText)) break;

    // ── Agent turn ──────────────────────────────────────────────────────────
    const agentStart = Date.now();
    const agentText = await collectStream(
      streamCompletion({ systemPrompt: config.agentSystemPrompt, messages: agentMsgs, signal })
    );
    const agentTurn: TurnRecord = { role: "agent", content: agentText };
    turns.push(agentTurn);
    agentMsgs.push({ role: "assistant", content: agentText });
    personaMsgs.push({ role: "user", content: agentText });

    logTurn({
      sessionId,
      turn: i * 2 + 1,
      input: personaText,
      output: agentText,
      latencyMs: Date.now() - agentStart,
      model: "claude-haiku-4-5-20251001",
    });

    if (GOODBYE_RE.test(agentText)) break;
  }

  const durationMs = Date.now() - startMs;
  logSessionEnd(sessionId, turns.length, durationMs);

  return { sessionId, turns, durationMs };
}

export async function comparePrompts(
  promptA: string,
  promptB: string,
  personas: Persona[]
): Promise<{ promptA: number; promptB: number; delta: number }> {
  const [resultsA, resultsB] = await Promise.all([
    Promise.all(personas.map((p) => runSimulation({ agentSystemPrompt: promptA, persona: p }))),
    Promise.all(personas.map((p) => runSimulation({ agentSystemPrompt: promptB, persona: p }))),
  ]);

  const [verdictsA, verdictsB] = await Promise.all([
    Promise.all(
      resultsA.map((r, i) =>
        judgeConversation({ persona_goal: personas[i]!.goal_for_judge, transcript: r.turns })
      )
    ),
    Promise.all(
      resultsB.map((r, i) =>
        judgeConversation({ persona_goal: personas[i]!.goal_for_judge, transcript: r.turns })
      )
    ),
  ]);

  const rateA = verdictsA.filter((v) => v.goal_achieved).length / verdictsA.length;
  const rateB = verdictsB.filter((v) => v.goal_achieved).length / verdictsB.length;

  return { promptA: rateA, promptB: rateB, delta: rateB - rateA };
}
