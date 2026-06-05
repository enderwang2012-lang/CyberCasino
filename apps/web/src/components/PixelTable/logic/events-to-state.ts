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
      return {
        ...next,
        phase: e.phase,
        communityCards: e.communityCards,
        seats: next.seats.map((s) => ({ ...s, currentBet: 0 })),
      };

    case "action-required":
      return {
        ...next,
        currentThinkerId: e.playerId,
        seats: next.seats.map((s) =>
          s.playerId === e.playerId && s.status === "active" ? { ...s, status: "thinking" } : s,
        ),
      };

    case "action-taken": {
      const isAllIn = e.allIn === true;
      const seats = next.seats.map((s) => {
        if (s.playerId !== e.playerId) return s;
        const isFold = e.action.type === "fold";
        const amount = e.action.amount ?? 0;
        const delta = amount - s.currentBet;  // 加注差值
        return {
          ...s,
          currentBet: isFold ? s.currentBet : Math.max(s.currentBet, amount),
          chips: isFold ? s.chips : Math.max(0, s.chips - Math.max(0, delta)),
          status: isFold ? "folded" : isAllIn ? "all-in" : "active",
          lastDecision: {
            action: e.action.type,
            amount: e.action.amount,
            thought: e.thought,
            handNumber: state.handNumber,
            timestamp: index,
          },
        } satisfies SeatState;
      });
      return {
        ...next,
        seats,
        currentThinkerId: state.currentThinkerId === e.playerId ? null : state.currentThinkerId,
        allInFlashAt: isAllIn ? Date.now() : state.allInFlashAt,
      };
    }

    default:
      return next;
  }
}