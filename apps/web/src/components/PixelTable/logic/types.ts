import type { Card, GamePhase, ActionType, AgentThought } from "@cybercasino/shared";

export type SeatStatus = "active" | "thinking" | "folded" | "all-in" | "out";

export interface SeatState {
  playerId: string;
  seatIndex: number;        // 0..5
  name: string;
  avatar: string;
  chips: number;
  currentBet: number;
  status: SeatStatus;
  holeCards: Card[] | null; // showdown 后才填
  lastDecision: {
    action: ActionType;
    amount?: number;
    thought?: AgentThought;
    handNumber: number;
    timestamp: number;       // events 数组下标，用于历史回看
  } | null;
}

export interface PixelTableState {
  handNumber: number;
  phase: GamePhase | "idle";
  communityCards: Card[];
  potTotal: number;
  seats: SeatState[];
  currentThinkerId: string | null;
  winners: { playerId: string; amount: number }[];
  allInFlashAt: number | null;       // 时间戳；用于触发底池红光（>0 = 触发中）
  lastEventIndex: number;            // 已消费到的 events 下标
}

export const EMPTY_PIXEL_TABLE_STATE: PixelTableState = {
  handNumber: 0,
  phase: "idle",
  communityCards: [],
  potTotal: 0,
  seats: [],
  currentThinkerId: null,
  winners: [],
  allInFlashAt: null,
  lastEventIndex: -1,
};