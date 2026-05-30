#!/usr/bin/env tsx
/**
 * Replay a recorded call session from a JSONL log file.
 * Useful for debugging pipeline issues without a live microphone.
 *
 * TODO: Implement replay by reading a session log file and re-feeding
 * audio chunks through the pipeline in order, with original timing.
 *
 * Usage: tsx scripts/replay-call.ts --session <path/to/session.jsonl>
 */

import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    session: { type: "string" },
    speed: { type: "string", default: "1.0" },
  },
});

if (!values.session) {
  console.error("Usage: tsx scripts/replay-call.ts --session <path/to/session.jsonl>");
  process.exit(1);
}

console.log(`Replaying session: ${values.session} at ${values.speed}x speed`);
throw new Error("not implemented: replay-call");
