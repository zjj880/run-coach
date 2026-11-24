export type CoachMessage = { role: 'user' | 'assistant'; text: string };
export type CoachProposal = { title: string; training: string; recovery: string; nutrition: string };
export type CoachTurn = { reply: string; proposal: CoachProposal | null };
export type CoachDay = {
  messages: CoachMessage[];
  draft?: { proposal: CoachProposal; signature: string };
  confirmed?: { proposal: CoachProposal; signature: string };
};
