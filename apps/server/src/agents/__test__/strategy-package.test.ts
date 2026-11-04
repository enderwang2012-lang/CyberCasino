import { describe, expect, it } from "bun:test";
import type { AgentGameView, Card, PostflopRule, PreflopConfig, StrategyConfig } from "@cybercasino/shared";
import { decidePreflop } from "../strategy/preflop";
import { classifyHand, decidePostflop, resolveAction } from "../strategy/postflop";
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

  it("sizes a raise from the pot after the call is added", () => {
    expect(resolveAction("value-bet-medium", 1000, 200, 100, 0)).toEqual({
      type: "raise",
      amount: 700,
    });
    expect(resolveAction("value-bet-medium", 1000, 200, 100, 200)).toEqual({
      type: "raise",
      amount: 800,
    });
    expect(resolveAction("value-bet-small", 600, 200, 200, 200).amount).toBeGreaterThan(400);
  });

  it("reads two pair ahead of an overpair and does not claim a board straight", () => {
    const flop = classifyHand({
      myCards: [{ rank: 14, suit: "h" }, { rank: 14, suit: "d" }],
      communityCards: [{ rank: 13, suit: "s" }, { rank: 13, suit: "c" }, { rank: 7, suit: "d" }],
      street: "flop",
      isIP: true,
      potSize: 300,
      callAmount: 0,
    });
    expect(flop).toContain("two-pair");
    expect(flop).not.toContain("overpair");

    const boardStraight = classifyHand({
      myCards: [{ rank: 2, suit: "c" }, { rank: 3, suit: "d" }],
      communityCards: [
        { rank: 9, suit: "h" }, { rank: 10, suit: "d" }, { rank: 11, suit: "c" },
        { rank: 12, suit: "s" }, { rank: 13, suit: "h" },
      ],
      street: "river",
      isIP: true,
      potSize: 1000,
      callAmount: 0,
    });
    expect(boardStraight).toEqual(["board"]);
  });

  it("raises a configured 3-bet multiple of the previous bet", () => {
    const cards: Card[] = [{ rank: 14, suit: "h" }, { rank: 14, suit: "d" }];
    const config = {
      ranges: { BTN: { raise: ["AA"], call: [], fold: [] } },
      sizing: { openRaise: "2.5", threeBet: "3", fourBet: "2.5" },
    } as PreflopConfig;
    const random = Math.random;
    Math.random = () => 0;
    try {
      const open = decidePreflop(cards, "BTN", config, 0, 100, 100, 100);
      const threeBet = decidePreflop(cards, "BTN", config, 150, 150, 100, 250);
      expect(open?.amount).toBe(220);
      expect(threeBet?.amount).toBe(525);
    } finally {
      Math.random = random;
    }
  });

  it("moves the sizing baseline with pressure without collapsing to a min-raise", () => {
    const cards: Card[] = [{ rank: 14, suit: "h" }, { rank: 14, suit: "d" }];
    const config = {
      ranges: { BTN: { raise: ["AA"], call: [], fold: [] } },
      sizing: { openRaise: "2.5", threeBet: "3", fourBet: "2.5" },
    } as PreflopConfig;
    const random = Math.random;
    Math.random = () => 1;
    try {
      const aggressive = decidePreflop(cards, "BTN", config, 0, 100, 100, 100, undefined, 1);
      const passive = decidePreflop(cards, "BTN", config, 0, 100, 100, 100, undefined, 0);
      expect(aggressive?.amount).toBe(390);
      expect(passive?.amount).toBe(260);
      expect(passive!.amount!).toBeGreaterThan(200);
    } finally {
      Math.random = random;
    }
  });

  it("does not treat a board-only straight or flush draw as the player's draw", () => {
    const boardStraight = classifyHand({
      myCards: [{ rank: 7, suit: "c" }, { rank: 3, suit: "d" }],
      communityCards: [
        { rank: 10, suit: "h" }, { rank: 11, suit: "d" }, { rank: 12, suit: "c" }, { rank: 13, suit: "s" },
      ],
      street: "turn",
      isIP: true,
      potSize: 400,
      callAmount: 0,
    });
    expect(boardStraight).not.toContain("straight-draw");

    const realStraight = classifyHand({
      myCards: [{ rank: 9, suit: "c" }, { rank: 3, suit: "d" }],
      communityCards: [
        { rank: 10, suit: "h" }, { rank: 11, suit: "d" }, { rank: 12, suit: "c" }, { rank: 2, suit: "s" },
      ],
      street: "turn",
      isIP: true,
      potSize: 400,
      callAmount: 0,
    });
    expect(realStraight).toContain("straight-draw");

    const boardFlush = classifyHand({
      myCards: [{ rank: 2, suit: "c" }, { rank: 3, suit: "d" }],
      communityCards: [
        { rank: 4, suit: "h" }, { rank: 8, suit: "h" }, { rank: 11, suit: "h" }, { rank: 13, suit: "h" },
      ],
      street: "turn",
      isIP: true,
      potSize: 400,
      callAmount: 0,
    });
    expect(boardFlush).not.toContain("flush-draw");
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
