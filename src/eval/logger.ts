export type TurnLog = {
  sessionId: string;
  turn: number;
  input: string;
  output: string;
  latencyMs: number;
  model: string;
};

/**
 * Log a single turn.
 * TODO: Replace console.log with Braintrust SDK when BRAINTRUST_API_KEY is set.
 * Shape must match TurnLog — do not change the field names (Braintrust schema).
 */
export function logTurn(data: TurnLog): void {
  console.log(JSON.stringify({ event: "turn", ...data }));
}

export function logSessionStart(sessionId: string): void {
  console.log(JSON.stringify({ event: "session_start", sessionId, ts: Date.now() }));
}

export function logSessionEnd(sessionId: string, totalTurns: number, durationMs: number): void {
  console.log(
    JSON.stringify({ event: "session_end", sessionId, totalTurns, durationMs, ts: Date.now() })
  );
}
