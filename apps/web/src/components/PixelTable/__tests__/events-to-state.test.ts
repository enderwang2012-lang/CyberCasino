import { describe, it, expect } from "vitest";
import type { GameEvent, PlayerState } from "@cybercasino/shared";
import { eventsToTableState } from "../logic/events-to-state";
import { EMPTY_PIXEL_TABLE_STATE } from "../logic/types";

const player = (id: string, seat: number, chips = 1000): PlayerState => ({
  id, name: id, avatar: "🤖", chips, holeCards: null, bet: 0, folded: false, allIn: false, seatIndex: seat,
});

describe("eventsToTableState - basics", () => {
  it("returns empty state for empty events", () => {
    expect(eventsToTableState([])).toEqual(EMPTY_PIXEL_TABLE_STATE);
  });

  it("populates seats and handNumber on hand-start", () => {
    const events: GameEvent[] = [
      { type: "hand-start", handNumber: 1, players: [player("p1", 0), player("p2", 1)], dealerSeatIndex: 0 },
    ];
    const state = eventsToTableState(events);
    expect(state.handNumber).toBe(1);
    expect(state.seats).toHaveLength(2);
    expect(state.seats[0].playerId).toBe("p1");
    expect(state.seats[0].chips).toBe(1000);
    expect(state.seats[0].status).toBe("active");
  });

  it("updates pot total on pot-updated", () => {
    const events: GameEvent[] = [
      { type: "hand-start", handNumber: 1, players: [player("p1", 0)], dealerSeatIndex: 0 },
      { type: "pot-updated", pots: [{ amount: 300, eligiblePlayerIds: ["p1"] }, { amount: 100, eligiblePlayerIds: ["p1"] }] },
    ];
    expect(eventsToTableState(events).potTotal).toBe(400);
  });

  it("updates phase and community cards on phase-change", () => {
    const events: GameEvent[] = [
      { type: "hand-start", handNumber: 1, players: [player("p1", 0)], dealerSeatIndex: 0 },
      { type: "phase-change", phase: "flop", communityCards: [{ rank: 14, suit: "s" }, { rank: 13, suit: "h" }, { rank: 7, suit: "c" }] },
    ];
    const state = eventsToTableState(events);
    expect(state.phase).toBe("flop");
    expect(state.communityCards).toHaveLength(3);
  });
});

describe("eventsToTableState - decisions", () => {
  const handStart = (): GameEvent => ({
    type: "hand-start", handNumber: 1, players: [player("p1", 0), player("p2", 1)], dealerSeatIndex: 0,
  });

  it("sets currentThinkerId on action-required", () => {
    const events: GameEvent[] = [
      handStart(),
      { type: "action-required", playerId: "p1", validActions: ["fold", "call", "raise"], currentBet: 50, minRaise: 100, callAmount: 50 },
    ];
    const state = eventsToTableState(events);
    expect(state.currentThinkerId).toBe("p1");
    expect(state.seats[0].status).toBe("thinking");
  });

  it("records lastDecision and updates bet/chips on action-taken (raise)", () => {
    const events: GameEvent[] = [
      handStart(),
      { type: "action-required", playerId: "p1", validActions: ["fold", "call", "raise"], currentBet: 0, minRaise: 100, callAmount: 0 },
      { type: "action-taken", playerId: "p1", action: { type: "raise", amount: 200 }, thought: { message: "go", confidence: 0.9, isBluffing: false, thinkingSource: "rule" } },
    ];
    const state = eventsToTableState(events);
    expect(state.currentThinkerId).toBe(null);
    expect(state.seats[0].currentBet).toBe(200);
    expect(state.seats[0].chips).toBe(800);
    expect(state.seats[0].status).toBe("active");
    expect(state.seats[0].lastDecision?.action).toBe("raise");
    expect(state.seats[0].lastDecision?.amount).toBe(200);
  });

  it("marks seat folded on fold action", () => {
    const events: GameEvent[] = [
      handStart(),
      { type: "action-taken", playerId: "p1", action: { type: "fold" }, thought: { message: "no", confidence: 0.5, isBluffing: false, thinkingSource: "rule" } },
    ];
    expect(eventsToTableState(events).seats[0].status).toBe("folded");
  });

  it("marks seat all-in and triggers allInFlashAt", () => {
    const events: GameEvent[] = [
      handStart(),
      { type: "action-taken", playerId: "p1", action: { type: "raise", amount: 1000 }, thought: { message: "all", confidence: 0.6, isBluffing: false, thinkingSource: "rule" }, allIn: true },
    ];
    const state = eventsToTableState(events);
    expect(state.seats[0].status).toBe("all-in");
    expect(state.seats[0].chips).toBe(0);
    expect(state.allInFlashAt).not.toBe(null);
  });

  it("resets currentBet on phase-change", () => {
    const events: GameEvent[] = [
      handStart(),
      { type: "action-taken", playerId: "p1", action: { type: "raise", amount: 200 }, thought: { message: "x", confidence: 0.5, isBluffing: false, thinkingSource: "rule" } },
      { type: "phase-change", phase: "flop", communityCards: [] },
    ];
    expect(eventsToTableState(events).seats[0].currentBet).toBe(0);
  });
});