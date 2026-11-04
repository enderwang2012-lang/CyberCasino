import type { GameEvent } from "@cybercasino/shared";
import { EMPTY_PIXEL_TABLE_STATE, type PixelTableState, type SeatState } from "./types";

export function chipsToCommit(already: number, target: number, chips: number): number {
  return Math.min(Math.max(0, target - already), Math.max(0, chips));
}

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
    case "blinds-posted":
      return {
        ...next,
        seats: next.seats.map((s) => {
          const posted = s.playerId === e.smallBlindPlayerId
            ? e.smallBlind
            : s.playerId === e.bigBlindPlayerId
              ? e.bigBlind
              : 0;
          if (posted <= 0) return s;
          const cost = chipsToCommit(s.currentBet, posted, s.chips);
          return { ...s, chips: s.chips - cost, currentBet: s.currentBet + cost };
        }),
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
      const toCall = next.seats.reduce((max, s) => Math.max(max, s.currentBet), 0);
      const seats = next.seats.map((s) => {
        if (s.playerId !== e.playerId) return s;
        const isFold = e.action.type === "fold";
        const target = e.action.type === "raise"
          ? e.action.amount ?? s.currentBet
          : e.action.type === "call"
            ? toCall
            : s.currentBet;
        const cost = isFold ? 0 : chipsToCommit(s.currentBet, target, s.chips);
        return {
          ...s,
          currentBet: s.currentBet + cost,
          chips: s.chips - cost,
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

    case "showdown":
      return {
        ...next,
        seats: next.seats.map((s) => {
          const r = e.results.find((x) => x.playerId === s.playerId);
          return r ? { ...s, holeCards: r.holeCards } : s;
        }),
      };

    case "hand-complete":
      return {
        ...next,
        winners: e.winners.map((w) => ({ playerId: w.playerId, amount: w.amount })),
        seats: next.seats.map((s) => {
          const updated = e.players.find((p) => p.id === s.playerId);
          return updated ? { ...s, chips: updated.chips } : s;
        }),
      };

    case "player-eliminated":
      return {
        ...next,
        seats: next.seats.map((s) => (s.playerId === e.playerId ? { ...s, status: "out" } : s)),
      };

    default:
      return next;
  }
}