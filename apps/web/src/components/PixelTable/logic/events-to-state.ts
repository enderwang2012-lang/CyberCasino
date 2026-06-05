import type { GameEvent } from "@cybercasino/shared";
import { EMPTY_PIXEL_TABLE_STATE, type PixelTableState, type SeatState } from "./types";

export function eventsToTableState(events: GameEvent[]): PixelTableState {
  let state: PixelTableState = { ...EMPTY_PIXEL_TABLE_STATE, seats: [] };

  for (let i = 0; i < events.length; i++) {
    state = applyEvent(state, events[i], i);
  }
  return state;
}

function applyEvent(state: PixelTableState, e: GameEvent, index: number): PixelTableState {
  const next = { ...state, lastEventIndex: index };
  switch (e.type) {
    case "hand-start":
      return {
        ...next,
        handNumber: e.handNumber,
        phase: "preflop",
        communityCards: [],
        potTotal: 0,
        currentThinkerId: null,
        winners: [],
        seats: e.players.map<SeatState>((p) => ({
          playerId: p.id,
          seatIndex: p.seatIndex,
          name: p.name,
          avatar: p.avatar,
          chips: p.chips,
          currentBet: 0,
          status: p.folded ? "folded" : "active",
          holeCards: null,
          lastDecision: null,
        })),
      };
    case "pot-updated":
      return { ...next, potTotal: e.pots.reduce((sum, pot) => sum + pot.amount, 0) };
    case "phase-change":
      return { ...next, phase: e.phase, communityCards: e.communityCards };
    default:
      return next;
  }
}