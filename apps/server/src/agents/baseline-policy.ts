import type {
  Card,
  Position,
  Street,
  ActionType,
  DecisionState,
  PolicyOutput,
  HandCategory,
  BoardTexture,
  PreflopNode,
} from "@cybercasino/shared";
import {
  evaluatePreflopPercentile,
  analyzeBoardTexture,
  classifyHandCategory,
  evaluateDraws,
} from "./hand-classifier";
import { HAND_STRENGTH_MAP } from "@cybercasino/shared";
import { evaluateHand } from "@cybercasino/engine";

// ---------------------------------------------------------------------------
// Position weights (multipliers on open range)
// ---------------------------------------------------------------------------

const POSITION_WEIGHTS: Record<Position, number> = {
  UTG: 0.75,
  MP: 0.88,
  CO: 1.00,
  BTN: 1.15,
  SB: 0.85,
  BB: 1.00,
};

// ---------------------------------------------------------------------------
// Preflop range tables
// ---------------------------------------------------------------------------
// Percentile thresholds for different actions at different positions.
// percentile 0 = best hand (AA), 1 = worst hand (72o).

interface PreflopRangeEntry {
  raiseMax: number;   // percentile below which we raise
  callMax: number;    // percentile below which we call (if facing open)
}

const PREFLOP_RANGES: Record<Position, PreflopRangeEntry> = {
  UTG:  { raiseMax: 0.12, callMax: 0.18 },
  MP:   { raiseMax: 0.18, callMax: 0.25 },
  CO:   { raiseMax: 0.25, callMax: 0.35 },
  BTN:  { raiseMax: 0.35, callMax: 0.45 },
  SB:   { raiseMax: 0.22, callMax: 0.30 },
  BB:   { raiseMax: 0.00, callMax: 0.25 },  // BB doesn't open, defends
};

// 3-bet ranges (facing an open)
const THREE_BET_RANGES: Record<Position, number> = {
  UTG: 0.06,
  MP: 0.08,
  CO: 0.10,
  BTN: 0.12,
  SB: 0.10,
  BB: 0.10,
};

// ---------------------------------------------------------------------------
// Preflop decision
// ---------------------------------------------------------------------------

function preflopPolicy(state: DecisionState): PolicyOutput {
  const { position, holeCards } = state.hero;
  const percentile = evaluatePreflopPercentile(holeCards);
  const posWeight = POSITION_WEIGHTS[position];
  const effectivePercentile = percentile / posWeight;  // adjust for position
  const node = state.actionContext.preflopNode ?? "unopened";

  const tags: string[] = ["preflop"];

  // Short stack push/fold (M < 8)
  if (state.table.effectiveStackBb <= 8) {
    tags.push("short_stack");
    if (effectivePercentile <= 0.30) {
      return { actions: { raise: 1.0 }, sizings: [{ sizePotRatio: 0, probability: 1.0 }], reasoningTags: [...tags, "push"] };
    }
    return { actions: { fold: 1.0 }, reasoningTags: [...tags, "fold"] };
  }

  switch (node) {
    case "unopened": {
      const range = PREFLOP_RANGES[position];
      if (effectivePercentile <= range.raiseMax) {
        return { actions: { raise: 1.0 }, sizings: [{ sizePotRatio: 3.0, probability: 1.0 }], reasoningTags: [...tags, "open_raise"] };
      }
      if (effectivePercentile <= range.callMax && position === "BB") {
        return { actions: { call: 1.0 }, reasoningTags: [...tags, "defend_bb"] };
      }
      return { actions: { fold: 1.0 }, reasoningTags: [...tags, "fold"] };
    }

    case "facing_open": {
      const threeBetRange = THREE_BET_RANGES[position];
      if (effectivePercentile <= threeBetRange) {
        return { actions: { raise: 1.0 }, sizings: [{ sizePotRatio: 3.0, probability: 1.0 }], reasoningTags: [...tags, "3bet"] };
      }
      if (effectivePercentile <= PREFLOP_RANGES[position].callMax) {
        return { actions: { call: 1.0 }, reasoningTags: [...tags, "call_open"] };
      }
      return { actions: { fold: 1.0 }, reasoningTags: [...tags, "fold_to_open"] };
    }

    case "facing_three_bet": {
      if (effectivePercentile <= 0.05) {
        return { actions: { raise: 1.0 }, sizings: [{ sizePotRatio: 2.5, probability: 1.0 }], reasoningTags: [...tags, "4bet"] };
      }
      if (effectivePercentile <= 0.15) {
        return { actions: { call: 1.0 }, reasoningTags: [...tags, "call_3bet"] };
      }
      return { actions: { fold: 1.0 }, reasoningTags: [...tags, "fold_to_3bet"] };
    }

    case "blind_vs_blind": {
      // SB vs BB: wider range
      if (effectivePercentile <= 0.50) {
        return { actions: { raise: 1.0 }, sizings: [{ sizePotRatio: 2.5, probability: 1.0 }], reasoningTags: [...tags, "sb_raise"] };
      }
      return { actions: { fold: 1.0 }, reasoningTags: [...tags, "sb_fold"] };
    }

    default: {
      // Fallback: use simple percentile
      if (effectivePercentile <= 0.20) {
        return { actions: { raise: 1.0 }, sizings: [{ sizePotRatio: 3.0, probability: 1.0 }], reasoningTags: [...tags, "default_raise"] };
      }
      return { actions: { fold: 1.0 }, reasoningTags: [...tags, "default_fold"] };
    }
  }
}

// ---------------------------------------------------------------------------
// Postflop decision
// ---------------------------------------------------------------------------

function postflopPolicy(state: DecisionState): PolicyOutput {
  const { holeCards } = state.hero;
  const board = state.board.cards;
  const street = state.street;
  const tags: string[] = ["postflop", street];

  // Evaluate hand
  const allCards = [...holeCards, ...board];
  const evaluated = evaluateHand(allCards);
  const handCategory = state.derived.handCategory ?? classifyHandCategory(holeCards, board, evaluated.rank);
  const boardTexture = state.board.texture ?? analyzeBoardTexture(board);
  const potBb = state.table.potBb;
  const facingBet = state.actionContext.facingBetBb;
  const spr = state.derived.spr;
  const multiway = state.derived.multiway;
  const heroHasInitiative = state.actionContext.heroHasInitiative;
  const draw = evaluateDraws(holeCards, board);

  // Discrete sizing options per street
  const sizingOptions: Record<string, number[]> = {
    preflop: [2.5, 3.0, 4.0],
    flop: [0.33, 0.50, 0.75],
    turn: [0.50, 0.75, 1.00],
    river: [0.50, 0.75, 1.00, 1.50],
  };
  const options = sizingOptions[street] ?? sizingOptions.flop;

  // Decision logic by hand category
  switch (handCategory) {
    case "nuts":
    case "very_strong_value": {
      tags.push("value_bet");
      // Bet for value with large sizing
      const sizing = boardTexture.dryness === "dry" ? options[options.length - 1] : options[options.length - 2];
      if (facingBet > 0) {
        // Facing a bet: raise for value
        const raiseSize = Math.max(facingBet * 3, potBb * 0.75);
        return { actions: { raise: 1.0 }, sizings: [{ sizePotRatio: raiseSize / potBb, probability: 1.0 }], reasoningTags: tags };
      }
      return { actions: { bet: 1.0 }, sizings: [{ sizePotRatio: sizing, probability: 1.0 }], reasoningTags: tags };
    }

    case "medium_value": {
      tags.push("medium_value");
      if (facingBet > 0) {
        // Facing bet: call if price is right, raise sometimes for protection
        const potOdds = facingBet / (potBb + facingBet);
        if (spr <= 3) {
          // Low SPR: commit
          return { actions: { raise: 0.3, call: 0.7 }, sizings: [{ sizePotRatio: 0.75, probability: 1.0 }], reasoningTags: [...tags, "commit"] };
        }
        return { actions: { call: 0.8, fold: 0.2 }, reasoningTags: [...tags, "call"] };
      }
      // Bet for value/protection
      const sizing = boardTexture.dryness === "wet" ? options[1] : options[0];
      return { actions: { bet: 0.7, check: 0.3 }, sizings: [{ sizePotRatio: sizing, probability: 1.0 }], reasoningTags: [...tags, "thin_value"] };
    }

    case "thin_value": {
      tags.push("thin_value");
      if (facingBet > 0) {
        return { actions: { call: 0.6, fold: 0.4 }, reasoningTags: [...tags, "marginal_call"] };
      }
      // Small bet for value/protection
      return { actions: { bet: 0.5, check: 0.5 }, sizings: [{ sizePotRatio: options[0], probability: 1.0 }], reasoningTags: [...tags, "thin_bet"] };
    }

    case "showdown_value": {
      tags.push("showdown_value");
      if (facingBet > 0) {
        // Pot control: call small, fold to big
        if (facingBet <= potBb * 0.5) {
          return { actions: { call: 0.7, fold: 0.3 }, reasoningTags: [...tags, "catch"] };
        }
        return { actions: { fold: 0.6, call: 0.4 }, reasoningTags: [...tags, "fold_to_big"] };
      }
      return { actions: { check: 0.8, bet: 0.2 }, sizings: [{ sizePotRatio: options[0], probability: 1.0 }], reasoningTags: [...tags, "check"] };
    }

    case "strong_draw": {
      tags.push("strong_draw");
      if (draw) {
        // Semi-bluff or call with good odds
        if (facingBet > 0) {
          const potOdds = facingBet / (potBb + facingBet);
          if (draw.equity > potOdds) {
            return { actions: { call: 0.6, raise: 0.4 }, sizings: [{ sizePotRatio: 0.75, probability: 1.0 }], reasoningTags: [...tags, "equity_call"] };
          }
          return { actions: { raise: 0.5, fold: 0.5 }, sizings: [{ sizePotRatio: 0.75, probability: 1.0 }], reasoningTags: [...tags, "semi_bluff"] };
        }
        return { actions: { bet: 0.7, check: 0.3 }, sizings: [{ sizePotRatio: options[1], probability: 1.0 }], reasoningTags: [...tags, "semi_bluff_bet"] };
      }
      return { actions: { check: 0.6, bet: 0.4 }, sizings: [{ sizePotRatio: options[0], probability: 1.0 }], reasoningTags: [...tags, "draw_no_outs"] };
    }

    case "weak_draw": {
      tags.push("weak_draw");
      if (facingBet > 0) {
        if (facingBet <= potBb * 0.3) {
          return { actions: { call: 0.5, fold: 0.5 }, reasoningTags: [...tags, "cheap_draw"] };
        }
        return { actions: { fold: 0.7, call: 0.3 }, reasoningTags: [...tags, "fold_draw"] };
      }
      return { actions: { check: 0.7, bet: 0.3 }, sizings: [{ sizePotRatio: options[0], probability: 1.0 }], reasoningTags: [...tags, "check_draw"] };
    }

    case "air_with_blocker": {
      tags.push("air_blocker");
      if (facingBet > 0) {
        return { actions: { fold: 0.7, raise: 0.3 }, sizings: [{ sizePotRatio: 0.75, probability: 1.0 }], reasoningTags: [...tags, "blocker_bluff"] };
      }
      // Can bluff with blocker
      return { actions: { bet: 0.4, check: 0.6 }, sizings: [{ sizePotRatio: options[1], probability: 1.0 }], reasoningTags: [...tags, "blocker_bet"] };
    }

    case "pure_air":
    default: {
      tags.push("air");
      if (facingBet > 0) {
        return { actions: { fold: 0.85, raise: 0.15 }, sizings: [{ sizePotRatio: 0.75, probability: 1.0 }], reasoningTags: [...tags, "fold_air"] };
      }
      // Bluff opportunity
      if (heroHasInitiative && boardTexture.dryness !== "wet") {
        return { actions: { bet: 0.35, check: 0.65 }, sizings: [{ sizePotRatio: options[0], probability: 1.0 }], reasoningTags: [...tags, "cbet_bluff"] };
      }
      return { actions: { check: 0.9, bet: 0.1 }, reasoningTags: [...tags, "check_giveup"] };
    }
  }
}

// ---------------------------------------------------------------------------
// Main baseline policy
// ---------------------------------------------------------------------------

/**
 * Compute baseline strategy for a given decision state.
 * Returns probability distribution over actions with sizing suggestions.
 */
export function baselinePolicy(state: DecisionState): PolicyOutput {
  if (state.street === "preflop") {
    return preflopPolicy(state);
  }
  return postflopPolicy(state);
}

/**
 * Build a DecisionState from an AgentGameView (the existing interface).
 * Bridge between old game view and new decision state.
 */
export function buildDecisionState(
  view: {
    myId: string;
    myCards: Card[];
    myChips: number;
    myBet: number;
    phase: string;
    communityCards: Card[];
    pots: { amount: number; eligiblePlayerIds: string[] }[];
    players: { id: string; name: string; chips: number; bet: number; folded: boolean; allIn: boolean; seatIndex: number; }[];
    dealerSeatIndex: number;
    smallBlind: number;
    bigBlind: number;
    currentBet: number;
    minRaise: number;
    handNumber: number;
    actionHistory: { playerId: string; phase: string; action: { type: string; amount?: number } }[];
  },
  validActions: string[],
  callAmount: number,
  position: Position,
  handId: string,
): DecisionState {
  const bb = view.bigBlind;
  const myPlayer = view.players.find(p => p.id === view.myId);
  const activePlayers = view.players.filter(p => !p.folded && !p.allIn).length;
  const potTotal = view.pots.reduce((sum, p) => sum + p.amount, 0);

  // Effective stack = min of all active players' stacks
  const activeStacks = view.players
    .filter(p => !p.folded)
    .map(p => p.chips);
  const effectiveStack = Math.min(...activeStacks);

  // SPR = effective stack / pot
  const spr = potTotal > 0 ? effectiveStack / potTotal : 20;

  // Board texture
  const boardTexture = view.communityCards.length >= 3
    ? analyzeBoardTexture(view.communityCards)
    : undefined;

  // Hand category (postflop only)
  let handCategory: HandCategory | undefined;
  let handStrength: number | undefined;
  let drawStrength: number | undefined;

  if (view.communityCards.length >= 3 && view.myCards.length === 2) {
    const evaluated = evaluateHand([...view.myCards, ...view.communityCards]);
    handCategory = classifyHandCategory(view.myCards, view.communityCards, evaluated.rank);
    handStrength = HAND_STRENGTH_MAP[evaluated.rank] ?? 0.15;
    const draw = evaluateDraws(view.myCards, view.communityCards);
    drawStrength = draw?.equity;
  }

  // Determine street
  const streetMap: Record<string, Street> = {
    preflop: "preflop",
    flop: "flop",
    turn: "turn",
    river: "river",
  };
  const street = streetMap[view.phase] ?? "preflop";

  // Determine preflop node
  let preflopNode: PreflopNode | undefined;
  if (street === "preflop") {
    const openActions = view.actionHistory.filter(a => a.phase === "preflop" && (a.action.type === "raise" || a.action.type === "call"));
    const hasOpen = openActions.some(a => a.action.type === "raise");
    const facingOpen = hasOpen && view.actionHistory[view.actionHistory.length - 1]?.action.type === "raise";
    if (facingOpen) {
      preflopNode = "facing_open";
    } else if (!hasOpen) {
      preflopNode = "unopened";
    } else {
      preflopNode = "facing_open_and_call";
    }
  }

  // Hero has initiative if hero was last aggressor
  const lastAggressor = [...view.actionHistory].reverse().find(a => a.action.type === "raise");
  const heroHasInitiative = lastAggressor?.playerId === view.myId;

  return {
    handId,
    street,
    hero: {
      seat: myPlayer?.seatIndex ?? 0,
      position,
      holeCards: view.myCards,
      stackBb: (myPlayer?.chips ?? 0) / bb,
      investedBb: view.myBet / bb,
    },
    table: {
      playerCount: view.players.length,
      activePlayers,
      potBb: potTotal / bb,
      effectiveStackBb: effectiveStack / bb,
      anteBb: 0,
    },
    board: {
      cards: view.communityCards,
      texture: boardTexture,
    },
    actionContext: {
      amountToCallBb: callAmount / bb,
      facingBetBb: view.currentBet / bb,
      minRaiseBb: view.minRaise / bb,
      lastAggressorSeat: lastAggressor
        ? view.players.find(p => p.id === lastAggressor.playerId)?.seatIndex
        : undefined,
      heroHasInitiative,
      playersYetToAct: view.players.filter((p, i) => !p.folded && i > (myPlayer?.seatIndex ?? 0)).length,
      actionHistory: view.actionHistory as any,
      preflopNode,
    },
    derived: {
      spr,
      potOdds: callAmount > 0 ? callAmount / (potTotal + callAmount) : undefined,
      handCategory,
      handStrength,
      drawStrength,
      multiway: activePlayers > 2,
    },
  };
}
