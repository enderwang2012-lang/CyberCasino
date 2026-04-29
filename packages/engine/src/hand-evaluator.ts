import type { Card, HandRank } from "@cybercasino/shared";

export interface EvaluatedHand {
  rank: HandRank;
  score: number;
  bestCards: Card[];
  name: string;
}

const RANK_ORDER: Record<HandRank, number> = {
  "high-card": 0,
  "pair": 1,
  "two-pair": 2,
  "three-of-a-kind": 3,
  "straight": 4,
  "flush": 5,
  "full-house": 6,
  "four-of-a-kind": 7,
  "straight-flush": 8,
  "royal-flush": 9,
};

const RANK_NAMES: Record<number, string> = {
  2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8",
  9: "9", 10: "10", 11: "J", 12: "Q", 13: "K", 14: "A",
};

function combinations(cards: Card[], k: number): Card[][] {
  if (k === 0) return [[]];
  if (cards.length < k) return [];
  const result: Card[][] = [];
  const [first, ...rest] = cards;
  for (const combo of combinations(rest, k - 1)) {
    result.push([first, ...combo]);
  }
  result.push(...combinations(rest, k));
  return result;
}

function evaluate5(cards: Card[]): EvaluatedHand {
  const sorted = [...cards].sort((a, b) => b.rank - a.rank);
  const ranks = sorted.map((c) => c.rank);
  const suits = sorted.map((c) => c.suit);

  const isFlush = suits.every((s) => s === suits[0]);

  let isStraight = false;
  let straightHigh = 0;
  if (ranks[0] - ranks[4] === 4 && new Set(ranks).size === 5) {
    isStraight = true;
    straightHigh = ranks[0];
  }
  // Wheel: A-2-3-4-5
  if (ranks[0] === 14 && ranks[1] === 5 && ranks[2] === 4 && ranks[3] === 3 && ranks[4] === 2) {
    isStraight = true;
    straightHigh = 5;
  }

  const rankCounts = new Map<number, number>();
  for (const r of ranks) {
    rankCounts.set(r, (rankCounts.get(r) || 0) + 1);
  }
  const groups = [...rankCounts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  if (isFlush && isStraight) {
    const rank: HandRank = straightHigh === 14 ? "royal-flush" : "straight-flush";
    const score = encodeScore(RANK_ORDER[rank], [straightHigh]);
    const name = rank === "royal-flush" ? "Royal Flush" : `Straight Flush (${RANK_NAMES[straightHigh]} high)`;
    const bestCards = straightHigh === 5
      ? [sorted[1], sorted[2], sorted[3], sorted[4], sorted[0]]
      : sorted;
    return { rank, score, bestCards, name };
  }

  if (groups[0][1] === 4) {
    const quad = groups[0][0];
    const kicker = groups[1][0];
    return {
      rank: "four-of-a-kind",
      score: encodeScore(RANK_ORDER["four-of-a-kind"], [quad, kicker]),
      bestCards: sorted,
      name: `Four of a Kind (${RANK_NAMES[quad]}s)`,
    };
  }

  if (groups[0][1] === 3 && groups[1][1] === 2) {
    const trips = groups[0][0];
    const pair = groups[1][0];
    return {
      rank: "full-house",
      score: encodeScore(RANK_ORDER["full-house"], [trips, pair]),
      bestCards: sorted,
      name: `Full House (${RANK_NAMES[trips]}s full of ${RANK_NAMES[pair]}s)`,
    };
  }

  if (isFlush) {
    return {
      rank: "flush",
      score: encodeScore(RANK_ORDER["flush"], ranks),
      bestCards: sorted,
      name: `Flush (${RANK_NAMES[ranks[0]]} high)`,
    };
  }

  if (isStraight) {
    const bestCards = straightHigh === 5
      ? [sorted[1], sorted[2], sorted[3], sorted[4], sorted[0]]
      : sorted;
    return {
      rank: "straight",
      score: encodeScore(RANK_ORDER["straight"], [straightHigh]),
      bestCards,
      name: `Straight (${RANK_NAMES[straightHigh]} high)`,
    };
  }

  if (groups[0][1] === 3) {
    const trips = groups[0][0];
    const kickers = groups.slice(1).map((g) => g[0]);
    return {
      rank: "three-of-a-kind",
      score: encodeScore(RANK_ORDER["three-of-a-kind"], [trips, ...kickers]),
      bestCards: sorted,
      name: `Three of a Kind (${RANK_NAMES[trips]}s)`,
    };
  }

  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const highPair = Math.max(groups[0][0], groups[1][0]);
    const lowPair = Math.min(groups[0][0], groups[1][0]);
    const kicker = groups[2][0];
    return {
      rank: "two-pair",
      score: encodeScore(RANK_ORDER["two-pair"], [highPair, lowPair, kicker]),
      bestCards: sorted,
      name: `Two Pair (${RANK_NAMES[highPair]}s and ${RANK_NAMES[lowPair]}s)`,
    };
  }

  if (groups[0][1] === 2) {
    const pair = groups[0][0];
    const kickers = groups.slice(1).map((g) => g[0]);
    return {
      rank: "pair",
      score: encodeScore(RANK_ORDER["pair"], [pair, ...kickers]),
      bestCards: sorted,
      name: `Pair of ${RANK_NAMES[pair]}s`,
    };
  }

  return {
    rank: "high-card",
    score: encodeScore(RANK_ORDER["high-card"], ranks),
    bestCards: sorted,
    name: `High Card (${RANK_NAMES[ranks[0]]})`,
  };
}

function encodeScore(handRank: number, values: number[]): number {
  let score = handRank * 15 ** 5;
  for (let i = 0; i < values.length && i < 5; i++) {
    score += values[i] * 15 ** (4 - i);
  }
  return score;
}

export function evaluateHand(cards: Card[]): EvaluatedHand {
  if (cards.length < 5) {
    throw new Error(`Need at least 5 cards, got ${cards.length}`);
  }
  if (cards.length === 5) {
    return evaluate5(cards);
  }

  let best: EvaluatedHand | null = null;
  for (const combo of combinations(cards, 5)) {
    const result = evaluate5(combo);
    if (!best || result.score > best.score) {
      best = result;
    }
  }
  return best!;
}

export function compareHands(a: EvaluatedHand, b: EvaluatedHand): number {
  return a.score - b.score;
}
