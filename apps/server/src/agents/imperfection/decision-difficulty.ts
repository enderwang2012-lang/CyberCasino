import type { AgentGameView, HandRank } from "@cybercasino/shared";
import { evaluateHand } from "@cybercasino/engine";

/**
 * Context for calculating decision difficulty.
 */
export interface DifficultyContext {
  /** Hand strength 0-1 (0 = weakest, 1 = strongest). */
  handStrength: number;
  /** pot-to-stack ratio representing pot pressure. */
  potPressure: number;
  /** Uncertainty about opponents' holdings (0-1). */
  opponentUncertainty: number;
  /** Number of viable / valid actions available. */
  viableOptions: number;
  /** Whether the player is facing an all-in decision. */
  isAllIn: boolean;
  /** Amount needed to call. */
  callAmount: number;
  /** Player's current stack size. */
  stackSize: number;
}

/** Map from poker hand rank to estimated strength (0-1). */
const HAND_STRENGTH_MAP: Record<HandRank, number> = {
  "high-card": 0.15,
  pair: 0.35,
  "two-pair": 0.6,
  "three-of-a-kind": 0.82,
  straight: 0.85,
  flush: 0.88,
  "full-house": 0.93,
  "four-of-a-kind": 0.97,
  "straight-flush": 0.99,
  "royal-flush": 1.0,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Calculate decision difficulty from a difficulty context.
 *
 * Factors and their weights:
 *   - edgeFactor  = 1 - |handStrength - 0.5| * 2     (weight 0.20)
 *   - potPressure                                      (weight 0.25)
 *   - opponentUncertainty                              (weight 0.15)
 *   - viableOptions: (options - 1) / 4                 (weight 0.15)
 *   - isAllIn: fixed +0.20 if true
 *   - callAmount / stackSize                           (weight 0.15)
 *
 * Returns a value clamped to [0, 1], where 1 = most difficult.
 */
export function calculateDifficulty(ctx: DifficultyContext): number {
  // Edge factor: marginal hands (near 0.5) are hardest to play
  const edgeFactor = 1 - Math.abs(ctx.handStrength - 0.5) * 2;

  // Viable options factor: more choices = harder decision
  const viableOptionsFactor = clamp((ctx.viableOptions - 1) / 4, 0, 1);

  // Call amount relative to stack
  const callRatio =
    ctx.stackSize > 0 ? clamp(ctx.callAmount / ctx.stackSize, 0, 1) : 0;

  let difficulty = 0;
  difficulty += edgeFactor * 0.2;
  difficulty += clamp(ctx.potPressure, 0, 1) * 0.25;
  difficulty += clamp(ctx.opponentUncertainty, 0, 1) * 0.15;
  difficulty += viableOptionsFactor * 0.15;
  if (ctx.isAllIn) {
    difficulty += 0.2;
  }
  difficulty += callRatio * 0.15;

  return clamp(difficulty, 0, 1);
}

/**
 * Estimate the strength of the player's current hand based on the game view.
 *
 * - Preflop: approximated from hole cards (pocket pair, high cards, suited).
 * - Postflop: uses the engine's hand evaluator and the rank-to-strength map.
 *
 * Returns a value between 0 and 1.
 */
export function estimateHandStrength(view: AgentGameView): number {
  const allCards = [...view.myCards, ...view.communityCards];

  // evaluateHand requires at least 5 cards
  if (allCards.length < 5) {
    return estimatePreflopStrength(view.myCards);
  }

  try {
    const evaluated = evaluateHand(allCards);
    return HAND_STRENGTH_MAP[evaluated.rank] ?? 0.5;
  } catch {
    return 0.5;
  }
}

/**
 * Preflop hand strength estimate based on hole cards alone.
 *
 * Pocket pairs are scored by rank; non-pair hands factor in high cards and
 * suitedness.
 */
function estimatePreflopStrength(
  cards: AgentGameView["myCards"],
): number {
  if (cards.length !== 2) return 0.5;

  const [c1, c2] = cards;

  // Pocket pair
  if (c1.rank === c2.rank) {
    // Range: deuces ≈ 0.35, aces ≈ 0.81
    return clamp(0.35 + (c1.rank - 2) / 26, 0, 1);
  }

  // Non-pair: blend high-card value and suited bonus
  const high = Math.max(c1.rank, c2.rank);
  const low = Math.min(c1.rank, c2.rank);
  const suited = c1.suit === c2.suit;

  let strength = 0.08 + (high - 2) / 60 + (low - 2) / 120;
  if (suited) strength += 0.04;

  return clamp(strength, 0, 1);
}