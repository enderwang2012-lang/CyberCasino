import { describe, expect, it } from "bun:test";
import type { AgentGameView, PostflopRule, StrategyConfig } from "@cybercasino/shared";
import { decidePostflop, resolveAction } from "../strategy/postflop";
import { validateAction } from "../action-audit";
import { createStrategyPackage, seedToRandom } from "../strategy-package";

function view(): AgentGameView {
  return {
    myId: "hero",
    myCards: [{ rank: 14, suit: "h" }, { rank: 13, suit: "h" }],
    myChips: 1000,
    myBet: 0,
    phase: "flop",
    communityCards: [{ rank: 13, suit: "d" }, { rank: 8, suit: "c" }, { rank: 2, suit: "s" }],
    pots: [{ amount: 1000, eligiblePlayerIds: ["hero", "villain"] }],
    players: [
      { id: "hero", name: "Hero", avatar: "", chips: 1000, bet: 0, folded: false, allIn: false, seatIndex: 0 },
      { id: "villain", name: "Villain", avatar: "", chips: 1000, bet: 0, folded: false, allIn: false, seatIndex: 1 },
    ],
    dealerSeatIndex: 0,
    smallBlind: 50,
    bigBlind: 100,
    currentBet: 0,
    minRaise: 100,
    handNumber: 1,
    actionHistory: [],
  };
}

describe("strategy DSL execution correctness", () => {
  it("applies vsBetSize rules according to the faced bet", () => {
    const rules: PostflopRule[] = [
      { when: "top-pair-top-kicker", action: "check-call", vsBetSize: "small", priority: 1 },
      { when: "top-pair-top-kicker", action: "check-fold", vsBetSize: "large", priority: 2 },
    ];
    const base = {
      myCards: view().myCards,
      communityCards: view().communityCards,
      street: "flop" as const,
      isIP: false,
      potSize: 1000,
    };
    const small = decidePostflop({ ...base, callAmount: 250 }, rules, 250, 100, ["call", "fold"]);
    const large = decidePostflop({ ...base, callAmount: 900 }, rules, 900, 100, ["call", "fold"]);
    expect(small.action).toBe("call");
    expect(large.action).toBe("fold");
  });

  it("returns raise-to totals rather than incremental raise chips", () => {
    expect(resolveAction("value-bet-medium", 1000, 200, 100)).toEqual({
      type: "raise",
      amount: 700,
    });
  });
});

describe("verified package foundations", () => {
  it("hashes a declarative package and provides reproducible randomness", () => {
    const strategy = {
      preflop: { ranges: {}, sizing: { openRaise: "2.5", threeBet: "3", fourBet: "2.5" } },
      postflop: [],
    } as unknown as StrategyConfig;
    const pkg = createStrategyPackage(strategy, { agentId: "a1", createdBy: "user_upload" });
    expect(pkg.manifest.runtime).toBe("declarative_v1");
    expect(pkg.manifest.contentHash).toHaveLength(64);
    const first = seedToRandom("decision-seed")();
    const second = seedToRandom("decision-seed")();
    expect(first).toBe(second);
  });

  it("normalizes illegal raise sizing before execution", () => {
    const tableView = view();
    tableView.currentBet = 200;
    const result = validateAction({ type: "raise", amount: 50 }, tableView, ["call", "fold", "raise"], 100);
    expect(result.action).toEqual({ type: "raise", amount: 300 });
    expect(result.corrections).toContain("raise_below_minimum");
  });
});
