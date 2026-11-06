import type { ActionType } from "@cybercasino/shared";

export type PreflopMargin = "raise" | "call" | "fold-edge" | "fold";

const SHIFT_CAP = 0.4;

function shifts(distance: number, random: () => number): boolean {
  const probability = Math.min(SHIFT_CAP, Math.max(0, distance) * 0.8);
  return probability > 0 && random() < probability;
}

/**
 * Nudge a strategy-package action using style. Raise ranges stay put.
 * Looseness only moves a fold that is playable from another seat, or a call.
 * Aggression and bluff appetite only swap check and bet when both are legal.
 */
export function applyBuiltinStyle(input: {
  action: ActionType;
  phase: string;
  looseness?: number;
  aggression?: number;
  bluffAppetite?: number;
  validActions: ActionType[];
  callAmount: number;
  bigBlind: number;
  margin?: PreflopMargin;
  bluffLine?: boolean;
  random?: () => number;
}): ActionType {
  const random = input.random ?? Math.random;
  const looseness = input.looseness ?? 0.5;
  const aggression = input.aggression ?? 0.5;
  const bluffAppetite = input.bluffAppetite ?? 0.3;
  const { action, validActions } = input;

  if (input.phase === "preflop") {
    if (
      action === "call"
      && input.margin === "call"
      && looseness < 0.5
      && validActions.includes("fold")
      && shifts(0.5 - looseness, random)
    ) return "fold";
    if (
      action === "fold"
      && input.margin === "fold-edge"
      && looseness > 0.5
      && validActions.includes("call")
      && input.callAmount <= input.bigBlind * 3
      && shifts(looseness - 0.5, random)
    ) return "call";
    return action;
  }

  const canCheck = validActions.includes("check");
  const canBet = validActions.includes("raise") && input.callAmount === 0;
  if (input.bluffLine) {
    if (action === "raise" && bluffAppetite < 0.3 && canCheck && shifts(0.3 - bluffAppetite, random)) return "check";
    if (action === "check" && bluffAppetite > 0.3 && canBet && shifts(bluffAppetite - 0.3, random)) return "raise";
    return action;
  }
  if (action === "check" && aggression > 0.5 && canBet && shifts(aggression - 0.5, random)) return "raise";
  if (action === "raise" && aggression < 0.5 && canCheck && shifts(0.5 - aggression, random)) return "check";
  return action;
}
