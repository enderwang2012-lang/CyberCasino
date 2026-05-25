import type {
  Card,
  HandRank,
  HandCategory,
  BoardTexture,
  Suit,
  Rank,
} from "@cybercasino/shared";
import { HAND_STRENGTH_MAP, DRAW_EQUITIES } from "@cybercasino/shared";
import { evaluateHand } from "@cybercasino/engine";

// ---------------------------------------------------------------------------
// Preflop hand percentile (Chen formula approximation)
// ---------------------------------------------------------------------------

const RANK_VALUE: Record<number, number> = {
  2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6, 9: 7, 10: 8, 11: 9, 12: 10, 13: 11, 14: 12,
};

/**
 * Returns a hand percentile (0 = best possible, 1 = worst).
 * Based on a simplified Chen-like scoring for 2-card preflop hands.
 */
export function evaluatePreflopPercentile(cards: Card[]): number {
  if (cards.length < 2) return 0.5;

  const r0 = RANK_VALUE[cards[0].rank] ?? 6;
  const r1 = RANK_VALUE[cards[1].rank] ?? 6;
  const high = Math.max(r0, r1);
  const low = Math.min(r0, r1);
  const gap = high - low;
  const suited = cards[0].suit === cards[1].suit;
  const pair = r0 === r1;

  let score: number;

  if (pair) {
    // Pairs: AA=12, KK=11, ..., 22=0
    score = high * 2 + (high >= 10 ? 6 : 0);
  } else {
    // High card component
    score = high;

    // Suited bonus
    if (suited) score += 2;

    // Gap penalty
    if (gap === 0) score += 0; // already handled pair
    else if (gap === 1) score += 1;
    else if (gap === 2) score += 0;
    else if (gap === 3) score -= 1;
    else if (gap === 4) score -= 2;
    else score -= 4;

    // Connected bonus
    if (gap <= 1 && high >= 5) score += 1;

    // High card bonus
    if (high >= 9) score += 1;
  }

  // Normalize to 0-1 percentile (higher score = better = lower percentile)
  // Max possible score ≈ 20, min ≈ -4
  const normalized = Math.max(0, Math.min(1, (20 - score) / 24));
  return normalized;
}

// ---------------------------------------------------------------------------
// Board texture analysis
// ---------------------------------------------------------------------------

const SUIT_COUNTS = (cards: Card[]): Record<Suit, number> => {
  const counts: Record<string, number> = { h: 0, d: 0, c: 0, s: 0 };
  for (const c of cards) counts[c.suit] = (counts[c.suit] ?? 0) + 1;
  return counts as Record<Suit, number>;
};

const RANKS_SORTED = (cards: Card[]): number[] =>
  [...new Set(cards.map(c => c.rank))].sort((a, b) => a - b);

export function analyzeBoardTexture(board: Card[]): BoardTexture {
  if (board.length === 0) {
    return {
      paired: false,
      monotone: false,
      flushDrawPresent: false,
      straightConnectivity: "low",
      highCardStructure: "broadway",
      dryness: "dry",
    };
  }

  const suitCounts = SUIT_COUNTS(board);
  const ranks = RANKS_SORTED(board);
  const isPaired = board.length !== new Set(board.map(c => c.rank)).size;
  const maxSuitCount = Math.max(...Object.values(suitCounts));
  const isMonotone = maxSuitCount >= board.length;

  // Flush draw present if any suit has 2+ cards on 3-card board (or 3+ on 4-5)
  const flushDrawPresent = maxSuitCount >= 2 && board.length <= 3 ||
    maxSuitCount >= 3;

  // Straight connectivity
  let straightConnectivity: "low" | "medium" | "high" = "low";
  if (ranks.length >= 3) {
    const spread = ranks[ranks.length - 1] - ranks[0];
    const gaps = ranks.length - 1;
    if (spread <= 4 && gaps <= 3) straightConnectivity = "high";
    else if (spread <= 6 && gaps <= 4) straightConnectivity = "medium";
  }

  // High card structure
  const hasAce = ranks.some(r => r === 14);
  const highCards = ranks.filter(r => r >= 11).length;
  let highCardStructure: "ace_high" | "broadway" | "middle" | "low" = "low";
  if (hasAce) highCardStructure = "ace_high";
  else if (highCards >= 2) highCardStructure = "broadway";
  else if (highCards >= 1 || ranks.some(r => r >= 8)) highCardStructure = "middle";

  // Dryness
  let dryness: "dry" | "semi_wet" | "wet" = "dry";
  const wetnessScore =
    (flushDrawPresent ? 2 : 0) +
    (straightConnectivity === "high" ? 2 : straightConnectivity === "medium" ? 1 : 0) +
    (isPaired ? -1 : 0);
  if (wetnessScore >= 3) dryness = "wet";
  else if (wetnessScore >= 1) dryness = "semi_wet";

  return {
    paired: isPaired,
    monotone: isMonotone,
    flushDrawPresent,
    straightConnectivity,
    highCardStructure,
    dryness,
  };
}

// ---------------------------------------------------------------------------
// Draw evaluation
// ---------------------------------------------------------------------------

function countSuit(cards: Card[], suit: Suit): number {
  return cards.filter(c => c.suit === suit).length;
}

function hasStraightDraw(ranks: number[]): { outs: number; type: "straight-draw" | "gutshot" | null } {
  if (ranks.length < 4) return { outs: 0, type: null };

  // Check all possible 5-card straights
  const uniqueRanks = [...new Set(ranks)].sort((a, b) => a - b);
  let maxConnected = 1;
  let currentConnected = 1;

  for (let i = 1; i < uniqueRanks.length; i++) {
    if (uniqueRanks[i] - uniqueRanks[i - 1] === 1) {
      currentConnected++;
      maxConnected = Math.max(maxConnected, currentConnected);
    } else if (uniqueRanks[i] - uniqueRanks[i - 1] === 2) {
      currentConnected = 2; // still could be a gutshot
      maxConnected = Math.max(maxConnected, currentConnected);
    } else {
      currentConnected = 1;
    }
  }

  if (maxConnected >= 4) {
    // Open-ended: 8 outs
    return { outs: 8, type: "straight-draw" };
  }
  // Gutshot: 4 outs
  // Check for one-gap patterns
  for (let i = 0; i < uniqueRanks.length - 2; i++) {
    if (uniqueRanks[i + 2] - uniqueRanks[i] <= 4) {
      return { outs: 4, type: "gutshot" };
    }
  }
  return { outs: 0, type: null };
}

export interface DrawResult {
  type: string;
  equity: number;
  outs: number;
}

/**
 * Evaluate draws for hole cards + board.
 * Returns the best draw or null.
 */
export function evaluateDraws(holeCards: Card[], board: Card[]): DrawResult | null {
  const allCards = [...holeCards, ...board];
  const allRanks = allCards.map(c => c.rank);

  // Flush draw
  const suits: Suit[] = ["h", "d", "c", "s"];
  for (const suit of suits) {
    const heroCards = holeCards.filter(c => c.suit === suit).length;
    const boardCards = board.filter(c => c.suit === suit).length;
    if (heroCards >= 1 && boardCards >= 2) {
      const outs = 9; // 13 - 5 visible = 8-9 remaining, use 9
      if (heroCards >= 2 && boardCards >= 3) {
        // Flush possible already — this isn't a draw, it's a made hand
        continue;
      }
      return { type: "flush-draw", equity: DRAW_EQUITIES["flush-draw"], outs };
    }
  }

  // Combo draw (flush draw + straight draw)
  const hasFlushDraw = suits.some(s => {
    const hero = holeCards.filter(c => c.suit === s).length;
    const b = board.filter(c => c.suit === s).length;
    return hero >= 1 && b >= 2;
  });
  const straightDraw = hasStraightDraw(allRanks);
  if (hasFlushDraw && straightDraw.type) {
    return { type: "combo-draw", equity: DRAW_EQUITIES["combo-draw"], outs: 12 + straightDraw.outs };
  }

  // Straight draw
  if (straightDraw.type) {
    return {
      type: straightDraw.type,
      equity: DRAW_EQUITIES[straightDraw.type],
      outs: straightDraw.outs,
    };
  }

  // Overcards (two hole cards above all board cards, no pair)
  if (board.length >= 3 && holeCards.length >= 2) {
    const maxBoardRank = Math.max(...board.map(c => c.rank));
    const bothOver = holeCards.every(c => c.rank > maxBoardRank);
    const paired = holeCards[0].rank === holeCards[1].rank;
    if (bothOver && !paired) {
      return { type: "overcards", equity: DRAW_EQUITIES["overcards"], outs: 6 };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Postflop hand category classification
// ---------------------------------------------------------------------------

/**
 * Classify a hand into a 9-level category for postflop strategy.
 * Uses the engine's evaluateHand result + board texture + draw analysis.
 */
export function classifyHandCategory(
  holeCards: Card[],
  board: Card[],
  handRank: HandRank,
): HandCategory {
  const draw = evaluateDraws(holeCards, board);
  const strength = HAND_STRENGTH_MAP[handRank] ?? 0.15;

  // Made hands
  if (handRank === "royal-flush" || handRank === "straight-flush" || handRank === "four-of-a-kind") {
    return "nuts";
  }
  if (handRank === "full-house" || handRank === "flush") {
    return "very_strong_value";
  }
  if (handRank === "straight" || handRank === "three-of-a-kind") {
    return "medium_value";
  }
  if (handRank === "two-pair") {
    return "medium_value";
  }

  // Pairs — need kicker analysis
  if (handRank === "pair") {
    const boardRanks = board.map(c => c.rank);
    const holeRanks = holeCards.map(c => c.rank);
    const maxBoardRank = Math.max(...boardRanks) as Rank;
    const highHoleRank = Math.max(...holeRanks);

    // Overpair
    if (holeRanks[0] === holeRanks[1] && holeRanks[0] > maxBoardRank) {
      return "very_strong_value";
    }
    // Top pair top kicker
    if (holeRanks.includes(maxBoardRank)) {
      const otherHole = holeRanks.find(r => r !== maxBoardRank);
      if (otherHole !== undefined && otherHole >= 11) return "medium_value";
      return "thin_value";
    }
    // Top pair weak kicker
    if (holeRanks.includes(maxBoardRank)) {
      return "thin_value";
    }
    // Second pair or worse
    return "showdown_value";
  }

  // High card — check for draws
  if (handRank === "high-card") {
    if (draw) {
      if (draw.outs >= 8) return "strong_draw";
      return "weak_draw";
    }
    // Check for overcards
    if (board.length >= 3) {
      const maxBoardRank = Math.max(...board.map(c => c.rank));
      const overcards = holeCards.filter(c => c.rank > maxBoardRank).length;
      if (overcards >= 2) return "air_with_blocker";
    }
    return "pure_air";
  }

  // Draw-only hands (shouldn't reach here normally, but fallback)
  if (draw) {
    if (draw.outs >= 8) return "strong_draw";
    return "weak_draw";
  }

  return "pure_air";
}

// ---------------------------------------------------------------------------
// Complete hand evaluation (combines engine + classifier)
// ---------------------------------------------------------------------------

export interface HandEvaluation {
  rank: HandRank;
  score: number;
  strength: number;       // 0-1 normalized
  category: HandCategory;
  draw: DrawResult | null;
  bestCards: Card[];
  name: string;
}

/**
 * Full hand evaluation: engine ranking + strength normalization + category + draws.
 */
export function evaluateFullHand(
  holeCards: Card[],
  board: Card[],
): HandEvaluation {
  const allCards = [...holeCards, ...board];
  const evaluated = evaluateHand(allCards);
  const strength = HAND_STRENGTH_MAP[evaluated.rank] ?? 0.15;
  const category = classifyHandCategory(holeCards, board, evaluated.rank);
  const draw = board.length >= 3 ? evaluateDraws(holeCards, board) : null;

  return {
    rank: evaluated.rank,
    score: evaluated.score,
    strength,
    category,
    draw,
    bestCards: evaluated.bestCards,
    name: evaluated.name,
  };
}
