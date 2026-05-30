import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";

const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

export type TurnRecord = {
  role: "agent" | "user";
  content: string;
};

export type JudgeInput = {
  persona_goal: string;
  transcript: TurnRecord[];
  constraints?: string[];
};

export type JudgeVerdict = {
  goal_achieved: boolean;
  turn_count_reasonable: boolean;
  constraint_violated: boolean;
  reasoning: string;
};

export type RunMetrics = {
  total: number;
  goal_achieved_tpr: number;   // true positive rate for goal_achieved
  goal_achieved_tnr: number;   // true negative rate
  constraint_violation_rate: number;
};

const JUDGE_TOOL: Anthropic.Tool = {
  name: "submit_verdict",
  description: "Submit structured evaluation verdict for a conversation transcript.",
  input_schema: {
    type: "object" as const,
    properties: {
      goal_achieved: {
        type: "boolean",
        description: "Did the agent help the user achieve their stated goal?",
      },
      turn_count_reasonable: {
        type: "boolean",
        description:
          "Was the number of turns reasonable for the task complexity? (flag if >10 for a simple task)",
      },
      constraint_violated: {
        type: "boolean",
        description:
          "Did the agent violate any of the provided constraints (e.g., disclosed state machine internals, went off-topic)?",
      },
      reasoning: {
        type: "string",
        description: "One-paragraph explanation of the verdict.",
      },
    },
    required: ["goal_achieved", "turn_count_reasonable", "constraint_violated", "reasoning"],
  },
};

export async function judgeConversation(input: JudgeInput): Promise<JudgeVerdict> {
  const transcriptText = input.transcript
    .map((t) => `${t.role.toUpperCase()}: ${t.content}`)
    .join("\n");

  const constraintText =
    input.constraints && input.constraints.length > 0
      ? `\nConstraints the agent must not violate:\n${input.constraints.map((c) => `- ${c}`).join("\n")}`
      : "";

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    tools: [JUDGE_TOOL],
    tool_choice: { type: "any" },
    system:
      "You are an objective evaluator of AI voice agent conversations. " +
      "Evaluate the transcript strictly against the stated goal. Do not infer intent — " +
      "judge only what happened.",
    messages: [
      {
        role: "user",
        content:
          `Goal for this session: ${input.persona_goal}${constraintText}\n\n` +
          `Transcript:\n${transcriptText}\n\n` +
          `Call submit_verdict with your evaluation.`,
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Judge did not call submit_verdict tool");
  }

  const input_data = toolUse.input as Record<string, unknown>;
  return {
    goal_achieved: Boolean(input_data["goal_achieved"]),
    turn_count_reasonable: Boolean(input_data["turn_count_reasonable"]),
    constraint_violated: Boolean(input_data["constraint_violated"]),
    reasoning: String(input_data["reasoning"] ?? ""),
  };
}

export function computeRunMetrics(verdicts: JudgeVerdict[]): RunMetrics {
  const total = verdicts.length;
  if (total === 0) {
    return { total: 0, goal_achieved_tpr: 0, goal_achieved_tnr: 0, constraint_violation_rate: 0 };
  }

  const goalAchieved = verdicts.filter((v) => v.goal_achieved).length;
  const constraintViolated = verdicts.filter((v) => v.constraint_violated).length;

  return {
    total,
    goal_achieved_tpr: goalAchieved / total,
    goal_achieved_tnr: 1 - goalAchieved / total,
    constraint_violation_rate: constraintViolated / total,
  };
}
