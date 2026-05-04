export type Suit = "h" | "d" | "c" | "s";
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export interface Card {
  suit: Suit;
  rank: Rank;
}

export type GamePhase = "preflop" | "flop" | "turn" | "river" | "showdown";

export type ActionType = "fold" | "check" | "call" | "raise";

export interface Action {
  type: ActionType;
  amount?: number;
}

export interface Pot {
  amount: number;
  eligiblePlayerIds: string[];
}

export interface PlayerState {
  id: string;
  name: string;
  avatar: string;
  chips: number;
  holeCards: Card[] | null;
  bet: number;
  folded: boolean;
  allIn: boolean;
  seatIndex: number;
}

export interface GameState {
  id: string;
  tableId: string;
  handNumber: number;
  phase: GamePhase;
  communityCards: Card[];
  pots: Pot[];
  players: PlayerState[];
  dealerSeatIndex: number;
  currentPlayerIndex: number | null;
  smallBlind: number;
  bigBlind: number;
}

export interface AgentThought {
  message: string;
  confidence: number;
  isBluffing: boolean;
}

export interface AgentDecision {
  action: Action;
  thought: AgentThought;
}

export interface AgentGameView {
  myId: string;
  myCards: Card[];
  myChips: number;
  myBet: number;
  phase: GamePhase;
  communityCards: Card[];
  pots: Pot[];
  players: AgentPlayerView[];
  dealerSeatIndex: number;
  smallBlind: number;
  bigBlind: number;
  currentBet: number;
  minRaise: number;
  handNumber: number;
  actionHistory: ActionRecord[];
}

export interface AgentPlayerView {
  id: string;
  name: string;
  avatar: string;
  chips: number;
  bet: number;
  folded: boolean;
  allIn: boolean;
  seatIndex: number;
}

export interface ActionRecord {
  playerId: string;
  phase: GamePhase;
  action: Action;
  thought?: AgentThought;
}

export interface ShowdownResult {
  playerId: string;
  holeCards: Card[];
  bestHand: Card[];
  handRank: HandRank;
  handName: string;
}

export type HandRank =
  | "high-card"
  | "pair"
  | "two-pair"
  | "three-of-a-kind"
  | "straight"
  | "flush"
  | "full-house"
  | "four-of-a-kind"
  | "straight-flush"
  | "royal-flush";

export interface Winner {
  playerId: string;
  amount: number;
  potIndex: number;
}

// --- External Agent types ---

export type AgentMode = "smart" | "custom";

export interface UserIdentity {
  userId: string;
  createdAt: number;
}

export interface AgentConfig {
  id: string;
  userId: string;
  name: string;
  avatar: string;
  mode: AgentMode;
  stylePrompt: string;
  webhookUrl?: string;
  webhookVerified?: boolean;
}

export interface WebhookRequest {
  type: "decision";
  gameView: AgentGameView;
  validActions: ActionType[];
  callAmount: number;
  minRaise: number;
  stylePrompt: string;
}

export interface WebhookPingRequest {
  type: "ping";
  timestamp: number;
}

export interface WebhookResponse {
  action: ActionType;
  amount?: number;
  thought: string;
}

export interface TableSeat {
  seatIndex: number;
  status: "empty" | "occupied";
  agent?: SeatAgent;
}

export interface SeatAgent {
  id: string;
  name: string;
  avatar: string;
  type: "smart" | "custom" | "builtin";
  userId?: string;
}

// Game events yielded by the engine
export type GameEvent =
  | { type: "hand-start"; handNumber: number; players: PlayerState[]; dealerSeatIndex: number }
  | { type: "blinds-posted"; smallBlindPlayerId: string; bigBlindPlayerId: string; smallBlind: number; bigBlind: number }
  | { type: "cards-dealt"; hands: Record<string, Card[]> }
  | { type: "phase-change"; phase: GamePhase; communityCards: Card[] }
  | { type: "action-required"; playerId: string; validActions: ActionType[]; currentBet: number; minRaise: number; callAmount: number }
  | { type: "action-taken"; playerId: string; action: Action; thought: AgentThought }
  | { type: "pot-updated"; pots: Pot[] }
  | { type: "showdown"; results: ShowdownResult[] }
  | { type: "hand-complete"; winners: Winner[]; players: PlayerState[] }
  | { type: "player-eliminated"; playerId: string; finishPosition: number; handNumber: number }
  | { type: "blind-level-up"; level: number; smallBlind: number; bigBlind: number; handNumber: number }
  | { type: "tournament-complete"; rankings: { playerId: string; position: number; handsPlayed: number }[] }
  | { type: "agent-roster"; agents: SeatAgent[] };

// Socket.IO event types for client-server communication
export interface WebhookPingResult {
  success: boolean;
  latencyMs?: number;
  error?: string;
}

export interface ServerToClientEvents {
  "game:event": (event: GameEvent) => void;
  "game:state": (state: GameState) => void;
  "lobby:tables": (tables: TableInfo[]) => void;
  "user:registered": (identity: UserIdentity) => void;
  "agent:saved": (config: AgentConfig) => void;
  "agent:config": (config: AgentConfig | null) => void;
  "agent:webhookPing": (result: WebhookPingResult) => void;
  "table:seats": (data: { tableId: string; seats: TableSeat[] }) => void;
  "table:started": (tableId: string) => void;
  "table:stopped": (tableId: string) => void;
  "table:error": (error: string) => void;
}

export interface ClientToServerEvents {
  "lobby:join": () => void;
  "table:join": (tableId: string) => void;
  "table:leave": (tableId: string) => void;
  "table:create": (config: TableConfig) => void;
  "user:register": (existingUserId?: string) => void;
  "agent:save": (config: Omit<AgentConfig, "id" | "userId" | "webhookVerified">) => void;
  "agent:get": () => void;
  "agent:testWebhook": (url: string) => void;
  "table:sit": (tableId: string) => void;
  "table:leave-seat": (tableId: string) => void;
  "table:fillAI": (tableId: string) => void;
  "table:start": (tableId: string) => void;
  "table:stop": (tableId: string) => void;
}

export interface BlindLevel {
  small: number;
  big: number;
}

export interface BlindSchedule {
  handsPerLevel: number;
  levels: BlindLevel[];
}

export interface TableConfig {
  name: string;
  smallBlind: number;
  bigBlind: number;
  startingChips: number;
  maxPlayers: number;
  blindSchedule?: BlindSchedule;
}

export interface TableInfo {
  id: string;
  name: string;
  config: TableConfig;
  playerCount: number;
  handNumber: number;
  status: "waiting" | "playing" | "finished";
  seats: TableSeat[];
  creatorUserId?: string;
}

// Agent personality config
export interface AgentPersonality {
  id: string;
  name: string;
  avatar: string;
  style: string;
  tightness: number;      // 0 (loose) to 1 (tight) — starting hand range
  aggression: number;      // 0 (passive) to 1 (aggressive) — bet/raise frequency
  bluffFrequency: number;  // 0 to 1
  claudeThreshold: number; // 0 to 1 — how uncertain before calling Claude
  systemPrompt: string;
}
