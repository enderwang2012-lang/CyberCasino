import type {
  Card,
  PostflopCondition,
  PostflopRule,
  PostflopAction,
  Street,
  ActionType,
} from "@cybercasino/shared";
import { evaluateHand } from "@cybercasino/engine";
import { sizingScale } from "./preflop";

export interface PostflopContext {
  myCards: Card[];
  communityCards: Card[];
  street: Street;
  isIP: boolean;
  potSize: number;
  callAmount: number;
}

export interface PostflopDecision {
  action: ActionType;
  amount?: number;
  confidence: number;
  matchedRule?: PostflopRule;
}

// ---------------------------------------------------------------------------
// classifyHand — maps a hand situation to a list of PostflopCondition tags
// ---------------------------------------------------------------------------

export function classifyHand(ctx: PostflopContext): PostflopCondition[] {
  const conditions: PostflopCondition[] = [];
  const { myCards, communityCards } = ctx;

  if (communityCards.length < 3) return ["nothing"];

  const allCards = [...myCards, ...communityCards];
  const evaluated = evaluateHand(allCards);

  // 河牌已经能单独成牌，而自己的手牌没有把它变得更大时，这是公牌，不是自己的牌。
  if (communityCards.length >= 5) {
    const boardOnly = evaluateHand(communityCards);
    if (evaluated.score === boardOnly.score) return ["board"];
  }

  // ----- Flush draw detection -----
  const suitCounts = new Map<string, number>();
  for (const c of allCards) {
    suitCounts.set(c.suit, (suitCounts.get(c.suit) || 0) + 1);
  }
  const madeFlush = evaluated.rank === "flush"
    || evaluated.rank === "royal-flush"
    || evaluated.rank === "straight-flush";
  const hasFlushDraw = !madeFlush && [...suitCounts.entries()].some(([suit, count]) =>
    count >= 4 && myCards.some((card) => card.suit === suit),
  );

  // ----- Monster detection (strong made hands) -----
  const monsterRanks = new Set([
    "straight",
    "flush",
    "full-house",
    "four-of-a-kind",
    "straight-flush",
    "royal-flush",
  ]);
  if (monsterRanks.has(evaluated.rank)) {
    conditions.push("monster");
    // Also add the specific made-hand condition
    conditions.push(evaluated.rank as PostflopCondition);
    if (hasFlushDraw) conditions.push("flush-draw");
    return conditions;
  }

  // ----- Board analysis -----
  const boardRanks = communityCards.map((c) => c.rank).sort((a, b) => b - a);
  const myRanks = myCards.map((c) => c.rank);
  const boardMax = boardRanks[0];
  const boardSecond = boardRanks[1];
  const boardMin = boardRanks[boardRanks.length - 1];

  // Set of board ranks for quick lookup
  const boardRankSet = new Set(boardRanks);

  // ----- Pair / trips detection from my cards -----
  const pairedWithBoard: number[] = [];
  for (const r of myRanks) {
    if (boardRankSet.has(r)) pairedWithBoard.push(r);
  }

  // Pocket pair (both cards same rank, not on board)
  const isPocketPair = myRanks[0] === myRanks[1];
  const isOverpair = isPocketPair && myRanks[0] > boardMax;

  // ----- Made hand conditions -----
  // 两对和三条优先于超对。AA 碰到 KK7 是两对，不能再当成只有超对。
  if (evaluated.rank === "three-of-a-kind") {
    conditions.push("three-of-a-kind");
  } else if (evaluated.rank === "two-pair") {
    const myPairsOnBoard = myRanks.filter((r) => boardRankSet.has(r));

    // Top two pair: my two cards each pair with the two highest board cards
    if (
      myPairsOnBoard.length === 2 &&
      myPairsOnBoard.includes(boardMax) &&
      myPairsOnBoard.includes(boardSecond)
    ) {
      conditions.push("top-two-pair");
    } else {
      conditions.push("two-pair");
    }
  } else if (isOverpair) {
    conditions.push("overpair");
  } else if (pairedWithBoard.length > 0) {
    // We have at least one pair — classify by strength
    const pairRank = Math.max(...pairedWithBoard);

    if (pairRank === boardMax) {
      // Top pair — classify by kicker
      const kicker = myRanks.find((r) => r !== pairRank) ?? 0;
      if (kicker === 14) {
        conditions.push("top-pair-top-kicker");
      } else if (kicker >= 12) {
        // K or Q
        conditions.push("top-pair-good-kicker");
      } else {
        conditions.push("top-pair-weak-kicker");
      }
    } else if (pairRank === boardSecond) {
      conditions.push("second-pair");
    } else if (pairRank === boardMin && communityCards.length === 3) {
      // On the flop, pairing the lowest board card
      conditions.push("bottom-pair");
    } else {
      conditions.push("middle-pair");
    }
  } else if (evaluated.rank === "pair") {
    // Pair from board only (neither of our cards paired) — treat as nothing
    conditions.push("nothing");
  }

  // ----- Overcards -----
  if (conditions.length === 0 && myRanks.every((r) => r > boardMax)) {
    conditions.push("overcards");
  }

  // ----- Draws -----
  if (hasFlushDraw) {
    conditions.push("flush-draw");
  }

  // 听牌必须用到自己的牌。公牌自己已经四张连着时，不算自己的顺子听牌。
  const allRankNums = new Set<number>(allCards.map((c) => c.rank));
  if (allRankNums.has(14)) allRankNums.add(1);
  const holeRankNums = new Set<number>(myRanks);
  if (holeRankNums.has(14)) holeRankNums.add(1);
  const sortedUnique = [...allRankNums].sort((a, b) => a - b);

  let hasOpenEnded = false;
  let hasGutshot = false;

  for (let i = 0; i <= sortedUnique.length - 4; i++) {
    const window = sortedUnique.slice(i, i + 4);
    if (!window.some((rank) => holeRankNums.has(rank))) continue;
    const span = window[3] - window[0];

    if (span === 3) {
      hasOpenEnded = true;
    } else if (span === 4) {
      hasGutshot = true;
    }
  }

  if (hasOpenEnded) conditions.push("straight-draw");
  if (hasGutshot && !hasOpenEnded) conditions.push("gutshot");

  // ----- Fallback -----
  if (conditions.length === 0) {
    conditions.push("nothing");
  }

  return conditions;
}

// ---------------------------------------------------------------------------
// matchRules — find the first matching rule from a prioritized list
// ---------------------------------------------------------------------------

export function matchRules(
  conditions: PostflopCondition[],
  rules: PostflopRule[],
  ctx: PostflopContext,
  random: () => number = Math.random,
): PostflopRule | null {
  // Sort by priority (lower = higher priority, default 0)
  const sorted = [...rules].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

  for (const rule of sorted) {
    // Must match the condition
    if (!conditions.includes(rule.when)) continue;

    // Position filter
    if (rule.position && rule.position !== "any") {
      if (rule.position === "IP" && !ctx.isIP) continue;
      if (rule.position === "OOP" && ctx.isIP) continue;
    }

    // Street filter
    if (rule.streets && rule.streets.length > 0) {
      if (!rule.streets.includes(ctx.street)) continue;
    }

    // Facing-bet rules must be selected according to the actual wager size.
    if (rule.vsBetSize && rule.vsBetSize !== "any") {
      if (ctx.callAmount <= 0) continue;
      const betRatio = ctx.potSize > 0 ? ctx.callAmount / ctx.potSize : 1;
      const betSize = betRatio <= 0.33 ? "small" : betRatio <= 0.75 ? "medium" : "large";
      if (rule.vsBetSize !== betSize) continue;
    }

    // Frequency filter (probability of applying this rule)
    if (rule.frequency !== undefined && rule.frequency < 1) {
      if (random() > rule.frequency) continue;
    }

    return rule;
  }

  return null;
}

// ---------------------------------------------------------------------------
// resolveAction — convert a PostflopAction string to concrete ActionType + amount
// ---------------------------------------------------------------------------

export function resolveAction(
  action: PostflopAction,
  potSize: number,
  currentBet: number,
  minRaise: number,
  callAmount = 0,
  sizingPressure?: number,
): { type: ActionType; amount?: number } {
  // 加注额按“跟注之后的底池”计算。面对下注时，一倍底池要先把跟注算进去。
  const scale = sizingScale(sizingPressure);
  const raiseTo = (ratio: number) => {
    const potAfterCall = potSize + Math.max(0, callAmount);
    const raiseBy = Math.round(potAfterCall * ratio * scale);
    return {
      type: "raise" as const,
      amount: Math.max(currentBet + minRaise, currentBet + raiseBy),
    };
  };
  switch (action) {
    case "value-bet-small":
      return raiseTo(0.33);
    case "value-bet-medium":
    case "semi-bluff-small":
      return raiseTo(0.5);
    case "value-bet-large":
    case "semi-bluff-medium":
      return raiseTo(0.75);
    case "value-bet-pot":
    case "semi-bluff-large":
      return raiseTo(1.0);
    case "overbet":
      return raiseTo(1.5);
    case "bluff-small":
      return raiseTo(0.33);
    case "bluff-medium":
      return raiseTo(0.67);
    case "bluff-large":
      return raiseTo(0.75);
    case "check-call":
    case "slowplay":
    case "trap":
    case "check-call-flop-evaluate-turn":
      if (currentBet > 0) return { type: "call" };
      return { type: "check" };
    case "check-fold":
      if (currentBet > 0) return { type: "fold" };
      return { type: "check" };
    case "check-raise":
      return raiseTo(0.75);
    case "donk-bet":
      return raiseTo(0.33);
    default:
      return { type: "check" };
  }
}

// ---------------------------------------------------------------------------
// decidePostflop — main entry point for postflop decision
// ---------------------------------------------------------------------------

export function decidePostflop(
  ctx: PostflopContext,
  rules: PostflopRule[],
  currentBet: number,
  minRaise: number,
  validActions: ActionType[],
  random: () => number = Math.random,
  sizingPressure?: number,
): PostflopDecision {
  const conditions = classifyHand(ctx);
  const matchedRule = matchRules(conditions, rules, ctx, random);

  if (matchedRule) {
    const resolved = resolveAction(matchedRule.action, ctx.potSize, currentBet, minRaise, ctx.callAmount, sizingPressure);

    // If the resolved action is not valid, try to adapt
    if (!validActions.includes(resolved.type)) {
      if (resolved.type === "raise" && validActions.includes("call")) {
        return {
          action: "call",
          confidence: 0.5,
          matchedRule,
        };
      }
      if (resolved.type === "call" && !validActions.includes("call")) {
        return {
          action: validActions.includes("check") ? "check" : "fold",
          confidence: 0.4,
          matchedRule,
        };
      }
      // Fallback: pick the least costly valid action
      if (validActions.includes("check")) {
        return { action: "check", confidence: 0.3, matchedRule };
      }
      return { action: "fold", confidence: 0.3, matchedRule };
    }

    return {
      action: resolved.type,
      amount: resolved.amount,
      confidence: 0.75,
      matchedRule,
    };
  }

  // No rule matched — default to cautious play
  if (ctx.callAmount === 0 && validActions.includes("check")) {
    return { action: "check", confidence: 0.4 };
  }
  if (ctx.callAmount > 0 && validActions.includes("call") && ctx.callAmount <= ctx.potSize * 0.5) {
    return { action: "call", confidence: 0.35 };
  }
  return { action: "fold", confidence: 0.5 };
}
