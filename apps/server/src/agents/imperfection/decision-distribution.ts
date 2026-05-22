import type { ActionType, ImperfectionConfig } from "@cybercasino/shared";

/**
 * Local decision distribution for sampling imperfect actions.
 *
 * (The shared package also exports a `DecisionDistribution` type with the same
 * shape; we define a local name here to avoid import conflicts in this module.)
 */
export interface LocalDecisionDistribution {
  weights: Map<ActionType, number>;
  difficulty: number;
  isMistake: boolean;
}

/**
 * Build a weighted distribution over valid actions, biased toward the optimal
 * action but with mistake probability proportional to decision difficulty and
 * tilt level.
 *
 * - difficulty < 0.2: optimal action gets 97 % weight, remainder split evenly.
 * - Otherwise: mistake probability = baseMistakeRate * difficulty * (1 + tiltLevel * 0.5),
 *   capped at 0.4. The remaining weight goes to the optimal action. Mistake
 *   weight is distributed among non-optimal actions by tendency:
 *     fold   → scaredFold
 *     call   → stickyCall
 *     raise  → tiltAggression * (1 + tiltLevel)
 */
export function buildDecisionDistribution(
  optimalAction: ActionType,
  validActions: ActionType[],
  difficulty: number,
  imperfection: ImperfectionConfig,
  tiltLevel: number,
): LocalDecisionDistribution {
  const weights = new Map<ActionType, number>();

  // Trivially easy decisions — almost always correct
  if (difficulty < 0.2) {
    weights.set(optimalAction, 0.97);
    const others = validActions.filter((a) => a !== optimalAction);
    if (others.length > 0) {
      const perAction = 0.03 / others.length;
      for (const action of others) {
        weights.set(action, perAction);
      }
    }
    return { weights, difficulty, isMistake: false };
  }

  // Mistake probability grows with difficulty and tilt
  let mistakeProb =
    imperfection.baseMistakeRate * difficulty * (1 + tiltLevel * 0.5);
  mistakeProb = Math.min(mistakeProb, 0.4);

  weights.set(optimalAction, 1 - mistakeProb);

  // Build raw tendency scores for non-optimal actions
  const foldTendency = imperfection.tendencies.scaredFold;
  const callTendency = imperfection.tendencies.stickyCall;
  const raiseTendency =
    imperfection.tendencies.tiltAggression * (1 + tiltLevel);

  const rawTendencies = new Map<ActionType, number>();
  let totalTendency = 0;

  for (const action of validActions) {
    if (action === optimalAction) continue;
    let tendency: number;
    switch (action) {
      case "fold":
        tendency = foldTendency;
        break;
      case "call":
      case "check":
        tendency = callTendency;
        break;
      default:
        // "raise"
        tendency = raiseTendency;
    }
    rawTendencies.set(action, tendency);
    totalTendency += tendency;
  }

  // Normalise tendency scores and assign weighted probability
  for (const [action, raw] of rawTendencies) {
    const weight =
      totalTendency > 0
        ? (raw / totalTendency) * mistakeProb
        : mistakeProb / rawTendencies.size;
    weights.set(action, weight);
  }

  return { weights, difficulty, isMistake: false };
}

/**
 * Sample an action from a weighted distribution.
 *
 * Returns both the selected action and whether it counts as a "mistake"
 * (defined as: the selected action's weight is less than 50 % of the highest
 * weight in the distribution).
 */
export function sampleFromDistribution(
  weights: Map<ActionType, number>,
): { action: ActionType; isMistake: boolean } {
  const entries = [...weights.entries()];
  if (entries.length === 0) {
    throw new Error("Cannot sample from an empty distribution");
  }

  let maxWeight = 0;
  let totalWeight = 0;
  for (const [, w] of entries) {
    totalWeight += w;
    if (w > maxWeight) maxWeight = w;
  }

  if (totalWeight <= 0) {
    throw new Error("Distribution has zero total weight");
  }

  let rand = Math.random() * totalWeight;

  for (const [action, weight] of entries) {
    rand -= weight;
    if (rand <= 0) {
      const isMistake = weight < maxWeight * 0.5;
      return { action, isMistake };
    }
  }

  // Floating-point safety net
  return {
    action: entries[entries.length - 1][0],
    isMistake: false,
  };
}

/**
 * Evenly distribute `total` weight across valid actions, excluding the given
 * action.
 *
 * Useful when a fixed amount of weight needs to be spread across secondary
 * choices.
 */
export function distributeRemainder(
  weights: Map<ActionType, number>,
  validActions: ActionType[],
  exclude: ActionType,
  total: number,
): void {
  const candidates = validActions.filter((a) => a !== exclude);
  if (candidates.length === 0) return;

  const perAction = total / candidates.length;
  for (const action of candidates) {
    weights.set(action, (weights.get(action) || 0) + perAction);
  }
}