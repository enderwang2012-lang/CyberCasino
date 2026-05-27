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
  thinkingSource: "llm" | "strategy" | "rule";
}

export interface AgentDecision {
  action: Action;
  thought: AgentThought;
  audit?: AgentActionAudit;
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

export interface StackDepthAdjustment {
  minBB: number;           // 筹码量阈值（大盲数）
  widenRange?: string[];   // 放宽的手牌（加入 raise/call）
  tightenRange?: string[]; // 收紧的手牌（移出 raise → call/fold）
  pushFold?: boolean;      // <= 10bb 时用 push/fold 范围
}

export interface PreflopContextRule {
  condition: "multiway" | "shortStack" | "deepStack" | "highPotOdds" | "lastToAct";
  adjust: "widen" | "tighten" | "aggressive";
  notes?: string;
}

export interface PreflopConfig {
  ranges: Record<Position, PositionRange>;
  sizing: {
    openRaise: string;
    threeBet: string;
    fourBet: string;
  };
  stackAdjustments?: StackDepthAdjustment[];
  contextRules?: PreflopContextRule[];
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

export type Street = "preflop" | "flop" | "turn" | "river";

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
  confident: string | string[];
  worried: string | string[];
  bluffing: string | string[];
  frustrated: string | string[];
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

// The first verified runtime executes StrategyConfig as a constrained DSL.
// Future code/WASM runtimes can be added without changing the match contract.
export type StrategyRuntime = "declarative_v1";
export type ArenaExecutionMode = "verified_package" | "remote_agent";
// The current product exposes formal ranked competition only.
// Execution mode remains an internal capability/audit property.
export type ArenaTableMode = "ranked";

export interface StrategyPackageManifest {
  packageId: string;
  version: number;
  agentId?: string;
  runtime: StrategyRuntime;
  createdAt: number;
  createdBy: "bootstrap_ai" | "user_upload" | "platform_builtin";
  basedOnVersion?: number;
  declaredStyle?: StyleProfile;
  contentHash?: string;
}

export interface StrategyPackage {
  manifest: StrategyPackageManifest;
  strategy: StrategyConfig;
  publicHistorySnapshotIds?: string[];
}

export interface StrategyVersionSummary {
  version: number;
  packageId: string;
  contentHash?: string;
  basedOnVersion?: number;
  createdAt: number;
}

// Skill System
export interface SkillConfig {
  id: string;
  name: string;
  nameEn: string;
  description: string;
  descriptionEn: string;
  systemPrompt: string;
  strategyParams: {
    preflopAggression: number;
    postflopAggression: number;
    bluffFrequency: number;
    callingThreshold: number;
  };
  psychologicalParams: {
    tiltResistance: number;
    confidenceBase: number;
  };
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
  strategyPackage?: StrategyPackage;
  strategyVersions?: StrategyVersionSummary[];
  strategyVersion?: number;
  executionMode?: ArenaExecutionMode;
  soulKey?: string;
  stylePrompt?: string;
  styleProfile?: StyleProfile;
  pendingStylePrompt?: string;
  pendingStyleProfile?: StyleProfile;
  pendingStrategyVersion?: number;
  skillId?: string;
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
  executionMode?: ArenaExecutionMode | "house_bot";
  strategyVersion?: number;
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
  | { type: "action-taken"; playerId: string; action: Action; thought: AgentThought; audit?: AgentActionAudit; allIn?: boolean }
  | { type: "pot-updated"; pots: Pot[] }
  | { type: "showdown"; results: ShowdownResult[] }
  | { type: "hand-complete"; winners: Winner[]; players: PlayerState[] }
  | { type: "player-eliminated"; playerId: string; finishPosition: number; handNumber: number }
  | { type: "blind-level-up"; level: number; smallBlind: number; bigBlind: number; handNumber: number }
  | { type: "tournament-complete"; rankings: { playerId: string; position: number; handsPlayed: number }[] }
  | { type: "agent-roster"; agents: SeatAgent[] }
  | { type: "hand-highlight"; handNumber: number; reasons: HighlightReason[]; commentary: string; potTotal: number; involvedPlayerIds: string[] }
  | { type: "public-commentary"; handNumber: number; commentary: string }
  | { type: "public-standings"; handNumber: number; players: { id: string; chips: number }[] }
  | { type: "ai:thinking"; playerId: string; playerName: string }
  | { type: "ai:thought"; playerId: string; thought: AgentThought; action: Action };

// Socket.IO event types for client-server communication
export interface ServerToClientEvents {
  "game:event": (event: GameEvent) => void;
  "game:reset": () => void;
  "game:state": (state: GameState) => void;
  "lobby:tables": (tables: TableInfo[]) => void;
  "lobby:personalities": (list: BuiltinPersonalityInfo[]) => void;
  "user:registered": (identity: UserIdentity) => void;
  "table:seats": (data: { tableId: string; seats: TableSeat[] }) => void;
  "table:started": (tableId: string) => void;
  "table:stopped": (tableId: string) => void;
  "table:error": (error: string) => void;
  "table:history": (tables: TableInfo[]) => void;
  "agent:created": (data: { agentId: string; status: string; previewUrl?: string }) => void;
  "agent:create-error": (data: { error: string; details?: string }) => void;
  "agent:deleted": (agentId: string) => void;
}

export interface ClientToServerEvents {
  "lobby:join": () => void;
  "table:join": (tableId: string) => void;
  "table:leave": (tableId: string) => void;
  "user:register": (userId: string, userInfo?: { name: string; avatar: string; provider: AuthProvider }) => void;
  "agent:delete": (agentId: string) => void;
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
  mode: ArenaTableMode;
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
  audit?: AgentActionAudit;
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
  players: { id: string; name: string; avatar: string; type: string; strategyVersion?: number }[];
  hands: ReplayHand[];
  rankings: { playerId: string; position: number }[];
  totalHands: number;
  timeline?: GameEvent[];
}

export interface RankedStanding {
  agentId: string;
  name: string;
  avatar: string;
  rating: number;
  gamesPlayed: number;
  ratedGames?: number;
  wins: number;
  averageFinish: number;
  activeStrategyVersion?: number;
  provisional?: boolean;
}

// ===========================================================================
// Strategy Engine V2 — Types
// ===========================================================================

// --- Hand classification (postflop 9-level) ---

export type HandCategory =
  | "nuts"
  | "very_strong_value"
  | "medium_value"
  | "thin_value"
  | "showdown_value"
  | "strong_draw"
  | "weak_draw"
  | "air_with_blocker"
  | "pure_air";

// --- Board texture ---

export interface BoardTexture {
  paired: boolean;
  monotone: boolean;
  flushDrawPresent: boolean;
  straightConnectivity: "low" | "medium" | "high";
  highCardStructure: "ace_high" | "broadway" | "middle" | "low";
  dryness: "dry" | "semi_wet" | "wet";
}

// --- Style profile (10 dimensions) ---

export interface StyleProfile {
  preflopLooseness: number;  // 0=tight 1=loose — preflop hand range width
  aggression: number;         // 0=passive 1=aggressive — bet/raise frequency
  bluffAppetite: number;      // 0=never bluff 1=frequent bluff — bluff ratio in betting range
  valueThinness: number;      // 0=thick value only 1=thin value — willingness to value bet marginal hands
  cbetPressure: number;       // 0=no cbet 1=cbet everything — continuation bet frequency
  defenseStickiness: number;  // 0=fold easily 1=sticky defender — call/fold threshold on borderline
  sizingPressure: number;     // 0=small bets 1=overbets — bet sizing multiplier
  trapTendency: number;       // 0=always bet 1=always trap — slowplay with strong hands
  adaptationRate: number;     // 0=no adaptation 1=fast adaptation — opponent exploit speed
  varianceTolerance: number;  // 0=low variance 1=high variance — tolerance for high-variance lines
}

export const STYLE_DEFAULTS: StyleProfile = {
  preflopLooseness: 0.50,
  aggression: 0.50,
  bluffAppetite: 0.30,
  valueThinness: 0.50,
  cbetPressure: 0.50,
  defenseStickiness: 0.50,
  sizingPressure: 0.50,
  trapTendency: 0.30,
  adaptationRate: 0.50,
  varianceTolerance: 0.50,
};

// --- High-level style (player-facing 3-5 params) ---

export interface HighLevelStyle {
  tightness?: number;         // 0=loose 1=tight — overall hand selectivity
  aggression?: number;        // 0=passive 1=aggressive
  bluffFrequency?: number;    // 0=honest 1=frequent bluffer
  valueOrientation?: number;  // 0=bluff-heavy 1=value-heavy
  adaptability?: number;      // 0=no adaptation 1=fast adaptation
}

// --- Style config (dual-layer) ---

export interface StyleConfig {
  highLevel?: HighLevelStyle;
  override?: Partial<StyleProfile>;
}

// --- Decision state (unified input for decision pipeline) ---

export type PreflopNode =
  | "unopened"
  | "facing_limp"
  | "facing_open"
  | "facing_open_and_call"
  | "facing_three_bet"
  | "facing_four_bet"
  | "blind_vs_blind"
  | "short_stack_push_fold";

export interface DecisionState {
  handId: string;
  street: Street;

  hero: {
    seat: number;
    position: Position;
    holeCards: Card[];
    stackBb: number;
    investedBb: number;
  };

  table: {
    playerCount: number;
    activePlayers: number;
    potBb: number;
    effectiveStackBb: number;
    anteBb: number;
    tournamentStage?: "early" | "middle" | "bubble" | "late" | "heads_up";
  };

  board: {
    cards: Card[];
    texture?: BoardTexture;
  };

  actionContext: {
    amountToCallBb: number;
    facingBetBb: number;
    minRaiseBb: number;
    lastAggressorSeat?: number;
    heroHasInitiative: boolean;
    playersYetToAct: number;
    actionHistory: ActionRecord[];
    preflopNode?: PreflopNode;
  };

  derived: {
    spr: number;
    potOdds?: number;
    handCategory?: HandCategory;
    handStrength?: number;    // 0-1 absolute hand strength
    drawStrength?: number;    // 0-1 draw equity
    blockerScore?: number;
    rangeAdvantage?: number;
    nutAdvantage?: number;
    multiway: boolean;
  };
}

// --- Policy output (baseline strategy result) ---

export type PolicyAction = ActionType | "all_in" | "bet" | "check";

export interface PolicyOutput {
  actions: Partial<Record<PolicyAction, number>>;  // probability per action
  sizings?: Array<{
    sizePotRatio: number;
    probability: number;
  }>;
  reasoningTags: string[];
}

// --- Decision result (full audit log) ---

export interface DecisionStyleShift {
  parameter: keyof StyleProfile;
  action: string;
  delta: number;
}

export interface DecisionResult {
  chosenAction: {
    type: ActionType | "all_in";
    amountBb?: number;
  };

  probabilities: Record<string, number>;

  context: {
    street: Street;
    position: Position;
    handCategory?: HandCategory;
    boardTexture?: BoardTexture;
    potOdds?: number;
    spr: number;
    multiway: boolean;
  };

  influences: {
    baselineTopAction: string;
    styleShifts: DecisionStyleShift[];
    opponentShifts: Array<{
      evidence: string;
      action: string;
      delta: number;
    }>;
    clampsApplied: string[];
    llmOverride?: boolean;
  };

  audit: {
    baselineVersion: string;
    styleProfileVersion: string;
    policySeed: string;
    hiddenInformationIsolationPassed: boolean;
  };

  publicExplanation?: string;
}

// Action-level audit for fair arena execution. It records protocol compliance
// and reproducible sampling, not whether a poker decision was strategically good.
export interface AgentActionAudit {
  agentId: string;
  handNumber: number;
  street: Street;
  tableMode: ArenaTableMode;
  executionMode: ArenaExecutionMode | "house_bot";
  runtime: StrategyRuntime | "remote_websocket" | "platform_fallback" | "legacy";
  packageId?: string;
  packageVersion?: number;
  packageHash?: string;
  stateScope: "visible_information_only";
  validActions: ActionType[];
  proposedAction: Action;
  executedAction: Action;
  validation: {
    accepted: boolean;
    corrections: string[];
  };
  sampling?: {
    seed: string;
    probabilities: Partial<Record<ActionType, number>>;
  };
  decidedAt: number;
}

// --- Opponent model ---

export interface OpponentModel {
  opponentId: string;
  handsObserved: number;

  vpipEstimate?: number;
  pfrEstimate?: number;
  threeBetEstimate?: number;
  foldToCbetEstimate?: number;
  aggressionEstimate?: number;
  showdownLooseEstimate?: number;

  tendencies: Array<
    | "overfolds_flop"
    | "calls_too_wide"
    | "raises_too_often"
    | "underbluffs_river"
    | "unknown"
  >;

  confidence: number;  // 0-1, based on sample size
}

// --- Safety clamp config ---

export interface PolicyClamp {
  maxStyleLogitShift: number;
  maxExploitLogitShift: number;
  minHandsForExploit: number;
  multiwayBluffMultiplier: number;
  maxRiverHeroCallShift: number;
}

export const DEFAULT_POLICY_CLAMP: PolicyClamp = {
  maxStyleLogitShift: 1.5,
  maxExploitLogitShift: 1.0,
  minHandsForExploit: 10,
  multiwayBluffMultiplier: 0.5,
  maxRiverHeroCallShift: 0.8,
};

// --- Bet sizing model ---

export interface BetSizingModel {
  flop: number[];
  turn: number[];
  river: number[];
  raiseMultipliers: number[];
}

export const DEFAULT_BET_SIZINGS: BetSizingModel = {
  flop: [0.33, 0.50, 0.75],
  turn: [0.50, 0.75, 1.00],
  river: [0.50, 0.75, 1.00, 1.50],
  raiseMultipliers: [2.5, 3.0, 4.0],
};

// --- Poker agent config (full) ---

// --- Equity estimation helpers ---

export const DRAW_EQUITIES: Record<string, number> = {
  "flush-draw": 0.36,
  "straight-draw": 0.32,
  "gutshot": 0.17,
  "overcards": 0.25,
  "combo-draw": 0.45,
  "flush-draw-overcards": 0.50,
};

// --- Hand strength by rank (postflop) ---

export const HAND_STRENGTH_MAP: Record<HandRank, number> = {
  "high-card": 0.15,
  "pair": 0.35,
  "two-pair": 0.60,
  "three-of-a-kind": 0.82,
  "straight": 0.85,
  "flush": 0.88,
  "full-house": 0.93,
  "four-of-a-kind": 0.97,
  "straight-flush": 0.99,
  "royal-flush": 1.00,
};
