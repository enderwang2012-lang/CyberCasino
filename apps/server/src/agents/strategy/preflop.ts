import type { Card, Position, PreflopConfig } from "@cybercasino/shared";

/** Convert rank number to display character */
function rankToChar(rank: number): string {
  if (rank === 14) return "A";
  if (rank === 13) return "K";
  if (rank === 12) return "Q";
  if (rank === 11) return "J";
  if (rank === 10) return "T";
  return String(rank);
}

/** Convert character back to rank number */
function charToRank(ch: string): number {
  if (ch === "A") return 14;
  if (ch === "K") return 13;
  if (ch === "Q") return 12;
  if (ch === "J") return 11;
  if (ch === "T") return 10;
  return Number(ch);
}

/**
 * Convert a pair of hole cards to standard hand key notation.
 * Examples: ["Ah","Kd"] -> "AKo", ["Ts","9s"] -> "T9o" wait no "T9s", ["7c","7d"] -> "77"
 */
function handToKey(cards: Card[]): string {
  const sorted = [...cards].sort((a, b) => b.rank - a.rank);
  const high = rankToChar(sorted[0].rank);
  const low = rankToChar(sorted[1].rank);
  if (high === low) return high + low;
  const suited = sorted[0].suit === sorted[1].suit ? "s" : "o";
  return high + low + suited;
}

/**
 * Parse a hand key like "AKs" into { high, low, suited }.
 * For pairs, suited is undefined.
 */
function parseHandKey(key: string): { high: number; low: number; suited?: boolean } {
  const chars = key.split("");
  const high = charToRank(chars[0]);
  const low = charToRank(chars[1]);
  const suited = chars[2] === "s" ? true : chars[2] === "o" ? false : undefined;
  return { high, low, suited };
}

/**
 * Expand a single range entry into a set of matching hand keys.
 * Supports:
 *   - Exact: "AA", "AKs", "T9o"
 *   - Pair+: "99+" → 99, TT, JJ, QQ, KK, AA
 *   - Suited+: "ATs+" → ATs, AJs, AQs, AKs
 *   - Offsuit+: "KTo+" → KTo, KJo, KQo
 *   - Both+: "KTo+" with no suffix is not standard; "KQo+" only matches offsuit.
 */
function expandRangeEntry(entry: string): Set<string> {
  const result = new Set<string>();

  // Pair shorthand: "99+", "TT+", etc.
  if (entry.length === 3 && entry[2] === "+" && entry[0] === entry[1]) {
    const startRank = charToRank(entry[0]);
    for (let r = startRank; r <= 14; r++) {
      const ch = rankToChar(r);
      result.add(ch + ch);
    }
    return result;
  }

  // Suited/offsuit shorthand with "+": "ATs+", "KTo+"
  if (entry.length === 4 && entry[3] === "+") {
    const highRank = charToRank(entry[0]);
    const lowRank = charToRank(entry[1]);
    const suffix = entry[2]; // "s" or "o"
    for (let r = lowRank + 1; r <= highRank; r++) {
      if (r === highRank) continue; // skip the exact hand itself, only higher kickers
      result.add(rankToChar(highRank) + rankToChar(r) + suffix);
    }
    // Include the base hand
    result.add(entry.slice(0, 3));
    return result;
  }

  // Exact match
  result.add(entry);
  return result;
}

/**
 * Build a lookup set from a range array by expanding all entries.
 */
function buildRangeSet(range: string[]): Set<string> {
  const set = new Set<string>();
  for (const entry of range) {
    for (const hand of expandRangeEntry(entry)) {
      set.add(hand);
    }
  }
  return set;
}

/**
 * Check if a hand matches any entry in the given range.
 * Supports exact match ("AA", "AKs", "T9o") and shorthand ("99+", "ATs+", "KTo+").
 */
export function matchesRange(hand: Card[], range: string[]): boolean {
  const key = handToKey(hand);
  const rangeSet = buildRangeSet(range);
  return rangeSet.has(key);
}

export interface PreflopDecision {
  action: "raise" | "call" | "fold";
  amount?: number;
  confidence: number;
}

/**
 * Make a preflop decision based on the strategy config.
 *
 * Logic:
 *   1. Hand in raise range → raise (confidence 0.9)
 *   2. Hand in call range AND callAmount <= 3bb → call (confidence 0.7)
 *   3. Otherwise → fold (confidence 0.8)
 */
export function decidePreflop(
  hand: Card[],
  position: Position,
  config: PreflopConfig,
  callAmount: number,
  minRaise: number,
  bigBlind: number,
  currentBet: number,
): PreflopDecision | null {
  const posRange = config.ranges[position];
  if (!posRange) return null;

  if (matchesRange(hand, posRange.raise)) {
    // Determine raise sizing from config
    const sizingStr = currentBet <= bigBlind ? config.sizing.openRaise : config.sizing.threeBet;
    const sizingMultiplier = parseFloat(sizingStr) || 2.5;
    const raiseAmount = Math.max(minRaise, Math.round(bigBlind * sizingMultiplier));
    return {
      action: "raise",
      amount: raiseAmount,
      confidence: 0.9,
    };
  }

  if (matchesRange(hand, posRange.call) && callAmount <= bigBlind * 3) {
    return {
      action: "call",
      confidence: 0.7,
    };
  }

  return {
    action: "fold",
    confidence: 0.8,
  };
}
