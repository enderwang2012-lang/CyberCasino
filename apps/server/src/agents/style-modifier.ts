import type {
  StyleProfile,
  DecisionState,
  PolicyOutput,
  PolicyAction,
  HandCategory,
} from "@cybercasino/shared";

// ---------------------------------------------------------------------------
// Logit helpers
// ---------------------------------------------------------------------------

function logit(p: number): number {
  const clamped = Math.max(0.001, Math.min(0.999, p));
  return Math.log(clamped / (1 - clamped));
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function softmax(logits: Record<string, number>): Record<string, number> {
  const maxLogit = Math.max(...Object.values(logits));
  const exps: Record<string, number> = {};
  let sum = 0;
  for (const [key, val] of Object.entries(logits)) {
    exps[key] = Math.exp(val - maxLogit);
    sum += exps[key];
  }
  const result: Record<string, number> = {};
  for (const [key, val] of Object.entries(exps)) {
    result[key] = val / sum;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Style adjustment function (logit shift model)
// ---------------------------------------------------------------------------

/**
 * Compute style-based logit adjustment for each action.
 * style can only *shift* probabilities of already-eligible actions,
 * not create entirely new action paths.
 */
export function styleAdjustment(
  action: PolicyAction,
  state: DecisionState,
  style: StyleProfile,
): number {
  let delta = 0;

  // Preflop adjustments
  if (state.street === "preflop") {
    // Raise: aggression + looseness push toward raising
    if (action === "raise") {
      delta += style.aggression * 0.4;
      delta += style.preflopLooseness * 0.3;
      delta += style.varianceTolerance * 0.1;
    }
    // Fold: tightness pushes toward folding
    if (action === "fold") {
      delta += (1 - style.preflopLooseness) * 0.3;
      delta += (1 - style.varianceTolerance) * 0.1;
    }
    // Call: defense stickiness
    if (action === "call") {
      delta += style.defenseStickiness * 0.2;
    }
  }

  // Postflop adjustments
  if (state.street !== "preflop") {
    const heroHasInitiative = state.actionContext.heroHasInitiative;
    const facingBet = state.actionContext.facingBetBb > 0;
    const handCategory = state.derived.handCategory;

    // Bet/raise: aggression + cbet pressure
    if (action === "bet" || action === "raise") {
      delta += style.aggression * 0.3;

      // C-bet pressure: more likely to bet when hero has initiative
      if (heroHasInitiative && action === "bet") {
        delta += style.cbetPressure * 0.3;
      }

      // Bluff appetite: more likely to bet/raise with weak hands
      if (handCategory && isBluffCandidate(handCategory)) {
        delta += style.bluffAppetite * 0.4;
      }

      // Sizing pressure: bigger bets
      delta += style.sizingPressure * 0.15;
    }

    // Check: trap tendency
    if (action === "check") {
      if (handCategory && isStrongValue(handCategory)) {
        delta += style.trapTendency * 0.3;
      }
      // Passive players check more
      delta += (1 - style.aggression) * 0.1;
    }

    // Call: defense stickiness
    if (action === "call") {
      delta += style.defenseStickiness * 0.3;
    }

    // Fold: inverse of defense
    if (action === "fold") {
      delta += (1 - style.defenseStickiness) * 0.2;
    }

    // Value thinness: thin value bets
    if ((action === "bet" || action === "raise") && handCategory === "thin_value") {
      delta += style.valueThinness * 0.3;
    }
  }

  return delta;
}

function isStrongValue(cat: HandCategory): boolean {
  return cat === "nuts" || cat === "very_strong_value" || cat === "medium_value";
}

function isBluffCandidate(cat: HandCategory): boolean {
  return cat === "pure_air" || cat === "air_with_blocker" || cat === "weak_draw";
}

// ---------------------------------------------------------------------------
// Full style modifier: applies style shift to baseline policy
// ---------------------------------------------------------------------------

export interface ModifierResult {
  adjustedActions: Record<string, number>;
  shifts: Array<{ parameter: keyof StyleProfile; action: string; delta: number }>;
}

/**
 * Apply style profile adjustments to baseline policy output.
 * Uses logit shift model: baseline logit + style adjustment → softmax.
 */
export function applyStyleModifier(
  baseline: PolicyOutput,
  state: DecisionState,
  style: StyleProfile,
): ModifierResult {
  // Convert baseline probabilities to logits
  const baseLogits: Record<string, number> = {};
  for (const [action, prob] of Object.entries(baseline.actions)) {
    if (typeof prob === "number") {
      baseLogits[action] = logit(prob);
    }
  }

  // Apply style adjustments
  const shifts: ModifierResult["shifts"] = [];
  const adjustedLogits: Record<string, number> = { ...baseLogits };

  for (const action of Object.keys(baseLogits)) {
    const delta = styleAdjustment(action as PolicyAction, state, style);
    if (delta !== 0) {
      // Determine which style parameter contributed most
      const paramName = getDominantParam(action as PolicyAction, state, style);
      if (paramName) {
        shifts.push({ parameter: paramName, action, delta });
      }
      adjustedLogits[action] += delta;
    }
  }

  // Ensure all probabilities are non-negative via clamping
  const adjustedActions = softmax(adjustedLogits);

  return { adjustedActions, shifts };
}

/**
 * Determine which style parameter has the largest influence on an action.
 */
function getDominantParam(
  action: PolicyAction,
  state: DecisionState,
  style: StyleProfile,
): keyof StyleProfile | null {
  const contributions: [keyof StyleProfile, number][] = [];

  if (action === "raise" || action === "bet") {
    contributions.push(["aggression", style.aggression * 0.3]);
    if (state.actionContext.heroHasInitiative) {
      contributions.push(["cbetPressure", style.cbetPressure * 0.3]);
    }
    contributions.push(["sizingPressure", style.sizingPressure * 0.15]);
  }
  if (action === "call") {
    contributions.push(["defenseStickiness", style.defenseStickiness * 0.3]);
  }
  if (action === "fold") {
    contributions.push(["defenseStickiness", (1 - style.defenseStickiness) * 0.2]);
  }
  if (action === "check") {
    contributions.push(["trapTendency", style.trapTendency * 0.3]);
  }
  if (action === "fold" && state.street === "preflop") {
    contributions.push(["preflopLooseness", (1 - style.preflopLooseness) * 0.3]);
  }

  if (contributions.length === 0) return null;
  contributions.sort((a, b) => b[1] - a[1]);
  return contributions[0][0];
}
