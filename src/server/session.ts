export type SessionLanguage = "english" | "hindi" | "hinglish";

export type Session = {
  sessionId: string;
  language: SessionLanguage;
  turnCount: number;
  createdAt: number;
  /** Reset on every new utterance. See interruption.ts for why. */
  abortController: AbortController;
};

const sessions = new Map<string, Session>();

export function createSession(
  sessionId: string,
  language: SessionLanguage = "english"
): Session {
  const session: Session = {
    sessionId,
    language,
    turnCount: 0,
    createdAt: Date.now(),
    abortController: new AbortController(),
  };
  sessions.set(sessionId, session);
  return session;
}

export function getSession(sessionId: string): Session | undefined {
  return sessions.get(sessionId);
}

export function destroySession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.abortController.abort();
    sessions.delete(sessionId);
  }
}
