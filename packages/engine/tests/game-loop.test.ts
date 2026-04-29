import { describe, expect, test } from "bun:test";
import { gameLoop } from "../src/game-loop";
import type { GameEvent, Action, AgentThought } from "@cybercasino/shared";

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
});
