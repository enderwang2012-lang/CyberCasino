import { describe, expect, test } from "bun:test";
import { gameLoop } from "../src/game-loop";
import { Deck } from "../src/deck";
import type { Card, GameEvent, Action, AgentThought } from "@cybercasino/shared";

const defaultThought: AgentThought = {
  message: "test",
  confidence: 0.5,
  isBluffing: false,
};

function makePlayers(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
    avatar: "🎮",
    chips: 1000,
    seatIndex: i,
  }));
}

async function collectEvents(
  gen: AsyncGenerator<GameEvent>,
  decisionFn?: (playerId: string) => Action
): Promise<GameEvent[]> {
  const events: GameEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

describe("GameLoop", () => {
  test("completes a hand with everyone folding to a raise", async () => {
    const players = makePlayers(3);
    let actionCount = 0;

    const gen = gameLoop(players, { smallBlind: 50, bigBlind: 100 }, 0, 1, async (playerId, validActions) => {
      actionCount++;
      if (actionCount === 1) {
        return { action: { type: "raise", amount: 300 }, thought: defaultThought };
      }
      return { action: { type: "fold" }, thought: defaultThought };
    });

    const events: GameEvent[] = [];
    for await (const event of gen) {
      events.push(event);
    }

    const handComplete = events.find((e) => e.type === "hand-complete");
    expect(handComplete).toBeDefined();
    expect(handComplete!.type).toBe("hand-complete");
    if (handComplete!.type === "hand-complete") {
      expect(handComplete!.winners.length).toBe(1);
    }
  });

  test("deals cards to all players", async () => {
    const players = makePlayers(6);

    const gen = gameLoop(players, { smallBlind: 50, bigBlind: 100 }, 0, 1, async () => {
      return { action: { type: "fold" }, thought: defaultThought };
    });

    const events: GameEvent[] = [];
    for await (const event of gen) {
      events.push(event);
    }

    const cardsDelt = events.find((e) => e.type === "cards-dealt");
    expect(cardsDelt).toBeDefined();
    if (cardsDelt?.type === "cards-dealt") {
      expect(Object.keys(cardsDelt.hands).length).toBe(6);
      for (const hand of Object.values(cardsDelt.hands)) {
        expect(hand.length).toBe(2);
      }
    }
  });

  test("posts blinds correctly", async () => {
    const players = makePlayers(3);

    const gen = gameLoop(players, { smallBlind: 50, bigBlind: 100 }, 0, 1, async () => {
      return { action: { type: "fold" }, thought: defaultThought };
    });

    const events: GameEvent[] = [];
    for await (const event of gen) {
      events.push(event);
    }

    const blinds = events.find((e) => e.type === "blinds-posted");
    expect(blinds).toBeDefined();
    if (blinds?.type === "blinds-posted") {
      expect(blinds.smallBlind).toBe(50);
      expect(blinds.bigBlind).toBe(100);
    }
  });

  test("reaches showdown when players call", async () => {
    const players = makePlayers(2);

    const gen = gameLoop(players, { smallBlind: 50, bigBlind: 100 }, 0, 1, async (playerId, validActions) => {
      if (validActions.includes("call")) {
        return { action: { type: "call" }, thought: defaultThought };
      }
      return { action: { type: "check" }, thought: defaultThought };
    });

    const events: GameEvent[] = [];
    for await (const event of gen) {
      events.push(event);
    }

    const showdown = events.find((e) => e.type === "showdown");
    expect(showdown).toBeDefined();

    const complete = events.find((e) => e.type === "hand-complete");
    expect(complete).toBeDefined();
    if (complete?.type === "hand-complete") {
      expect(complete.winners.length).toBeGreaterThan(0);
      const totalWon = complete.winners.reduce((sum, w) => sum + w.amount, 0);
      expect(totalWon).toBe(200); // 100 + 100
    }
  });

  test("chip conservation: total chips unchanged after hand", async () => {
    const players = makePlayers(4);
    const initialTotal = players.reduce((s, p) => s + p.chips, 0);

    const gen = gameLoop(players, { smallBlind: 50, bigBlind: 100 }, 0, 1, async (playerId, validActions) => {
      if (validActions.includes("call")) {
        return { action: { type: "call" }, thought: defaultThought };
      }
      return { action: { type: "check" }, thought: defaultThought };
    });

    let finalPlayers: any;
    for await (const event of gen) {
      if (event.type === "hand-complete") {
        finalPlayers = event.players;
      }
    }

    const finalTotal = finalPlayers.reduce((s: number, p: any) => s + p.chips, 0);
    expect(finalTotal).toBe(initialTotal);
  });

  test("a short big blind is only called for the chips that were posted", async () => {
    const players = [
      { id: "p0", name: "A", avatar: "🎮", chips: 1000, seatIndex: 0 },
      { id: "p1", name: "B", avatar: "🎮", chips: 1000, seatIndex: 1 },
      { id: "p2", name: "C", avatar: "🎮", chips: 40, seatIndex: 2 },
    ];
    const gen = gameLoop(players, { smallBlind: 50, bigBlind: 100 }, 0, 1, async () => {
      return { action: { type: "fold" }, thought: defaultThought };
    });

    let required: Extract<GameEvent, { type: "action-required" }> | undefined;
    for await (const event of gen) {
      if (!required && event.type === "action-required") required = event;
    }

    expect(required).toMatchObject({ playerId: "p0", currentBet: 50, callAmount: 50 });
  });

  test("returns an uncalled raise without calling that player a winner", async () => {
    const script: Card[] = [
      { rank: 2, suit: "c" }, { rank: 3, suit: "d" },
      { rank: 14, suit: "s" }, { rank: 14, suit: "h" },
      { rank: 4, suit: "c" },
      { rank: 9, suit: "d" }, { rank: 8, suit: "c" }, { rank: 7, suit: "s" },
      { rank: 13, suit: "d" },
      { rank: 5, suit: "c" },
    ];
    const originalDeal = Deck.prototype.deal;
    Deck.prototype.deal = function (count = 1) {
      return script.splice(0, count);
    };
    try {
      const players = [
        { id: "p0", name: "A", avatar: "🎮", chips: 1000, seatIndex: 0 },
        { id: "p1", name: "B", avatar: "🎮", chips: 150, seatIndex: 1 },
      ];
      const gen = gameLoop(players, { smallBlind: 50, bigBlind: 100 }, 0, 1, async (playerId) => {
        if (playerId === "p0") return { action: { type: "raise", amount: 300 }, thought: defaultThought };
        return { action: { type: "call" }, thought: defaultThought };
      });
      let complete: Extract<GameEvent, { type: "hand-complete" }> | undefined;
      for await (const event of gen) {
        if (event.type === "hand-complete") complete = event;
      }
      expect(complete).toBeDefined();
      expect(complete!.winners.map((winner) => winner.playerId)).toEqual(["p1"]);
      expect(complete!.winners[0].amount).toBe(300);
      expect(complete!.players.find((player) => player.id === "p0")!.chips).toBe(850);
      expect(complete!.players.find((player) => player.id === "p1")!.chips).toBe(300);
    } finally {
      Deck.prototype.deal = originalDeal;
    }
  });

  test("an undersized all-in does not let the previous bettor raise again", async () => {
    const players = [
      { id: "p0", name: "A", avatar: "🎮", chips: 1000, seatIndex: 0 },
      { id: "p1", name: "B", avatar: "🎮", chips: 1000, seatIndex: 1 },
      { id: "p2", name: "C", avatar: "🎮", chips: 250, seatIndex: 2 },
    ];
    let actions = 0;
    const gen = gameLoop(players, { smallBlind: 50, bigBlind: 100 }, 0, 1, async (playerId, validActions) => {
      actions++;
      if (actions <= 3) {
        return {
          action: { type: validActions.includes("check") ? "check" : "call" },
          thought: defaultThought,
        };
      }
      if (actions === 4) return { action: { type: "raise", amount: 100 }, thought: defaultThought };
      if (actions === 5) return { action: { type: "raise", amount: 150 }, thought: defaultThought };
      if (validActions.includes("check")) return { action: { type: "check" }, thought: defaultThought };
      if (validActions.includes("call")) return { action: { type: "call" }, thought: defaultThought };
      return { action: { type: "fold" }, thought: defaultThought };
    });

    const required: Extract<GameEvent, { type: "action-required" }>[] = [];
    for await (const event of gen) {
      if (event.type === "action-required") required.push(event);
    }

    const waitingPlayer = required[5];
    const previousBettor = required[6];
    expect(waitingPlayer).toMatchObject({ playerId: "p0" });
    expect(waitingPlayer.validActions).toContain("raise");
    expect(previousBettor).toMatchObject({ playerId: "p1" });
    expect(previousBettor.validActions).not.toContain("raise");
    expect(previousBettor.validActions).toContain("call");
  });

  test("gives the odd split chip to the first winner left of the button", async () => {
    const script: Card[] = [
      { rank: 2, suit: "c" }, { rank: 3, suit: "d" },
      { rank: 4, suit: "c" }, { rank: 5, suit: "d" },
      { rank: 2, suit: "h" }, { rank: 3, suit: "c" },
      { rank: 6, suit: "c" },
      { rank: 14, suit: "h" }, { rank: 13, suit: "h" }, { rank: 12, suit: "h" },
      { rank: 6, suit: "d" },
      { rank: 11, suit: "h" },
      { rank: 6, suit: "h" },
      { rank: 10, suit: "h" },
    ];
    const originalDeal = Deck.prototype.deal;
    Deck.prototype.deal = function (count = 1) {
      return script.splice(0, count);
    };
    try {
      const players = [
        { id: "p0", name: "A", avatar: "🎮", chips: 100, seatIndex: 0 },
        { id: "p1", name: "B", avatar: "🎮", chips: 100, seatIndex: 1 },
        { id: "p2", name: "C", avatar: "🎮", chips: 100, seatIndex: 2 },
      ];
      let smallBlindFolded = false;
      const gen = gameLoop(players, { smallBlind: 1, bigBlind: 2 }, 0, 1, async (playerId, validActions) => {
        if (playerId === "p1" && !smallBlindFolded && validActions.includes("fold")) {
          smallBlindFolded = true;
          return { action: { type: "fold" }, thought: defaultThought };
        }
        if (validActions.includes("check")) return { action: { type: "check" }, thought: defaultThought };
        if (validActions.includes("call")) return { action: { type: "call" }, thought: defaultThought };
        return { action: { type: "fold" }, thought: defaultThought };
      });
      let complete: Extract<GameEvent, { type: "hand-complete" }> | undefined;
      for await (const event of gen) {
        if (event.type === "hand-complete") complete = event;
      }
      const chips = (id: string) => complete!.players.find((player) => player.id === id)!.chips;
      expect(chips("p1")).toBe(99);
      expect(chips("p2")).toBe(101);
      expect(chips("p0")).toBe(100);
    } finally {
      Deck.prototype.deal = originalDeal;
    }
  });
});
