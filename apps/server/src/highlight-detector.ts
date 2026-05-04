import type { ActionRecord, ShowdownResult, Card, HighlightReason, HandRank } from "@cybercasino/shared";

export interface HandContext {
  handNumber: number;
  actionHistory: ActionRecord[];
  holeCards: Map<string, Card[]>;
  communityCards: Card[];
  showdownResults: ShowdownResult[] | null;
  potTotal: number;
  bigBlind: number;
  playerChipsAtStart: Map<string, number>;
  winnerIds: string[];
}

const STRONG_HANDS: HandRank[] = [
  "two-pair", "three-of-a-kind", "straight", "flush",
  "full-house", "four-of-a-kind", "straight-flush", "royal-flush",
];

export function detectHighlights(ctx: HandContext): HighlightReason[] {
  const reasons: HighlightReason[] = [];

  // 1. Big pot: > 8x big blind
  if (ctx.potTotal > 8 * ctx.bigBlind) {
    reasons.push("big-pot");
  }

  // 2. Bluff success: someone bluffing and no showdown (everyone else folded)
  const bluffers = ctx.actionHistory.filter((a) => a.thought?.isBluffing);
  if (bluffers.length > 0 && !ctx.showdownResults) {
    reasons.push("bluff-success");
  }

  // 3. Bluff catch: showdown where a bluffer lost
  if (ctx.showdownResults && bluffers.length > 0) {
    const blufferIds = new Set(bluffers.map((a) => a.playerId));
    const blufferLost = ctx.showdownResults.some(
      (r) => blufferIds.has(r.playerId) && !ctx.winnerIds.includes(r.playerId)
    );
    if (blufferLost) {
      reasons.push("bluff-catch");
    }
  }

  // 4. Cooler: 2+ players at showdown with strong hands
  if (ctx.showdownResults && ctx.showdownResults.length >= 2) {
    const strongCount = ctx.showdownResults.filter((r) =>
      STRONG_HANDS.includes(r.handRank)
    ).length;
    if (strongCount >= 2) {
      reasons.push("cooler");
    }
  }

  // 5. Bad beat: loser had a strong hand
  if (ctx.showdownResults && ctx.showdownResults.length >= 2) {
    const losers = ctx.showdownResults.filter(
      (r) => !ctx.winnerIds.includes(r.playerId)
    );
    const loserHadStrong = losers.some((r) => STRONG_HANDS.includes(r.handRank));
    if (loserHadStrong) {
      reasons.push("bad-beat");
    }
  }

  // 6. Short stack comeback: winner started with < 10x BB
  for (const winnerId of ctx.winnerIds) {
    const startChips = ctx.playerChipsAtStart.get(winnerId) ?? 0;
    if (startChips > 0 && startChips < 10 * ctx.bigBlind) {
      reasons.push("short-stack-comeback");
      break;
    }
  }

  // 7. Multi-way all-in: 3+ players went all-in
  const allInPlayers = new Set<string>();
  for (const action of ctx.actionHistory) {
    if (action.action.type === "call" || action.action.type === "raise") {
      const startChips = ctx.playerChipsAtStart.get(action.playerId) ?? 0;
      const totalBet = ctx.actionHistory
        .filter((a) => a.playerId === action.playerId && (a.action.type === "call" || a.action.type === "raise"))
        .reduce((sum, a) => sum + (a.action.amount ?? 0), 0);
      if (totalBet >= startChips * 0.95) {
        allInPlayers.add(action.playerId);
      }
    }
  }
  if (allInPlayers.size >= 3) {
    reasons.push("multi-way-allin");
  }

  return reasons;
}
