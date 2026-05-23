export type Suit = "h" | "d" | "c" | "s";
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export interface Card {
  suit: Suit;
  rank: Rank;
}

export type GamePhase = "preflop" | "flop" | "turn" | "river" | "showdown";

export type ActionType = "fold" | "check" | "call" | "raise";

export type Position = "UTG" | "MP" | "CO" | "BTN" | "SB" | "BB";

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
  isMistake?: boolean;
  difficulty?: number;
  psychologicalState?: string;
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

// --- Strategy Config types (Agent V2) ---

// Preflop
export interface PositionRange {
  raise: string[];
  call: string[];
  fold: string[];
}

export interface PreflopConfig {
  ranges: Record<Position, PositionRange>;
  sizing: {
    openRaise: string;
    threeBet: string;
    fourBet: string;
  };
}

// Postflop
export type PostflopCondition =
  | "top-pair-top-kicker"
  | "top-pair-good-kicker"
  | "top-pair-weak-kicker"
  | "second-pair"
  | "middle-pair"
  | "bottom-pair"
  | "overpair"
  | "top-two-pair"
  | "two-pair"
  | "three-of-a-kind"
  | "straight"
  | "flush"
  | "full-house"
  | "four-of-a-kind"
  | "straight-flush"
  | "royal-flush"
  | "flush-draw"
  | "straight-draw"
  | "gutshot"
  | "overcards"
  | "nothing"
  | "monster";

export type PostflopAction =
  | "value-bet-small"
  | "value-bet-medium"
  | "value-bet-large"
  | "value-bet-pot"
  | "overbet"
  | "check-call"
  | "check-raise"
  | "check-fold"
  | "check-call-flop-evaluate-turn"
  | "semi-bluff-small"
  | "semi-bluff-medium"
  | "semi-bluff-large"
  | "bluff-small"
  | "bluff-medium"
  | "bluff-large"
  | "slowplay"
  | "trap"
  | "donk-bet";

export type Street = "flop" | "turn" | "river";

export interface PostflopRule {
  when: PostflopCondition;
  action: PostflopAction;
  position?: "IP" | "OOP" | "any";
  streets?: Street[];
  frequency?: number;
  vsBetSize?: "small" | "medium" | "large" | "any";
  priority?: number;
  notes?: string;
}

// Opponent rules
export interface OpponentMatch {
  tags?: string[];
  vpipRange?: [number, number];
  pfrRange?: [number, number];
  specificPlayer?: string;
}

export interface OpponentAdjustments {
  widenRange?: boolean;
  tightenRange?: boolean;
  threeBetMore?: boolean;
  threeBetLess?: boolean;
  bluffMore?: boolean;
  bluffLess?: boolean;
  valueBetThinner?: boolean;
  valueBetWider?: boolean;
  trapMore?: boolean;
  foldToAggression?: boolean;
  limpMore?: boolean;
}

export interface OpponentRule {
  match: OpponentMatch;
  adjustments: OpponentAdjustments;
  sizingOverride?: {
    raiseSizing?: "small" | "medium" | "large" | "overbet";
    bluffSizing?: "small" | "medium" | "large";
  };
  notes?: string;
}

export type TargetedIntent =
  | "intimidate"
  | "bait"
  | "exploit"
  | "table-image"
  | "revenge"
  | "information";

export interface TargetedAction {
  target: OpponentMatch;
  intent: TargetedIntent;
  execution: {
    action: ActionType;
    sizing?: string;
    thoughtHint?: string;
  };
  conditions?: {
    minHands?: number;
    onlyWhenInHand?: boolean;
    maxFrequency?: number;
  };
}

// Expression
export type ThoughtLanguage = "zh" | "en" | "ja" | "ko" | "mixed";

export interface ToneSpectrum {
  warmth: number;
  sass: number;
  intensity: number;
  humor: number;
}

export interface ThoughtTemplates {
  confident: string;
  worried: string;
  bluffing: string;
  frustrated: string;
}

export interface ExpressionConfig {
  thoughtLanguage: ThoughtLanguage;
  tone: ToneSpectrum;
  catchphrases: string[];
  verbalTics: string[];
  thoughtTemplates: ThoughtTemplates;
}

// Imperfection & Tilt
export interface MistakeTendencies {
  scaredFold: number;
  stickyCall: number;
  slowplayBias: number;
  tiltAggression: number;
}

export interface TiltConfig {
  triggerThreshold: number;
  decayRate: number;
  maxLevel: number;
}

export interface ImperfectionConfig {
  baseMistakeRate: number;
  tendencies: MistakeTendencies;
  tilt: TiltConfig;
  confidenceNoise: number;
}

// Player profile
export interface PlayerStats {
  handsPlayed: number;
  vpip: number;
  pfr: number;
  showdownRate: number;
  winRate: number;
}

export interface PlayerTendencies {
  foldToThreeBet: number;
  foldToCBet: number;
  riverBluffFreq: number;
  raiseWithMonster: number;
  positionAware: boolean;
}

export interface HandSnapshot {
  handNumber: number;
  holeCards: string[];
  actions: string[];
  result: "won" | "lost" | "folded";
  profit: number;
}

export interface PlayerProfile {
  playerId: string;
  stats: PlayerStats;
  tendencies: PlayerTendencies;
  tags: string[];
  narrative?: string;
  notableHands: HandSnapshot[];
}

// Strategy config
export interface StrategyConfig {
  preflop: PreflopConfig;
  postflop: PostflopRule[];
  opponentRules?: OpponentRule[];
  targetedActions?: TargetedAction[];
  expression?: ExpressionConfig;
  imperfection?: ImperfectionConfig;
  [key: string]: unknown;
}

export interface DecisionDistribution {
  weights: Map<ActionType, number>;
  difficulty: number;
  isMistake: boolean;
}

// Agent V2 config
export interface AgentConfigV2 {
  id: string;
  userId: string;
  name: string;
  avatar: string;
  description?: string;
  strategy: StrategyConfig;
  soulKey?: string;
  webhookUrl?: string;
  webhookVerified?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AgentPreview {
  name: string;
  description: string;
  avatar?: string;
  sampleThoughts: string[];
  playStyle: string;
}

// --- External Agent types ---

export type AuthProvider = "github" | "google";

export interface UserIdentity {
  userId: string;
  name: string;
  avatar: string;
  provider: AuthProvider;
  createdAt: number;
}

export interface AgentConfig {
  id: string;
  userId: string;
  name: string;
  avatar: string;
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
  type: "custom" | "builtin";
  userId?: string;
}

// Highlight types
export type HighlightReason =
  | "big-pot"
  | "bluff-success"
  | "bluff-catch"
  | "cooler"
  | "bad-beat"
  | "short-stack-comeback"
  | "multi-way-allin";

// Game events yielded by the engine
export type GameEvent =
  | { type: "hand-start"; handNumber: number; players: PlayerState[]; dealerSeatIndex: number }
  | { type: "blinds-posted"; smallBlindPlayerId: string; bigBlindPlayerId: string; smallBlind: number; bigBlind: number }
  | { type: "cards-dealt"; hands: Record<string, Card[]> }
  | { type: "phase-change"; phase: GamePhase; communityCards: Card[] }
  | { type: "action-required"; playerId: string; validActions: ActionType[]; currentBet: number; minRaise: number; callAmount: number }
  | { type: "action-taken"; playerId: string; action: Action; thought: AgentThought; allIn?: boolean }
  | { type: "pot-updated"; pots: Pot[] }
  | { type: "showdown"; results: ShowdownResult[] }
  | { type: "hand-complete"; winners: Winner[]; players: PlayerState[] }
  | { type: "player-eliminated"; playerId: string; finishPosition: number; handNumber: number }
  | { type: "blind-level-up"; level: number; smallBlind: number; bigBlind: number; handNumber: number }
  | { type: "tournament-complete"; rankings: { playerId: string; position: number; handsPlayed: number }[] }
  | { type: "agent-roster"; agents: SeatAgent[] }
  | { type: "hand-highlight"; handNumber: number; reasons: HighlightReason[]; commentary: string; potTotal: number; involvedPlayerIds: string[] };

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
  "lobby:personalities": (list: BuiltinPersonalityInfo[]) => void;
  "user:registered": (identity: UserIdentity) => void;
  "agent:saved": (config: AgentConfig) => void;
  "agent:config": (config: AgentConfig | null) => void;
  "agent:webhookPing": (result: WebhookPingResult) => void;
  "table:seats": (data: { tableId: string; seats: TableSeat[] }) => void;
  "table:started": (tableId: string) => void;
  "table:stopped": (tableId: string) => void;
  "table:error": (error: string) => void;
  "table:history": (tables: TableInfo[]) => void;
  "agent:created": (data: { agentId: string; status: string; previewUrl?: string }) => void;
  "agent:create-error": (data: { error: string; details?: string }) => void;
}

export interface ClientToServerEvents {
  "lobby:join": () => void;
  "table:join": (tableId: string) => void;
  "table:leave": (tableId: string) => void;
  "user:register": (userId: string, userInfo?: { name: string; avatar: string; provider: AuthProvider }) => void;
  "agent:save": (config: Omit<AgentConfig, "id" | "userId" | "webhookVerified">) => void;
  "agent:get": () => void;
  "agent:testWebhook": (url: string) => void;
  "table:sit": (tableId: string) => void;
  "table:sit-builtin": (tableId: string, personalityId: string) => void;
  "table:remove-seat": (tableId: string, seatIndex: number) => void;
  "table:clear-seats": (tableId: string) => void;
  "table:start": (tableId: string, language?: "zh" | "en") => void;
  "table:history": () => void;
  "agent:create-by-ai": (data: { config: StrategyConfig; preview: AgentPreview }) => void;
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
  finishedAt?: number;
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

export interface BuiltinPersonalityInfo {
  id: string;
  name: string;
  avatar: string;
  style: string;
}

// --- Replay types ---

export interface ReplayHandAction {
  playerId: string;
  phase: GamePhase;
  action: ActionType;
  amount?: number;
  thought?: string;
}

export interface ReplayHand {
  handNumber: number;
  smallBlind: number;
  bigBlind: number;
  holeCards: Record<string, Card[]>;
  communityCards: Card[][];
  actions: ReplayHandAction[];
  showdown?: ShowdownResult[];
  winners: Winner[];
}

export interface ReplayData {
  tableId: string;
  tableName: string;
  config: TableConfig;
  players: { id: string; name: string; avatar: string; type: string }[];
  hands: ReplayHand[];
  rankings: { playerId: string; position: number }[];
  totalHands: number;
}
