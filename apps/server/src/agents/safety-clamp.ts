import type {
  DecisionState,
  PolicyClamp,
  PolicyAction,
} from "@cybercasino/shared";
import { DEFAULT_POLICY_CLAMP } from "@cybercasino/shared";

// ---------------------------------------------------------------------------
// Safety clamp: intercepts clearly unreasonable actions
// ---------------------------------------------------------------------------

export interface ClampResult {
  clampedActions: Record<string, number>;
  clampsApplied: string[];
}

/**
 * Apply safety constraints to action probabilities.
 * Prevents the style modifier from producing clearly negative-EV actions.
 */
export function safetyClamp(
  actions: Record<string, number>,
  state: DecisionState,
  clamp: PolicyClamp = DEFAULT_POLICY_CLAMP,
): ClampResult {
  const result = { ...actions };
  const applied: string[] = [];

  // Rule 1: Multiway pot — suppress bluff frequency
  if (state.derived.multiway) {
    for (const action of ["bet", "raise"]) {
      if (result[action]) {
        result[action] *= clamp.multiwayBluffMultiplier;
        if (result[action] < 0.01) result[action] = 0.01;
      }
    }
    // Increase call/defend probability proportionally
    if (result["call"]) {
      result["call"] = Math.min(0.95, result["call"] * 1.2);
    }
    applied.push("multiway_bluff_suppression");
  }

  // Rule 2: River with pure air — block high-frequency large bluff
  if (state.street === "river" && state.derived.handCategory === "pure_air") {
    if (result["raise"] && result["raise"] > 0.3) {
      result["raise"] = 0.3;
      applied.push("river_air_bluff_cap");
    }
    if (result["bet"] && result["bet"] > 0.3) {
      result["bet"] = 0.3;
      applied.push("river_air_bet_cap");
    }
  }

  // Rule 3: Pot odds check — prevent calling when equity is way off
  if (state.derived.potOdds !== undefined && state.derived.handStrength !== undefined) {
    const equityRequired = state.derived.potOdds;
    const handStrength = state.derived.handStrength;
    const drawStrength = state.derived.drawStrength ?? 0;
    const totalStrength = Math.max(handStrength, drawStrength);

    // If equity is way below pot odds, cap call probability
    if (totalStrength < equityRequired * 0.5 && result["call"] && result["call"] > 0.3) {
      result["call"] = Math.min(result["call"], 0.3);
      applied.push("pot_odds_equity_guard");
    }
  }

  // Rule 4: Low SPR commitment — prevent folding strong hands with low SPR
  if (state.derived.spr <= 2 && state.derived.handStrength !== undefined) {
    if (state.derived.handStrength >= 0.5 && result["fold"] && result["fold"] > 0.2) {
      result["fold"] = Math.min(result["fold"], 0.2);
      applied.push("low_spr_commit_guard");
    }
  }

  // Rule 5: All-in protection — don't go all-in with air
  if (result["all_in"] && result["all_in"] > 0.1) {
    if (state.derived.handCategory === "pure_air" || state.derived.handCategory === "air_with_blocker") {
      result["all_in"] = 0.05;
      applied.push("all_in_air_guard");
    }
  }

  // Normalize to sum to 1
  const total = Object.values(result).reduce((s, v) => s + v, 0);
  if (total > 0) {
    for (const key of Object.keys(result)) {
      result[key] /= total;
    }
  }

  return { clampedActions: result, clampsApplied: applied };
}
