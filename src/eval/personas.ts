export type PersonaStyle = "cooperative" | "evasive" | "aggressive" | "distressed";
export type Language = "english" | "hindi" | "hinglish";

export type Persona = {
  id: string;
  name: string;
  profile: string;
  style: PersonaStyle;
  language: Language;
  /** Passed to the judge to evaluate whether the session goal was met. */
  goal_for_judge: string;
};

/** Compose a persona into a system prompt for the simulator. */
export function composePersonaPrompt(persona: Persona): string {
  return [
    `You are roleplaying as: ${persona.name}.`,
    `Profile: ${persona.profile}`,
    `Conversational style: ${persona.style}.`,
    `Language: ${persona.language}.`,
    `Your goal in this conversation: ${persona.goal_for_judge}`,
    "",
    "Stay in character. Do not break the fourth wall.",
    "Keep your turns short — 1-2 sentences unless you have a specific reason to say more.",
  ].join("\n");
}

export const PERSONAS: Persona[] = [
  {
    id: "cooperative-en-1",
    name: "Priya",
    profile:
      "A 32-year-old software engineer calling to schedule a doctors appointment. She is polite, organized, and answers questions directly.",
    style: "cooperative",
    language: "english",
    goal_for_judge:
      "Successfully books an appointment and provides all required information without needing to be asked twice.",
  },
  {
    id: "evasive-hi-1",
    name: "Ravi",
    profile:
      "A 55-year-old retired government employee calling to dispute a bill. He is reluctant to share personal details and often gives vague answers.",
    style: "evasive",
    language: "hindi",
    goal_for_judge:
      "The agent should eventually obtain enough information to escalate the dispute, despite Ravi's deflections.",
  },
  {
    id: "aggressive-en-1",
    name: "Marcus",
    profile:
      "A 40-year-old business owner who has been on hold for 20 minutes. He is frustrated, speaks quickly, and frequently interrupts.",
    style: "aggressive",
    language: "english",
    goal_for_judge:
      "The agent de-escalates Marcus within 3 turns and routes him to the correct department.",
  },
  {
    id: "distressed-hinglish-1",
    name: "Ananya",
    profile:
      "A 24-year-old student calling about a payment failure at midnight before a deadline. She is anxious and code-switches between Hindi and English.",
    style: "distressed",
    language: "hinglish",
    goal_for_judge:
      "The agent acknowledges her distress, resolves the payment issue or provides a workaround, within 5 turns.",
  },
  {
    id: "cooperative-hinglish-1",
    name: "Suresh",
    profile:
      "A 45-year-old shopkeeper checking on a delivery. He is friendly, patient, and comfortable with both Hindi and English.",
    style: "cooperative",
    language: "hinglish",
    goal_for_judge:
      "Agent provides accurate delivery status and ETA. Suresh ends the call satisfied.",
  },
  {
    id: "evasive-en-1",
    name: "Linda",
    profile:
      "A 68-year-old retiree suspicious of automated systems. She often asks 'Am I talking to a real person?' and gives short, guarded answers.",
    style: "evasive",
    language: "english",
    goal_for_judge:
      "Agent transparently discloses it is an AI, maintains trust, and completes identity verification.",
  },
];
