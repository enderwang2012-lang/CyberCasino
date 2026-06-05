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