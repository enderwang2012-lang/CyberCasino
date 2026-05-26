/**
 * Smoke tests for the V2 strategy engine modules.
 *
 * Run: bun apps/server/src/agents/__test__/v2-engine.test.ts
 */

import { describe, it, expect } from "bun:test";
import { expandHighLevel, resolveStyle } from "../style-resolver";
import { parseTextToHighLevel, parseStyleInput } from "../style-parser";
import { STYLE_DEFAULTS } from "@cybercasino/shared";
import type { StyleProfile, DecisionState, Card, PolicyOutput, AgentGameView } from "@cybercasino/shared";
import { evaluatePreflopPercentile, analyzeBoardTexture, evaluateDraws } from "../hand-classifier";
import { baselinePolicy } from "../baseline-policy";
import { styleAdjustment, applyStyleModifier } from "../style-modifier";
import { safetyClamp } from "../safety-clamp";
import { runDecisionPipeline } from "../decision-pipeline";

// ---------------------------------------------------------------------------
// Helper: build a minimal DecisionState
// ---------------------------------------------------------------------------
function makeState(overrides: Partial<DecisionState> = {}): DecisionState {
  return {
    handId: "test-hand",
    street: "preflop",
    hero: {
      seat: 0,
      position: "BTN",
      holeCards: [{ rank: 14, suit: "h" }, { rank: 13, suit: "s" }],
      stackBb: 100,
      investedBb: 0,
    },
    table: {
      playerCount: 6,
      activePlayers: 2,
      potBb: 1.5,
      effectiveStackBb: 100,
      anteBb: 0,
    },
    board: { cards: [] },
    actionContext: {
      amountToCallBb: 0,
      facingBetBb: 0,
      minRaiseBb: 2,
      heroHasInitiative: false,
      playersYetToAct: 1,
      actionHistory: [],
      preflopNode: "unopened",
    },
    derived: {
      spr: 66,
      multiway: false,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// style-resolver
// ---------------------------------------------------------------------------
describe("style-resolver", () => {
  it("expandHighLevel with defaults produces balanced profile", () => {
    const p = expandHighLevel();
    expect(p.aggression).toBeCloseTo(0.5, 1);
    expect(p.preflopLooseness).toBeCloseTo(0.5, 1);
    expect(p.bluffAppetite).toBeGreaterThan(0);
    expect(p.trapTendency).toBeGreaterThan(0);
  });

  it("expandHighLevel with aggressive params", () => {
    const p = expandHighLevel({ tightness: 0.2, aggression: 0.9, bluffFrequency: 0.5 });
    expect(p.aggression).toBeCloseTo(0.9, 1);
    expect(p.preflopLooseness).toBeCloseTo(0.8, 1);
    expect(p.bluffAppetite).toBeGreaterThan(0.3);
  });

  it("resolveStyle with override applies on top", () => {
    const p = resolveStyle({
      highLevel: { tightness: 0.5, aggression: 0.5 },
      override: { trapTendency: 0.95 },
    });
    expect(p.trapTendency).toBe(0.95);
    expect(p.aggression).toBeCloseTo(0.5, 1);
  });

  it("resolveStyle with no args returns defaults", () => {
    const p = resolveStyle();
    expect(p).toEqual(STYLE_DEFAULTS);
  });

  it("resolveStyle clamps override values to [0,1]", () => {
    const p = resolveStyle({ override: { aggression: 1.5 } as any });
    expect(p.aggression).toBe(1);
    const p2 = resolveStyle({ override: { aggression: -0.5 } as any });
    expect(p2.aggression).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// style-parser
// ---------------------------------------------------------------------------
describe("style-parser", () => {
  it("parseTextToHighLevel extracts aggression from 激进", () => {
    const hl = parseTextToHighLevel("我是激进型选手");
    expect(hl.aggression).toBe(0.8);
  });

  it("parseTextToHighLevel extracts tightness from 保守", () => {
    const hl = parseTextToHighLevel("保守稳健的打法");
    expect(hl.tightness).toBe(0.8);
  });

  it("parseStyleInput with text returns a valid StyleProfile", () => {
    const p = parseStyleInput({ text: "激进型，喜欢bluff" });
    expect(p.aggression).toBeGreaterThan(0.5);
    expect(p.bluffAppetite).toBeGreaterThan(0.2);
  });

  it("parseStyleInput with profile returns as-is", () => {
    const input: Partial<StyleProfile> = { aggression: 0.9, trapTendency: 0.1 };
    const p = parseStyleInput({ profile: input });
    expect(p.aggression).toBe(0.9);
    expect(p.trapTendency).toBe(0.1);
  });

  it("parseStyleInput with highLevel + override merges correctly", () => {
    const p = parseStyleInput({
      highLevel: { tightness: 0.3, aggression: 0.8 },
      override: { trapTendency: 0.95 },
    });
    expect(p.trapTendency).toBe(0.95);
    expect(p.preflopLooseness).toBeCloseTo(0.7, 1);
  });
});

// ---------------------------------------------------------------------------
// hand-classifier
// ---------------------------------------------------------------------------
describe("hand-classifier", () => {
  it("evaluatePreflopPercentile: AA is strong", () => {
    const cards: Card[] = [{ rank: 14, suit: "h" }, { rank: 14, suit: "s" }];
    const pct = evaluatePreflopPercentile(cards);
    expect(pct).toBeLessThan(0.05);
  });

  it("evaluatePreflopPercentile: 72o is weak", () => {
    const cards: Card[] = [{ rank: 7, suit: "h" }, { rank: 2, suit: "s" }];
    const pct = evaluatePreflopPercentile(cards);
    expect(pct).toBeGreaterThan(0.75);
  });

  it("analyzeBoardTexture: dry board", () => {
    const board: Card[] = [
      { rank: 2, suit: "h" }, { rank: 7, suit: "s" }, { rank: 11, suit: "d" },
    ];
    const tex = analyzeBoardTexture(board);
    expect(tex.dryness).toBe("dry");
    expect(tex.monotone).toBe(false);
  });

  it("analyzeBoardTexture: monotone board", () => {
    const board: Card[] = [
      { rank: 2, suit: "h" }, { rank: 7, suit: "h" }, { rank: 11, suit: "h" },
    ];
    const tex = analyzeBoardTexture(board);
    expect(tex.monotone).toBe(true);
  });

  it("evaluateDraws: flush draw", () => {
    const myCards: Card[] = [{ rank: 10, suit: "h" }, { rank: 9, suit: "h" }];
    const board: Card[] = [
      { rank: 2, suit: "h" }, { rank: 7, suit: "h" }, { rank: 11, suit: "d" },
    ];
    const draws = evaluateDraws(myCards, board);
    expect(draws).not.toBeNull();
    expect(draws!.type).toBe("flush-draw");
  });
});

// ---------------------------------------------------------------------------
// baseline-policy
// ---------------------------------------------------------------------------
describe("baseline-policy", () => {
  it("preflop: AA always raises", () => {
    const state = makeState({
      hero: {
        seat: 0, position: "BTN",
        holeCards: [{ rank: 14, suit: "h" }, { rank: 14, suit: "s" }],
        stackBb: 100, investedBb: 0,
      },
    });
    const policy = baselinePolicy(state);
    expect(policy.actions.raise).toBeGreaterThan(0.7);
  });

  it("preflop: 72o folds at UTG", () => {
    const state = makeState({
      hero: {
        seat: 0, position: "UTG",
        holeCards: [{ rank: 7, suit: "h" }, { rank: 2, suit: "s" }],
        stackBb: 100, investedBb: 0,
      },
    });
    const policy = baselinePolicy(state);
    expect(policy.actions.fold).toBeGreaterThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// style-modifier
// ---------------------------------------------------------------------------
describe("style-modifier", () => {
  it("aggressive style increases raise probability", () => {
    const aggressive: StyleProfile = {
      ...STYLE_DEFAULTS,
      aggression: 0.9,
      preflopLooseness: 0.7,
    };
    const state = makeState();
    const baseline: PolicyOutput = {
      actions: { fold: 0.3, call: 0.4, raise: 0.3 },
      reasoningTags: ["preflop"],
    };
    const { adjustedActions } = applyStyleModifier(baseline, state, aggressive);
    expect(adjustedActions.raise).toBeGreaterThan(baseline.actions.raise!);
  });

  it("styleAdjustment: trap increases check with strong hands", () => {
    const trapper: StyleProfile = {
      ...STYLE_DEFAULTS,
      trapTendency: 0.9,
    };
    const state = makeState({ street: "flop" });
    const delta = styleAdjustment("check", state, trapper);
    expect(delta).toBeGreaterThan(0);
  });

  it("styleAdjustment: aggression increases raise", () => {
    const agg: StyleProfile = { ...STYLE_DEFAULTS, aggression: 0.9 };
    const state = makeState();
    const delta = styleAdjustment("raise", state, agg);
    expect(delta).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// safety-clamp
// ---------------------------------------------------------------------------
describe("safety-clamp", () => {
  it("multiway pot suppresses bluff", () => {
    const actions: Record<string, number> = { fold: 0.1, call: 0.2, raise: 0.7 };
    const state = makeState({
      derived: { spr: 2, multiway: true, handCategory: "pure_air" },
    });
    const { clampedActions, clampsApplied } = safetyClamp(actions, state);
    expect(clampedActions.raise).toBeLessThan(0.7);
    expect(clampsApplied.length).toBeGreaterThan(0);
  });

  it("no clamp needed for reasonable action", () => {
    const actions: Record<string, number> = { fold: 0.3, call: 0.5, raise: 0.2 };
    const state = makeState({
      derived: { spr: 10, multiway: false },
    });
    const { clampsApplied } = safetyClamp(actions, state);
    expect(clampsApplied.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// decision-pipeline (end-to-end)
// ---------------------------------------------------------------------------
describe("decision-pipeline", () => {
  it("AA preflop → raise", () => {
    const view = makePipelineView({
      myCards: [{ rank: 14, suit: "h" }, { rank: 14, suit: "s" }],
      phase: "preflop",
    });
    const style = resolveStyle({ highLevel: { tightness: 0.5, aggression: 0.7 } });
    const result = runDecisionPipeline(
      view, ["raise", "fold"], 0, 100, style, "BTN", "test-1", "zh",
    );
    expect(result.decision.action.type).toBe("raise");
    expect(result.decision.thought.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it("72o preflop at UTG → fold", () => {
    const view = makePipelineView({
      myCards: [{ rank: 2, suit: "h" }, { rank: 7, suit: "s" }],
      phase: "preflop",
    });
    const style = resolveStyle({ highLevel: { tightness: 0.7, aggression: 0.3 } });
    const result = runDecisionPipeline(
      view, ["fold", "call"], 200, 400, style, "UTG", "test-2", "zh",
    );
    expect(result.decision.action.type).toBe("fold");
  });

  it("monster postflop favors value aggression while preserving mixed play", () => {
    const view = makePipelineView({
      myCards: [{ rank: 14, suit: "h" }, { rank: 14, suit: "s" }],
      communityCards: [
        { rank: 14, suit: "d" }, { rank: 7, suit: "c" }, { rank: 3, suit: "s" },
      ],
      phase: "flop",
    });
    const style = resolveStyle({ highLevel: { aggression: 0.6 } });
    const result = runDecisionPipeline(
      view as any, ["raise", "check"], 0, 100, style, "BTN", "test-3", "zh",
    );
    expect(result.result.probabilities.raise).toBeGreaterThan(result.result.probabilities.check);
    expect(["raise", "check"]).toContain(result.decision.action.type);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makePipelineView(overrides: Partial<AgentGameView> = {}): AgentGameView {
  return {
    handNumber: 1,
    phase: "preflop",
    myId: "hero",
    myCards: [{ rank: 14, suit: "h" }, { rank: 13, suit: "s" }] as Card[],
    communityCards: [] as Card[],
    myChips: 10000,
    myBet: 0,
    currentBet: 0,
    minRaise: 200,
    bigBlind: 100,
    smallBlind: 50,
    pots: [{ amount: 150, eligiblePlayerIds: ["hero", "villain"] }],
    players: [
      { id: "hero", name: "Hero", avatar: "", chips: 10000, bet: 0, folded: false, allIn: false, seatIndex: 0 },
      { id: "villain", name: "Villain", avatar: "", chips: 10000, bet: 100, folded: false, allIn: false, seatIndex: 1 },
    ],
    dealerSeatIndex: 0,
    actionHistory: [],
    ...overrides,
  };
}
