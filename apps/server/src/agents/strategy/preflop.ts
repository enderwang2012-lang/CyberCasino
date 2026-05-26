import type {
  Card,
  Position,
  PreflopConfig,
  AgentGameView,
  StackDepthAdjustment,
  PreflopContextRule,
} from "@cybercasino/shared";

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
  adjustments?: string[];  // 动态调整原因列表，供 AI 思考表达使用
}

// ---------------------------------------------------------------------------
// Preflop context analysis
// ---------------------------------------------------------------------------

export interface PreflopContextInfo {
  effectiveStackBB: number;   // 有效筹码（大盲数）
  playerCount: number;        // 入池人数（未弃牌）
  potOdds: number;            // 底池赔率（跟注额 / (底池+跟注额)）
  isLastToAct: boolean;       // 是否最后行动
  SPR: number;                // 筹码底池比（翻后才准，翻前用不到）
}

/**
 * Analyze the current preflop context from the game view.
 */
export function analyzePreflopContext(view: AgentGameView): PreflopContextInfo {
  const activePlayers = view.players.filter((p) => !p.folded);
  const playerCount = activePlayers.length;
  const effectiveStackBB = Math.min(
    ...activePlayers.map((p) => p.chips),
  ) / view.bigBlind;

  const totalPot = view.pots.reduce((s, p) => s + p.amount, 0) + view.myBet;
  const potOdds = view.currentBet > 0
    ? view.currentBet / (totalPot + view.currentBet)
    : 0;

  // Last to act: no players after me who haven't folded
  const mySeat = view.players.find((p) => p.id === view.myId)?.seatIndex ?? 0;
  const dealerSeat = view.dealerSeatIndex;
  const playerTotal = view.players.length;
  const myOffset = (mySeat - dealerSeat + playerTotal) % playerTotal;
  const playersAfterMe = activePlayers.filter((p) => {
    if (p.id === view.myId) return false;
    const offset = (p.seatIndex - dealerSeat + playerTotal) % playerTotal;
    return offset > myOffset;
  }).length;
  const isLastToAct = playersAfterMe === 0;

  const spr = totalPot > 0 ? view.myChips / totalPot : 999;

  return { effectiveStackBB, playerCount, potOdds, isLastToAct, SPR: spr };
}

/**
 * Apply stack-depth adjustments: widen/tighten ranges based on effective stack.
 */
function applyStackAdjustments(
  raiseSet: Set<string>,
  callSet: Set<string>,
  adjustments: StackDepthAdjustment[],
  effectiveStackBB: number,
  myStackBB?: number,
): { raiseSet: Set<string>; callSet: Set<string>; reasons: string[] } {
  const reasons: string[] = [];
  let raisers = new Set(raiseSet);
  let callers = new Set(callSet);
  // Use player's own stack for display, effective stack for decisions
  const displayBB = myStackBB ?? effectiveStackBB;

  for (const adj of adjustments) {
    if (effectiveStackBB > adj.minBB) continue;

    if (adj.pushFold && effectiveStackBB <= 10) {
      // Push/fold mode: all call hands become raise, no calling
      for (const hand of callers) raisers.add(hand);
      callers = new Set<string>();
      reasons.push(`短筹码 push/fold 模式（${displayBB.toFixed(1)}bb）`);
      break; // push/fold overrides everything else
    }

    if (adj.widenRange) {
      for (const hand of adj.widenRange) {
        for (const expanded of expandRangeEntry(hand)) {
          if (!raisers.has(expanded) && !callers.has(expanded)) {
            raisers.add(expanded);
            reasons.push(`筹码不深（${displayBB.toFixed(1)}bb），放宽 ${expanded}`);
          }
        }
      }
    }

    if (adj.tightenRange) {
      for (const hand of adj.tightenRange) {
        for (const expanded of expandRangeEntry(hand)) {
          if (raisers.has(expanded)) {
            raisers.delete(expanded);
            callers.add(expanded);
            reasons.push(`筹码不深（${displayBB.toFixed(1)}bb），${expanded} 从加注降为跟注`);
          }
        }
      }
    }
  }

  return { raiseSet: raisers, callSet: callers, reasons };
}

/**
 * Apply context rules: tighten/widen based on game situation.
 */
function applyContextRules(
  raiseSet: Set<string>,
  callSet: Set<string>,
  rules: PreflopContextRule[],
  ctx: PreflopContextInfo,
): { raiseSet: Set<string>; callSet: Set<string>; reasons: string[] } {
  const reasons: string[] = [];
  let raisers = new Set(raiseSet);
  let callers = new Set(callSet);

  for (const rule of rules) {
    let matches = false;
    switch (rule.condition) {
      case "multiway":
        matches = ctx.playerCount >= 4;
        if (matches) reasons.push(`${ctx.playerCount}人入池，多人底池收紧`);
        break;
      case "shortStack":
        matches = ctx.effectiveStackBB <= 15;
        if (matches) reasons.push(`短筹码（${ctx.effectiveStackBB.toFixed(1)}bb），收紧范围`);
        break;
      case "deepStack":
        matches = ctx.effectiveStackBB >= 100;
        if (matches) reasons.push(`深筹码（${ctx.effectiveStackBB.toFixed(1)}bb），放宽投机牌`);
        break;
      case "highPotOdds":
        matches = ctx.potOdds >= 0.3;
        if (matches) reasons.push(`底池赔率好（${(ctx.potOdds * 100).toFixed(0)}%），放宽跟注范围`);
        break;
      case "lastToAct":
        matches = ctx.isLastToAct;
        if (matches) reasons.push(`最后行动，位置优势，放宽范围`);
        break;
    }

    if (!matches) continue;

    if (rule.adjust === "tighten") {
      // Move some raise hands to call
      const toMove = [...raisers].slice(-Math.ceil(raisers.size * 0.2));
      for (const h of toMove) { raisers.delete(h); callers.add(h); }
    } else if (rule.adjust === "widen") {
      // Move some call hands to raise
      const toMove = [...callers].slice(0, Math.ceil(callers.size * 0.3));
      for (const h of toMove) { callers.delete(h); raisers.add(h); }
    } else if (rule.adjust === "aggressive") {
      // All call hands become raise
      for (const h of callers) raisers.add(h);
      callers = new Set<string>();
      reasons.push("激进模式：所有跟注牌升级为加注");
    }
  }

  return { raiseSet: raisers, callSet: callers, reasons };
}

/**
 * Make a preflop decision based on the strategy config.
 *
 * Logic:
 *   1. Compute context (stack depth, player count, pot odds, position)
 *   2. Apply stack-adjustments & context-rules to ranges
 *   3. Hand in raise range → raise
 *   4. Hand in call range → call
 *   5. Otherwise → fold
 */
export function decidePreflop(
  hand: Card[],
  position: Position,
  config: PreflopConfig,
  callAmount: number,
  minRaise: number,
  bigBlind: number,
  currentBet: number,
  view?: AgentGameView,
): PreflopDecision | null {
  const posRange = config.ranges[position];
  if (!posRange) return null;

  let raiseSet = buildRangeSet(posRange.raise);
  let callSet = buildRangeSet(posRange.call);
  const adjustments: string[] = [];

  // Dynamic adjustments (only when view is provided)
  if (view) {
    const ctx = analyzePreflopContext(view);

    if (config.stackAdjustments?.length) {
      const myStackBB = view.myChips / bigBlind;
      const result = applyStackAdjustments(raiseSet, callSet, config.stackAdjustments, ctx.effectiveStackBB, myStackBB);
      raiseSet = result.raiseSet;
      callSet = result.callSet;
      adjustments.push(...result.reasons);
    }

    if (config.contextRules?.length) {
      const result = applyContextRules(raiseSet, callSet, config.contextRules, ctx);
      raiseSet = result.raiseSet;
      callSet = result.callSet;
      adjustments.push(...result.reasons);
    }
  }

  const handKey = handToKey(hand);

  if (raiseSet.has(handKey)) {
    const sizingStr = currentBet <= bigBlind ? config.sizing.openRaise : config.sizing.threeBet;
    const sizingMultiplier = parseFloat(sizingStr) || 2.5;
    const minTotalBet = currentBet + minRaise;
    const isPushFold = adjustments.some((reason) => reason.includes("push/fold"));
    const raiseAmount = isPushFold && view
      ? view.myBet + view.myChips
      : Math.max(minTotalBet, Math.round(bigBlind * sizingMultiplier));
    return {
      action: "raise",
      amount: raiseAmount,
      confidence: 0.9,
      adjustments: adjustments.length > 0 ? adjustments : undefined,
    };
  }

  if (callSet.has(handKey) && callAmount <= bigBlind * 3) {
    return {
      action: "call",
      confidence: 0.7,
      adjustments: adjustments.length > 0 ? adjustments : undefined,
    };
  }

  return {
    action: "fold",
    confidence: 0.8,
    adjustments: adjustments.length > 0 ? adjustments : undefined,
  };
}
