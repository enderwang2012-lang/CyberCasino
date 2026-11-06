import { describe, expect, it } from "bun:test";
import { applyBuiltinStyle } from "./builtin-style";
import { buildDecisionDistribution, sampleFromDistribution } from "./imperfection/decision-distribution";

const always = () => 0;
const never = () => 0.99;

describe("builtin style", () => {
  it("folds a calling hand when the style is tight", () => {
    expect(applyBuiltinStyle({
      action: "call",
      phase: "preflop",
      looseness: 0,
      validActions: ["fold", "call", "raise"],
      callAmount: 100,
      bigBlind: 100,
      margin: "call",
      random: always,
    })).toBe("fold");
  });

  it("calls a folded hand that is playable from another seat when the style is loose", () => {
    expect(applyBuiltinStyle({
      action: "fold",
      phase: "preflop",
      looseness: 1,
      validActions: ["fold", "call", "raise"],
      callAmount: 100,
      bigBlind: 100,
      margin: "fold-edge",
      random: always,
    })).toBe("call");
  });

  it("leaves a trash fold and a raise range unchanged", () => {
    expect(applyBuiltinStyle({
      action: "fold",
      phase: "preflop",
      looseness: 1,
      validActions: ["fold", "call"],
      callAmount: 100,
      bigBlind: 100,
      margin: "fold",
      random: always,
    })).toBe("fold");
    expect(applyBuiltinStyle({
      action: "raise",
      phase: "preflop",
      looseness: 0,
      validActions: ["fold", "call", "raise"],
      callAmount: 0,
      bigBlind: 100,
      margin: "raise",
      random: always,
    })).toBe("raise");
  });

  it("does not loosen into a call that costs more than 3 big blinds", () => {
    expect(applyBuiltinStyle({
      action: "fold",
      phase: "preflop",
      looseness: 1,
      validActions: ["fold", "call"],
      callAmount: 400,
      bigBlind: 100,
      margin: "fold-edge",
      random: always,
    })).toBe("fold");
  });

  it("bets or checks with aggression only when both are legal", () => {
    expect(applyBuiltinStyle({
      action: "check",
      phase: "flop",
      aggression: 1,
      validActions: ["check", "raise"],
      callAmount: 0,
      bigBlind: 100,
      random: always,
    })).toBe("raise");
    expect(applyBuiltinStyle({
      action: "raise",
      phase: "flop",
      aggression: 0,
      validActions: ["check", "raise"],
      callAmount: 0,
      bigBlind: 100,
      random: always,
    })).toBe("check");
    expect(applyBuiltinStyle({
      action: "check",
      phase: "flop",
      aggression: 1,
      validActions: ["check", "raise"],
      callAmount: 0,
      bigBlind: 100,
      random: never,
    })).toBe("check");
  });

  it("uses bluff appetite instead of aggression on a bluff line", () => {
    expect(applyBuiltinStyle({
      action: "raise",
      phase: "flop",
      aggression: 1,
      bluffAppetite: 0,
      validActions: ["check", "raise"],
      callAmount: 0,
      bigBlind: 100,
      bluffLine: true,
      random: always,
    })).toBe("check");
  });
});

describe("easy decisions", () => {
  it("keeps the strategy action when the spot is easy and the bot is not tilting", () => {
    const weights = buildDecisionDistribution("fold", ["fold", "call", "raise"], 0.1, {
      baseMistakeRate: 0.005,
      tendencies: { scaredFold: 0.02, stickyCall: 0.02, slowplayBias: 0.02, tiltAggression: 0.02 },
      tilt: { triggerThreshold: 0.8, decayRate: 0.2, maxLevel: 0.3 },
      confidenceNoise: 0.02,
    }, 0);
    expect(sampleFromDistribution(weights.weights, always).action).toBe("fold");
    expect(weights.weights.get("call") ?? 0).toBe(0);
  });
});
