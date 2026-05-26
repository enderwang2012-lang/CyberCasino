import type {
  ActionType,
  DecisionState,
  PolicyAction,
} from "@cybercasino/shared";

// ---------------------------------------------------------------------------
// Action selector: sample from probability distribution
// ---------------------------------------------------------------------------

export interface SelectedAction {
  type: ActionType | "all_in";
  amountBb?: number;
}

/**
 * Select an action from a probability distribution.
 * Uses weighted random sampling.
 */
export function selectAction(
  probabilities: Record<string, number>,
  state: DecisionState,
  validActions: string[],
): SelectedAction {
  // Filter to only valid actions
  const valid: Record<string, number> = {};
  let total = 0;
  for (const [policyAction, prob] of Object.entries(probabilities)) {
    const action = policyAction === "bet" || policyAction === "all_in" ? "raise" : policyAction;
    if (validActions.includes(action)) {
      const selectedAction = policyAction === "all_in" ? "all_in" : action;
      valid[selectedAction] = (valid[selectedAction] ?? 0) + prob;
      total += prob;
    }
  }

  // If no valid actions match, fall back to first valid action
  if (total === 0 || Object.keys(valid).length === 0) {
    const fallback = validActions.includes("check") ? "check" : validActions.includes("fold") ? "fold" : validActions[0];
    return { type: fallback as ActionType };
  }

  // Normalize
  for (const key of Object.keys(valid)) {
    valid[key] /= total;
  }

  // Weighted random sample
  const rand = Math.random();
  let cumulative = 0;
  for (const [action, prob] of Object.entries(valid)) {
    cumulative += prob;
    if (rand <= cumulative) {
      return {
        type: action as ActionType | "all_in",
        amountBb: computeSizing(action, state),
      };
    }
  }

  // Fallback (shouldn't reach here)
  const lastAction = Object.keys(valid)[0];
  return {
    type: lastAction as ActionType | "all_in",
    amountBb: computeSizing(lastAction, state),
  };
}

/**
 * Compute bet/raise sizing based on action type and game state.
 */
function computeSizing(action: string, state: DecisionState): number | undefined {
  if (action === "check" || action === "fold" || action === "call") {
    return undefined;
  }

  const bb = state.table.potBb > 0 ? 1 : 1; // always in BB units

  if (action === "all_in") {
    return state.hero.investedBb + state.hero.stackBb;
  }

  if (action === "raise") {
    // Preflop: standard 3x open
    if (state.street === "preflop") {
      return Math.max(
        state.actionContext.facingBetBb + state.actionContext.minRaiseBb,
        state.actionContext.facingBetBb > 1 ? state.actionContext.facingBetBb * 3 : 3.0,
      );
    }
    // Postflop: pot-size raise
    return Math.max(
      state.actionContext.facingBetBb + state.actionContext.minRaiseBb,
      state.actionContext.facingBetBb + state.table.potBb * 0.75,
    );
  }

  if (action === "bet") {
    // Postflop bet sizing
    const pot = state.table.potBb;
    const handStrength = state.derived.handStrength ?? 0.5;
    const texture = state.board.texture;

    // Base sizing from hand strength
    let potRatio: number;
    if (handStrength >= 0.8) {
      // Strong hand: larger bet
      potRatio = texture?.dryness === "dry" ? 0.75 : 0.66;
    } else if (handStrength >= 0.4) {
      // Medium hand: standard bet
      potRatio = 0.50;
    } else {
      // Weak/bluff: smaller bet
      potRatio = 0.33;
    }

    return Math.max(1, pot * potRatio); // minimum 1 BB
  }

  return undefined;
}
