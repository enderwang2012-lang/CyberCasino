import { createHash } from "node:crypto";
import type {
  GameEvent,
  AgentActionAudit,
  TableConfig,
  ActionType,
  Card,
  AgentPlayerView,
  AgentGameView,
  BlindSchedule,
  TableSeat,
  SeatAgent,
  AgentConfigV2,
  ActionRecord,
  ShowdownResult,
  ReplayData,
  ReplayHand,
  ReplayHandAction,
  HighlightReason,
  StrategyConfig,
  AgentPersonality,
} from "@cybercasino/shared";
import { gameLoop } from "@cybercasino/engine";
import type { GamePlayer } from "@cybercasino/engine";
import type { IPokerAgent } from "./agents/agent-interface";
import { StrategyAgent } from "./agents/strategy-agent";
import { WebSocketAgent } from "./agents/websocket-agent";
import { wsAgentManager } from "./agents/websocket-agent-manager";
import { loadBuiltinStrategies } from "./agents/strategy-loader";
import { createStrategyPackage } from "./agents/strategy-package";
import { auditDecision } from "./agents/action-audit";
import { PERSONALITIES, STYLE_PRESETS } from "./agents/personalities";
import { buyIn, cashOut, settleHandStacks, skim, type SeasonEntry } from "./season-ledger";
import { detectHighlights } from "./highlight-detector";
import { generateCommentary, type CommentaryContext } from "./highlight-commentary";
import type { AgentSnapshotAction, AgentSnapshotState } from "./agents/external-agent-protocol";

const DEFAULT_BLIND_SCHEDULE: BlindSchedule = {
  handsPerLevel: 10,
  levels: [
    { small: 50, big: 100 },
    { small: 75, big: 150 },
    { small: 100, big: 200 },
    { small: 150, big: 300 },
    { small: 200, big: 400 },
    { small: 300, big: 600 },
    { small: 500, big: 1000 },
    { small: 1000, big: 2000 },
  ],
};

const builtinStrategies = loadBuiltinStrategies();

export interface CashSettlement {
  handNumber: number;
  status: "playing";
  seatedIds: string[];
  chips: Record<string, number>;
  seasons: SeasonEntry[];
  dealerSeatIndex: number;
  smallBlind: number;
  bigBlind: number;
}

export class TableInstance {
  readonly id: string;
  readonly config: TableConfig;
  readonly creatorUserId?: string;
  private agents: IPokerAgent[] = [];
  private seats: TableSeat[];
  private handNumber = 0;
  private dealerSeatIndex = 0;
  private playerStates: Map<string, { chips: number }> = new Map();
  private running = false;
  private listeners: ((event: GameEvent) => void)[] = [];
  private liveListeners: ((event: GameEvent) => void)[] = [];
  private eventHistory: GameEvent[] = [];
  private liveEventHistory: GameEvent[] = [];
  private eliminationOrder: string[] = [];
  private currentBlindLevel = 0;
  private currentSmallBlind: number;
  private currentBigBlind: number;
  private blindSchedule: BlindSchedule;
  private autoStart: boolean;
  private language: "zh" | "en" = "zh";
  private lockedStyleAgentIds = new Set<string>();
  private snapshotSeq = 0;
  private snapshotStatus: AgentSnapshotState["status"] = "waiting";
  private snapshotHandId: string | null = null;
  private snapshotHandNumber = 0;
  private snapshotPhase: AgentSnapshotState["phase"] = null;
  private snapshotCommunityCards: Card[] = [];
  private snapshotPlayers: AgentPlayerView[] = [];
  private snapshotPots: AgentSnapshotState["pots"] = [];
  private snapshotDealerSeatIndex: number | null = null;
  private snapshotCurrentPlayerId: string | null = null;
  private snapshotCurrentBet = 0;
  private snapshotCallAmount = 0;
  private snapshotMinRaiseTo: number | null = null;
  private snapshotMaxRaiseTo: number | null = null;
  private snapshotValidActions: ActionType[] = [];
  private snapshotActionHistory: AgentSnapshotAction[] = [];
  private snapshotHoleCards = new Map<string, Card[]>();
  private readonly scriptedAgents = new Map<string, IPokerAgent>();
  private readonly fundedStacks = new Map<string, number>();
  private readonly seasonEntries = new Map<string, SeasonEntry>();
  private readonly stayingAgents = new Set<string>();
  private spectatorTable = false;
  private stopNewHands = false;
  private closingReason: "left" | "season_broke" | "table_closed" | "season_ended" = "table_closed";
  private readonly departureReasons = new Map<string, "left" | "season_broke" | "table_closed" | "season_ended">();
  private readonly vacatedAgents = new Set<string>();
  private acceptingSeatChanges = false;
  private readonly leavingAgents = new Set<string>();
  private readonly deferredSeatChanges: Array<() => void> = [];
  private onBetweenHands?: () => void;
  private onSeatVacated?: (agentId: string) => void;
  private seasonRecorder?: (entries: SeasonEntry[], handNumber: number) => void;
  private readonly sittings = new Map<string, { equity: number; at: number; hands: number }>();
  readonly cashSettlements: CashSettlement[] = [];

  constructor(id: string, config: TableConfig, creatorUserId?: string, autoStart = false) {
    if (config.handLimit !== undefined && (!Number.isSafeInteger(config.handLimit) || config.handLimit < 1)) {
      throw new Error("handLimit must be a positive integer");
    }
    for (const delay of [config.interHandDelayMs, config.actionDelayMs]) {
      if (delay !== undefined && (!Number.isSafeInteger(delay) || delay < 0)) {
        throw new Error("Table delays must be non-negative integers");
      }
    }
    this.id = id;
    this.config = config;
    this.creatorUserId = creatorUserId;
    this.autoStart = autoStart;
    this.blindSchedule = config.blindSchedule ?? DEFAULT_BLIND_SCHEDULE;
    this.currentSmallBlind = config.smallBlind;
    this.currentBigBlind = config.bigBlind;
    this.seats = Array.from({ length: config.maxPlayers }, (_, i) => ({
      seatIndex: i,
      status: "empty" as const,
    }));
    wsAgentManager.registerSnapshotSource(this.id, (agentId) => this.getSnapshotForAgent(agentId));
  }

  // --- Seat management ---

  sit(
    agentConfig: Pick<AgentConfigV2, "id" | "userId" | "name" | "avatar">,
    executionMode: "verified_package" | "remote_agent" = "remote_agent",
    strategyVersion?: number,
  ): boolean {
    if (!this.canChangeSeats()) return false;
    if (this.seats.some((s) => s.agent?.userId === agentConfig.userId)) return false;

    const empty = this.seats.find((s) => s.status === "empty");
    if (!empty) return false;

    empty.status = "occupied";
    empty.agent = {
      id: agentConfig.id,
      name: agentConfig.name,
      avatar: agentConfig.avatar,
      type: "custom",
      userId: agentConfig.userId,
      executionMode,
      strategyVersion,
    };
    return true;
  }

  sitBuiltin(personalityId: string, strategyVersion?: number): boolean {
    if (!this.canChangeSeats()) return false;
    if (this.seats.some((s) => s.agent?.id === personalityId)) return false;

    const empty = this.seats.find((s) => s.status === "empty");
    if (!empty) return false;

    const p = PERSONALITIES.find((p) => p.id === personalityId);
    if (!p) return false;

    empty.status = "occupied";
    empty.agent = {
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      type: "builtin",
      executionMode: "house_bot",
      strategyVersion,
    };
    return true;
  }

  getSeats(): TableSeat[] {
    return this.seats.map((seat) => ({
      ...seat,
      agent: seat.agent
        ? {
            id: seat.agent.id,
            name: seat.agent.name,
            avatar: seat.agent.avatar,
            type: seat.agent.type,
            userId: seat.agent.userId,
            strategyVersion: seat.agent.strategyVersion,
          }
        : undefined,
    }));
  }

  getOccupiedCount(): number {
    return this.seats.filter((s) => s.status === "occupied").length;
  }

  // --- Event system ---

  onEvent(listener: (event: GameEvent) => void): void {
    this.listeners.push(listener);
  }

  onLiveEvent(listener: (event: GameEvent) => void): void {
    this.liveListeners.push(listener);
  }

  getLiveEventHistory(): GameEvent[] {
    return this.liveEventHistory.map((event) => JSON.parse(JSON.stringify(event)));
  }

  getAuditRecords(): AgentActionAudit[] {
    return this.eventHistory.flatMap((event) =>
      event.type === "action-taken" && event.audit ? [event.audit] : []
    );
  }

  getEventHistory(): GameEvent[] {
    if (this.getStatus() !== "finished") return [];
    return this.eventHistory
      .filter((event) => event.type !== "action-required")
      .map((event) => this.toPublicEvent(event));
  }

  private toPublicEvent(event: GameEvent): GameEvent {
    if (event.type !== "action-taken" || !event.audit) return event;
    return {
      type: "action-taken",
      playerId: event.playerId,
      action: event.action,
      thought: event.thought,
      allIn: event.allIn,
    };
  }

  private emit(event: GameEvent): void {
    this.applySnapshotEvent(event);
    this.snapshotSeq++;
    this.eventHistory.push(JSON.parse(JSON.stringify(event)));
    const publicEvent = this.toPublicEvent(event);
    const liveEvent = this.toLiveEvent(publicEvent);
    if (liveEvent) {
      this.liveEventHistory.push(JSON.parse(JSON.stringify(liveEvent)));
      for (const listener of this.liveListeners) {
        listener(liveEvent);
      }
    }
    for (const listener of this.listeners) {
      listener(publicEvent);
    }
  }

  getSnapshotForAgent(agentId: string): AgentSnapshotState | undefined {
    const hasAgent = this.snapshotPlayers.some((player) => player.id === agentId)
      || this.seats.some((seat) => seat.agent?.id === agentId);
    if (!hasAgent) return undefined;

    const players = this.snapshotPlayers.length > 0
      ? this.snapshotPlayers
      : this.seats
        .filter((seat) => seat.status === "occupied" && seat.agent)
        .map((seat) => ({
          id: seat.agent!.id,
          name: seat.agent!.name,
          avatar: seat.agent!.avatar,
          chips: this.config.mode === "cash"
            ? (this.playerStates.get(seat.agent!.id)?.chips ?? 0)
            : this.config.startingChips,
          bet: 0,
          folded: false,
          allIn: false,
          seatIndex: seat.seatIndex,
        }));
    const stateWithoutHash = {
      tableId: this.id,
      tableSeq: this.snapshotSeq,
      status: this.snapshotStatus,
      handId: this.snapshotHandId,
      handNumber: this.snapshotHandNumber,
      phase: this.snapshotPhase,
      myCards: this.snapshotHoleCards.get(agentId) ?? [],
      communityCards: this.snapshotCommunityCards,
      players,
      pots: this.snapshotPots,
      dealerSeatIndex: this.snapshotDealerSeatIndex,
      currentPlayerId: this.snapshotCurrentPlayerId,
      currentBet: this.snapshotCurrentBet,
      callAmount: this.snapshotCallAmount,
      minRaiseTo: this.snapshotMinRaiseTo,
      maxRaiseTo: this.snapshotMaxRaiseTo,
      validActions: this.snapshotValidActions,
      actionHistory: this.snapshotActionHistory,
    };
    const hashInput = { ...stateWithoutHash };
    delete (hashInput as { tableSeq?: number }).tableSeq;
    const stateHash = createHash("sha256")
      .update(JSON.stringify(hashInput))
      .digest("hex");

    return {
      ...stateWithoutHash,
      stateHash,
      myCards: [...stateWithoutHash.myCards],
      communityCards: [...stateWithoutHash.communityCards],
      players: players.map((player) => ({ ...player })),
      pots: stateWithoutHash.pots.map((pot) => ({
        amount: pot.amount,
        eligiblePlayerIds: [...pot.eligiblePlayerIds],
      })),
      validActions: [...stateWithoutHash.validActions],
      actionHistory: stateWithoutHash.actionHistory.map((entry) => ({
        playerId: entry.playerId,
        phase: entry.phase,
        action: { ...entry.action },
      })),
    };
  }

  private syncSnapshotFromDecision(
    view: AgentGameView,
    validActions: ActionType[],
    callAmount: number,
    minRaise: number,
  ): void {
    this.snapshotStatus = "playing";
    this.snapshotHandId = view.handId ?? `${this.id}:hand-${view.handNumber}`;
    this.snapshotHandNumber = view.handNumber;
    this.snapshotPhase = view.phase;
    this.snapshotCommunityCards = [...view.communityCards];
    this.snapshotPlayers = view.players.map((player) => ({ ...player }));
    this.snapshotPots = view.pots.map((pot) => ({
      amount: pot.amount,
      eligiblePlayerIds: [...pot.eligiblePlayerIds],
    }));
    this.snapshotDealerSeatIndex = view.dealerSeatIndex;
    this.snapshotCurrentPlayerId = view.myId;
    this.snapshotCurrentBet = view.currentBet;
    this.snapshotCallAmount = callAmount;
    this.snapshotMinRaiseTo = Math.min(view.currentBet + minRaise, view.myBet + view.myChips);
    this.snapshotMaxRaiseTo = view.myBet + view.myChips;
    this.snapshotValidActions = [...validActions];
    this.snapshotActionHistory = view.actionHistory.map((entry) => ({
      playerId: entry.playerId,
      phase: entry.phase,
      action: { ...entry.action },
    }));
    this.snapshotHoleCards.set(view.myId, [...view.myCards]);
    this.snapshotSeq++;
  }

  private applySnapshotEvent(event: GameEvent): void {
    switch (event.type) {
      case "agent-roster":
        this.snapshotPlayers = event.agents.map((agent) => {
          const seatIndex = this.seats.find((seat) => seat.agent?.id === agent.id)?.seatIndex ?? 0;
          return {
            id: agent.id,
            name: agent.name,
            avatar: agent.avatar,
            chips: this.config.mode === "cash"
            ? (this.playerStates.get(agent.id)?.chips ?? 0)
            : this.config.startingChips,
            bet: 0,
            folded: false,
            allIn: false,
            seatIndex,
          };
        });
        this.snapshotStatus = "waiting";
        break;
      case "hand-start":
        this.snapshotStatus = "playing";
        this.snapshotHandId = `${this.id}:hand-${event.handNumber}`;
        this.snapshotHandNumber = event.handNumber;
        this.snapshotPhase = "preflop";
        this.snapshotCommunityCards = [];
        this.snapshotPlayers = event.players.map(({ holeCards: _holeCards, ...player }) => ({ ...player }));
        this.snapshotPots = [];
        this.snapshotDealerSeatIndex = event.dealerSeatIndex;
        this.snapshotCurrentPlayerId = null;
        this.snapshotCurrentBet = 0;
        this.snapshotCallAmount = 0;
        this.snapshotMinRaiseTo = null;
        this.snapshotMaxRaiseTo = null;
        this.snapshotValidActions = [];
        this.snapshotActionHistory = [];
        this.snapshotHoleCards.clear();
        break;
      case "blinds-posted":
        this.updateSnapshotPlayer(event.smallBlindPlayerId, (player) => ({
          ...player,
          chips: player.chips - event.smallBlind,
          bet: event.smallBlind,
          allIn: player.chips - event.smallBlind === 0,
        }));
        this.updateSnapshotPlayer(event.bigBlindPlayerId, (player) => ({
          ...player,
          chips: player.chips - event.bigBlind,
          bet: event.bigBlind,
          allIn: player.chips - event.bigBlind === 0,
        }));
        break;
      case "cards-dealt":
        for (const [playerId, cards] of Object.entries(event.hands)) {
          this.snapshotHoleCards.set(playerId, [...cards]);
        }
        break;
      case "phase-change":
        this.snapshotPhase = event.phase;
        this.snapshotCommunityCards = [...event.communityCards];
        this.snapshotPlayers = this.snapshotPlayers.map((player) => ({ ...player, bet: 0 }));
        this.snapshotCurrentPlayerId = null;
        this.snapshotCurrentBet = 0;
        this.snapshotCallAmount = 0;
        this.snapshotMinRaiseTo = null;
        this.snapshotMaxRaiseTo = null;
        this.snapshotValidActions = [];
        break;
      case "action-required":
        this.snapshotCurrentPlayerId = event.playerId;
        this.snapshotCurrentBet = event.currentBet;
        this.snapshotCallAmount = event.callAmount;
        this.snapshotMinRaiseTo = event.currentBet + event.minRaise;
        this.snapshotMaxRaiseTo = null;
        this.snapshotValidActions = [...event.validActions];
        break;
      case "action-taken": {
        const playerId = this.snapshotCurrentPlayerId ?? event.playerId;
        const player = this.snapshotPlayers.find((entry) => entry.id === playerId);
        if (player) {
          if (event.action.type === "fold") {
            player.folded = true;
          } else if (event.action.type === "call") {
            const toCall = Math.min(this.snapshotCallAmount, player.chips);
            player.chips -= toCall;
            player.bet += toCall;
            player.allIn = player.chips === 0;
          } else if (event.action.type === "raise") {
            const totalBet = Math.min(event.action.amount ?? player.bet, player.bet + player.chips);
            player.chips -= totalBet - player.bet;
            player.bet = totalBet;
            player.allIn = player.chips === 0;
          }
          if (event.allIn) player.allIn = true;
        }
        this.snapshotActionHistory.push({
          playerId: event.playerId,
          phase: this.snapshotPhase ?? "preflop",
          action: { ...event.action },
        });
        this.snapshotCurrentPlayerId = null;
        this.snapshotCallAmount = 0;
        this.snapshotMinRaiseTo = null;
        this.snapshotMaxRaiseTo = null;
        this.snapshotValidActions = [];
        break;
      }
      case "pot-updated":
        this.snapshotPots = event.pots.map((pot) => ({
          amount: pot.amount,
          eligiblePlayerIds: [...pot.eligiblePlayerIds],
        }));
        break;
      case "showdown":
        this.snapshotPhase = "showdown";
        this.snapshotCurrentPlayerId = null;
        this.snapshotValidActions = [];
        break;
      case "hand-complete":
        this.snapshotPlayers = event.players.map(({ holeCards: _holeCards, ...player }) => ({ ...player }));
        this.snapshotPhase = "showdown";
        this.snapshotCurrentPlayerId = null;
        this.snapshotCallAmount = 0;
        this.snapshotMinRaiseTo = null;
        this.snapshotMaxRaiseTo = null;
        this.snapshotValidActions = [];
        break;
      case "player-eliminated":
        this.updateSnapshotPlayer(event.playerId, (player) => ({ ...player, chips: 0, allIn: false }));
        break;
      case "public-standings":
        for (const standing of event.players) {
          this.updateSnapshotPlayer(standing.id, (player) => ({ ...player, chips: standing.chips }));
        }
        break;
      case "tournament-complete":
        this.snapshotStatus = "finished";
        this.snapshotCurrentPlayerId = null;
        this.snapshotCallAmount = 0;
        this.snapshotMinRaiseTo = null;
        this.snapshotMaxRaiseTo = null;
        this.snapshotValidActions = [];
        break;
      default:
        break;
    }
  }

  private updateSnapshotPlayer(
    playerId: string,
    update: (player: AgentPlayerView) => AgentPlayerView,
  ): void {
    this.snapshotPlayers = this.snapshotPlayers.map((player) =>
      player.id === playerId ? update(player) : player);
  }

  private toLiveEvent(event: GameEvent): GameEvent | undefined {
    return event;
  }

  // --- Game control ---

  useScriptedAgent(agent: IPokerAgent): void {
    this.scriptedAgents.set(agent.id, agent);
  }

  fund(agentId: string, chips: number): void {
    this.fundedStacks.set(agentId, chips);
    this.playerStates.set(agentId, { chips });
  }

  attachSeason(entry: SeasonEntry): void {
    if (!this.sittings.has(entry.agentId)) {
      this.sittings.set(entry.agentId, {
        equity: entry.bankroll + entry.tableStack,
        at: Date.now(),
        hands: entry.countedHands,
      });
    }
    this.seasonEntries.set(entry.agentId, { ...entry });
  }

  getSitting(agentId: string): { equity: number; at: number; hands: number } | undefined {
    const sitting = this.sittings.get(agentId);
    return sitting ? { ...sitting } : undefined;
  }

  setSeasonRecorder(recorder: (entries: SeasonEntry[], handNumber: number) => void): void {
    this.seasonRecorder = recorder;
  }

  getSeasonEntry(agentId: string): SeasonEntry | undefined {
    const entry = this.seasonEntries.get(agentId);
    return entry ? { ...entry } : undefined;
  }

  getPlayerChips(agentId: string): number | undefined {
    return this.playerStates.get(agentId)?.chips;
  }

  getDealerSeatIndex(): number {
    return this.dealerSeatIndex;
  }

  markSpectator(spectator: boolean): void {
    this.spectatorTable = spectator;
  }

  isSpectator(): boolean {
    return this.spectatorTable;
  }

  standUp(agentId: string): boolean {
    if (!this.canChangeSeats()) return false;
    const seat = this.seats.find((item) => item.agent?.id === agentId);
    if (!seat) return false;
    seat.status = "empty";
    seat.agent = undefined;
    this.playerStates.delete(agentId);
    this.fundedStacks.delete(agentId);
    this.agents = this.agents.filter((agent) => agent.id !== agentId);
    return true;
  }

  setSeatVacatedHandler(handler: (agentId: string) => void): void {
    this.onSeatVacated = handler;
  }

  setBetweenHandsHandler(handler: () => void): void {
    this.onBetweenHands = handler;
  }

  requestSeasonWindDown(): void {
    this.stopNewHands = true;
    this.closingReason = "season_ended";
  }

  getDepartureReason(agentId: string): "left" | "season_broke" | "table_closed" | "season_ended" {
    return this.departureReasons.get(agentId) ?? this.closingReason;
  }

  requestCashLeave(agentId: string): boolean {
    this.leavingAgents.add(agentId);
    this.departureReasons.set(agentId, "left");
    this.stayingAgents.delete(agentId);
    if (this.running && !this.acceptingSeatChanges) return false;
    const left = this.standUp(agentId);
    if (left) {
      this.leavingAgents.delete(agentId);
      this.notifyVacated(agentId);
    }
    return left;
  }

  private canChangeSeats(): boolean {
    return !this.running || this.acceptingSeatChanges;
  }

  applyBetweenHands(): void {
    if (this.config.mode !== "cash") return;
    this.ensureCashAgents();
    this.settleCashBetweenHands();
  }

  async start(
    language: "zh" | "en" = "zh",
    v2Configs?: Map<string, AgentConfigV2>,
  ): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.language = language;

    if (this.autoStart) {
      const count = Math.min(this.config.maxPlayers, PERSONALITIES.length);
      PERSONALITIES.slice(0, count).forEach((p, i) => {
        this.seats[i] = {
          seatIndex: i,
          status: "occupied",
          agent: { id: p.id, name: p.name, avatar: p.avatar, type: "builtin", executionMode: "house_bot" },
        };
      });
    }

    this.agents = this.seats
      .filter((s) => s.status === "occupied" && s.agent)
      .map((s) => this.createAgent(s.agent!, v2Configs));
    for (const agent of this.agents) {
      if (agent instanceof WebSocketAgent) {
        wsAgentManager.lockStyleForMatch(agent.id, this.id);
        this.lockedStyleAgentIds.add(agent.id);
      }
    }

    const roster: SeatAgent[] = this.getSeats()
      .filter((seat) => seat.status === "occupied" && seat.agent)
      .map((seat) => seat.agent!);
    this.emit({ type: "agent-roster", agents: roster });

    for (const agent of this.agents) {
      const chips = this.config.mode === "cash"
        ? (this.fundedStacks.get(agent.id) ?? 0)
        : this.config.startingChips;
      this.playerStates.set(agent.id, { chips });
    }

    let consecutiveErrors = 0;

    try {
      while (this.running) {
        if (this.config.mode === "cash" && this.stopNewHands) {
          this.closeCashTable();
          break;
        }

        if (this.config.handLimit !== undefined && this.handNumber >= this.config.handLimit) {
          if (this.config.mode === "cash") this.closeCashTable();
          else {
            this.running = false;
            this.emitTournamentComplete();
          }
          break;
        }

        const activePlayers = this.agents.filter(
          (a) => (this.playerStates.get(a.id)?.chips ?? 0) > 0
        );
        if (activePlayers.length < 2) {
          if (this.config.mode === "cash") this.closeCashTable();
          else {
            this.running = false;
            this.emitTournamentComplete();
          }
          break;
        }

        this.handNumber++;
        if (this.config.mode !== "cash") this.checkBlindLevel();
        if (this.config.mode === "cash") this.ensureCashDealer();

        // Ensure dealer is an active player
        const dealerAgent = this.config.mode === "cash"
          ? this.agents.find((agent) => this.seatIndexFor(agent.id) === this.dealerSeatIndex)
          : this.agents[this.dealerSeatIndex];
        if (!dealerAgent || (this.playerStates.get(dealerAgent.id)?.chips ?? 0) <= 0) {
          if (this.config.mode === "cash") {
            this.ensureCashDealer();
          } else {
            for (let i = 0; i < this.agents.length; i++) {
              const idx = (this.dealerSeatIndex + i) % this.agents.length;
              if ((this.playerStates.get(this.agents[idx]?.id)?.chips ?? 0) > 0) {
                this.dealerSeatIndex = idx;
                break;
              }
            }
          }
        }

        try {
          await this.playHand(activePlayers);
          consecutiveErrors = 0;
        } catch (err) {
          if (!this.running) break;
          consecutiveErrors++;
          console.error(`[table:${this.id}] hand #${this.handNumber} error (${consecutiveErrors}/5):`, err);
          if (consecutiveErrors >= 5) {
            if (this.config.mode === "cash") {
              this.closeCashTable();
              break;
            }
            this.running = false;
            throw new Error(`Tournament aborted after ${consecutiveErrors} consecutive hand errors: ${String(err)}`);
          }
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        if (this.config.mode === "cash") {
          this.settleCashBetweenHands();
          const solvent = this.agents.filter((agent) => (this.playerStates.get(agent.id)?.chips ?? 0) > 0);
          if (solvent.length < 2) {
            this.closeCashTable();
            break;
          }
        } else {
          this.checkEliminations();

          const remaining = this.agents.filter(
            (a) => (this.playerStates.get(a.id)?.chips ?? 0) > 0
          );
          if (remaining.length < 2) {
            this.running = false;
            this.emitTournamentComplete();
            break;
          }

          // Advance dealer to next active player
          let nextDealer = this.dealerSeatIndex;
          for (let i = 0; i < this.agents.length; i++) {
            nextDealer = (nextDealer + 1) % this.agents.length;
            if ((this.playerStates.get(this.agents[nextDealer]?.id)?.chips ?? 0) > 0) break;
          }
          this.dealerSeatIndex = nextDealer;
        }
        const interHandDelayMs = this.config.interHandDelayMs ?? 3000;
        if (interHandDelayMs > 0) {
          await new Promise((r) => setTimeout(r, interHandDelayMs));
        }
      }
    } finally {
      this.running = false;
      wsAgentManager.cancelTableDecisions(this.id);
      this.unlockMatchStyles();
    }
  }

  stop(): void {
    this.running = false;
    wsAgentManager.cancelTableDecisions(this.id);
    this.unlockMatchStyles();
    wsAgentManager.unregisterSnapshotSource(this.id);
  }

  private seatIndexFor(agentId: string): number {
    return this.seats.find((seat) => seat.agent?.id === agentId)?.seatIndex ?? 0;
  }

  private occupiedCashSeats(): number[] {
    return this.seats
      .filter((seat) => seat.status === "occupied" && seat.agent && (this.playerStates.get(seat.agent.id)?.chips ?? 0) > 0)
      .map((seat) => seat.seatIndex);
  }

  private ensureCashDealer(): void {
    const seats = this.occupiedCashSeats();
    if (seats.length === 0) return;
    if (!seats.includes(this.dealerSeatIndex)) {
      this.dealerSeatIndex = seats.find((seat) => seat > this.dealerSeatIndex) ?? seats[0];
    }
  }

  private advanceCashDealer(): void {
    const seats = this.occupiedCashSeats();
    if (seats.length === 0) return;
    this.dealerSeatIndex = seats.find((seat) => seat > this.dealerSeatIndex) ?? seats[0];
  }

  private ensureCashAgents(): void {
    if (this.agents.length > 0) return;
    this.agents = this.seats
      .filter((seat) => seat.status === "occupied" && seat.agent)
      .map((seat) => this.createAgent(seat.agent!));
    for (const agent of this.agents) {
      if (!this.playerStates.has(agent.id)) {
        this.playerStates.set(agent.id, { chips: this.fundedStacks.get(agent.id) ?? 0 });
      }
    }
  }

  private vacateAgent(agentId: string): void {
    const seat = this.seats.find((item) => item.agent?.id === agentId);
    if (seat) {
      seat.status = "empty";
      seat.agent = undefined;
    }
    this.agents = this.agents.filter((agent) => agent.id !== agentId);
    this.playerStates.delete(agentId);
  }

  private settleCashBetweenHands(): void {
    for (const agent of [...this.agents]) {
      const chips = this.playerStates.get(agent.id)?.chips ?? 0;
      const entry = this.seasonEntries.get(agent.id);
      if (!entry) continue;
      const settled = skim(settleHandStacks(entry, chips));
      this.seasonEntries.set(agent.id, settled);
      this.playerStates.set(agent.id, { chips: settled.tableStack });
    }

    for (const agent of [...this.agents]) {
      if (!this.leavingAgents.has(agent.id)) continue;
      const entry = this.seasonEntries.get(agent.id);
      if (entry) {
        this.seasonEntries.set(agent.id, cashOut({
          ...entry,
          tableStack: this.playerStates.get(agent.id)?.chips ?? entry.tableStack,
        }));
      }
      this.leavingAgents.delete(agent.id);
      this.vacateAgent(agent.id);
      this.notifyVacated(agent.id);
    }

    for (const agent of [...this.agents]) {
      const chips = this.playerStates.get(agent.id)?.chips ?? 0;
      if (chips > 0) continue;
      const entry = this.seasonEntries.get(agent.id);
      const cashed = entry ? cashOut(entry) : undefined;
      const seatIndex = this.seatIndexFor(agent.id);
      this.vacateAgent(agent.id);
      if (!cashed || !this.stayingAgents.has(agent.id)) {
        if (cashed) this.seasonEntries.set(agent.id, cashed);
        this.departureReasons.set(agent.id, cashed && cashed.bankroll < 5_000 ? "season_broke" : "left");
        this.notifyVacated(agent.id);
        continue;
      }
      const rebought = buyIn(cashed);
      if (!rebought.ok) {
        this.seasonEntries.set(agent.id, rebought.entry);
        continue;
      }
      const seat = this.seats.find((item) => item.seatIndex === seatIndex && item.status === "empty");
      if (!seat) {
        this.seasonEntries.set(agent.id, cashOut(rebought.entry));
        continue;
      }
      seat.status = "occupied";
      seat.agent = {
        id: agent.id,
        name: agent.name,
        avatar: agent.avatar,
        type: agent.agentType === "builtin" ? "builtin" : "custom",
      };
      this.agents.push(agent);
      this.playerStates.set(agent.id, { chips: rebought.entry.tableStack });
      this.seasonEntries.set(agent.id, rebought.entry);
      this.fundedStacks.set(agent.id, rebought.entry.tableStack);
    }

    this.acceptingSeatChanges = true;
    try {
      this.onBetweenHands?.();
    } finally {
      this.acceptingSeatChanges = false;
    }
    if (!this.spectatorTable) {
      this.seasonRecorder?.([...this.seasonEntries.values()].map((entry) => ({ ...entry })), this.handNumber);
    }
    this.advanceCashDealer();
    if (!this.running) return;
    const chips: Record<string, number> = {};
    for (const agent of this.agents) chips[agent.id] = this.playerStates.get(agent.id)?.chips ?? 0;
    this.cashSettlements.push({
      handNumber: this.handNumber,
      status: "playing",
      seatedIds: this.seats.filter((seat) => seat.agent).map((seat) => seat.agent!.id),
      chips,
      seasons: [...this.seasonEntries.values()].map((entry) => ({ ...entry })),
      dealerSeatIndex: this.dealerSeatIndex,
      smallBlind: this.currentSmallBlind,
      bigBlind: this.currentBigBlind,
    });
  }

  private notifyVacated(agentId: string): void {
    if (this.vacatedAgents.has(agentId)) return;
    this.vacatedAgents.add(agentId);
    this.onSeatVacated?.(agentId);
  }

  private closeCashTable(): void {
    for (const agent of [...this.agents]) {
      const entry = this.seasonEntries.get(agent.id);
      if (entry) this.seasonEntries.set(agent.id, cashOut({
        ...entry,
        tableStack: this.playerStates.get(agent.id)?.chips ?? entry.tableStack,
      }));
      this.playerStates.set(agent.id, { chips: 0 });
      if (!this.departureReasons.has(agent.id)) this.departureReasons.set(agent.id, this.closingReason);
    }
    this.running = false;
    for (const agent of [...this.agents]) this.notifyVacated(agent.id);
  }

  private createAgent(
    seat: SeatAgent,
    v2Configs?: Map<string, AgentConfigV2>,
  ): IPokerAgent {
    const scripted = this.scriptedAgents.get(seat.id);
    if (scripted) return scripted;
    const v2Config = seat.userId ? v2Configs?.get(seat.userId) : undefined;
    const isRemoteRuntime = v2Config?.executionMode !== "verified_package";

    // Uploaded packages are platform-executed and cannot be replaced by a live
    // remote connection. This is one ranked capability class, not the only one.
    if (v2Config) {
      if (!isRemoteRuntime) {
        return new StrategyAgent(v2Config, "external", this.config.mode);
      }
    }

    // Ranked competition permits authenticated remote runtimes and identifies
    // them separately in audit records.
    if (wsAgentManager.isConnected(seat.id)) {
      const conn = wsAgentManager.getConnection(seat.id);
      const strategy = v2Config?.strategy ?? builtinStrategies.get(seat.id);
      return new WebSocketAgent(
        seat.id,
        conn?.name ?? seat.name,
        seat.avatar,
        wsAgentManager.getStylePrompt(seat.id),
        this.id,
        wsAgentManager.getStyleProfile(seat.id),
        strategy,
      );
    }

    if (v2Config && isRemoteRuntime) {
      return new WebSocketAgent(
        v2Config.id,
        v2Config.name,
        v2Config.avatar,
        v2Config.stylePrompt ?? "",
        this.id,
        wsAgentManager.getStyleProfile(v2Config.id),
        v2Config.strategy,
      );
    }

    // Preset Agents use the same declarative runtime and ranked competition.
    if (seat.type === "builtin") {
      const personality = PERSONALITIES.find((p) => p.id === seat.id);
      const strategy = builtinStrategies.get(seat.id)
        ?? this.defaultStrategy(personality);

      return new StrategyAgent({
        id: seat.id,
        userId: "platform",
        name: personality?.name ?? seat.name,
        avatar: personality?.avatar ?? seat.avatar,
        strategy,
        strategyPackage: createStrategyPackage(strategy, {
          agentId: seat.id,
          packageId: `house-${seat.id}`,
          createdBy: "platform_builtin",
        }),
        executionMode: "verified_package",
        styleProfile: personality ? STYLE_PRESETS[personality.id] : undefined,
        createdAt: 0,
        updatedAt: 0,
      }, "builtin", this.config.mode);
    }

    // Fallback: use first personality with default strategy
    const fallback = PERSONALITIES[0];
    const fallbackStrategy = builtinStrategies.get(fallback.id)
      ?? this.defaultStrategy(fallback);
    return new StrategyAgent({
      id: fallback.id,
      userId: "platform",
      name: fallback.name,
      avatar: fallback.avatar,
      strategy: fallbackStrategy,
      strategyPackage: createStrategyPackage(fallbackStrategy, {
        agentId: fallback.id,
        packageId: `house-${fallback.id}`,
        createdBy: "platform_builtin",
      }),
      executionMode: "verified_package",
      styleProfile: STYLE_PRESETS[fallback.id],
      createdAt: 0,
      updatedAt: 0,
    }, "builtin", this.config.mode);
  }

  private defaultStrategy(personality?: AgentPersonality): StrategyConfig {
    const tight = personality?.tightness ?? 0.5;
    const agg = personality?.aggression ?? 0.5;
    // Scale ranges by tightness: tighter = fewer hands
    const premiumRaise = ["AA", "KK", "QQ", "JJ", "TT", "AKs", "AQs", "AKo"];
    const goodRaise = tight < 0.5
      ? ["99", "88", "77", "AJs", "ATs", "KQs", "AQo", "AJo"]
      : ["99", "88", "AJs", "KQs", "AQo"];
    const callHands = tight < 0.5
      ? ["66", "55", "A9s", "KTs", "QJs", "JTs", "T9s", "KQo"]
      : ["77", "ATs", "KJs", "QJs", "AJo"];
    const betAction = agg > 0.6 ? "value-bet-large" : agg > 0.3 ? "value-bet-medium" : "value-bet-small";
    return {
      preflop: {
        ranges: {
          UTG: { raise: premiumRaise, call: [], fold: [] },
          MP: { raise: [...premiumRaise, ...goodRaise.slice(0, 3)], call: callHands.slice(0, 3), fold: [] },
          CO: { raise: [...premiumRaise, ...goodRaise], call: callHands, fold: [] },
          BTN: { raise: [...premiumRaise, ...goodRaise, "77"], call: [...callHands, "66"], fold: [] },
          SB: { raise: [...premiumRaise, ...goodRaise.slice(0, 4)], call: callHands.slice(0, 4), fold: [] },
          BB: { raise: premiumRaise.slice(0, 4), call: [...goodRaise, ...callHands], fold: [] },
        },
        sizing: { openRaise: "2.5", threeBet: "3.5", fourBet: "2.5" },
      },
      postflop: [
        { when: "monster", action: "value-bet-large", streets: ["flop", "turn", "river"], priority: 1 },
        { when: "three-of-a-kind", action: "value-bet-large", streets: ["flop", "turn", "river"], priority: 2 },
        { when: "top-two-pair", action: betAction, streets: ["flop", "turn", "river"], priority: 3 },
        { when: "two-pair", action: betAction, streets: ["flop", "turn", "river"], priority: 3 },
        { when: "overpair", action: betAction, streets: ["flop", "turn"], priority: 4 },
        { when: "top-pair-top-kicker", action: "value-bet-small", streets: ["flop"], priority: 4 },
        { when: "top-pair-good-kicker", action: "check-call", streets: ["flop", "turn", "river"], priority: 6 },
        { when: "flush-draw", action: agg > 0.5 ? "semi-bluff-medium" : "check-call", streets: ["flop"], priority: 8 },
        { when: "straight-draw", action: agg > 0.5 ? "semi-bluff-medium" : "check-call", streets: ["flop"], priority: 8 },
        { when: "nothing", action: "check-fold", streets: ["flop", "turn", "river"], priority: 10 },
      ],
      expression: {
        tone: {
          warmth: 0.5,
          sass: agg > 0.6 ? 0.7 : 0.3,
          intensity: agg,
          humor: 0.4,
        },
        thoughtLanguage: "zh",
        thoughtTemplates: {
          confident: ["{handDesc}，{actionDesc}", "有牌有位置，干了"],
          worried: ["有点悬...", "{handDesc}，谨慎行事"],
          bluffing: ["演一下...", "来了来了"],
          frustrated: ["又来？", "算了..."],
        },
        catchphrases: [],
        verbalTics: [],
      },
    };
  }

  private async playHand(activePlayers: IPokerAgent[]): Promise<void> {
    const gamePlayers: GamePlayer[] = activePlayers.map((agent) => ({
      id: agent.id,
      name: agent.name,
      avatar: agent.avatar,
      chips: this.playerStates.get(agent.id)?.chips ?? 0,
      seatIndex: this.config.mode === "cash" ? this.seatIndexFor(agent.id) : this.agents.indexOf(agent),
    }));

    let currentPhaseCards: Card[] = [];
    let currentPhase: "preflop" | "flop" | "turn" | "river" | "showdown" = "preflop";
    const holeCards = new Map<string, Card[]>();
    const handId = `${this.id}:hand-${this.handNumber}`;
    let turnSequence = 0;

    // Shadow state: tracks real bet/fold/allIn/chips within a hand
    const shadow = new Map<string, { chips: number; bet: number; folded: boolean; allIn: boolean }>();
    for (const p of gamePlayers) {
      shadow.set(p.id, { chips: p.chips, bet: 0, folded: false, allIn: false });
    }
    let potTotal = 0;
    const actionHistory: ActionRecord[] = [];

    // Highlight detection state
    const playerChipsAtStart = new Map<string, number>();
    for (const p of gamePlayers) {
      playerChipsAtStart.set(p.id, p.chips);
    }
    let capturedShowdownResults: ShowdownResult[] | null = null;
    let winnerIds: string[] = [];

    const gen = gameLoop(
      gamePlayers,
      { smallBlind: this.currentSmallBlind, bigBlind: this.currentBigBlind },
      this.dealerSeatIndex,
      this.handNumber,
      async (playerId, validActions, currentBet, minRaise, callAmount) => {
        const agent = this.agents.find((a) => a.id === playerId)!;
        const myCards = holeCards.get(playerId) ?? [];
        const myShadow = shadow.get(playerId)!;

        const playerViews: AgentPlayerView[] = gamePlayers.map((p) => {
          const s = shadow.get(p.id)!;
          return {
            id: p.id,
            name: p.name,
            avatar: p.avatar,
            chips: s.chips,
            bet: s.bet,
            folded: s.folded,
            allIn: s.allIn,
            seatIndex: p.seatIndex,
          };
        });

        const eligibleIds = gamePlayers.filter((p) => !shadow.get(p.id)!.folded).map((p) => p.id);
        const pots = [{ amount: potTotal, eligiblePlayerIds: eligibleIds }];

        const view: AgentGameView = {
          myId: agent.id,
          myCards,
          myChips: myShadow.chips,
          myBet: myShadow.bet,
          phase: currentPhase,
          communityCards: currentPhaseCards,
          pots,
          players: playerViews,
          dealerSeatIndex: this.dealerSeatIndex,
          smallBlind: this.currentSmallBlind,
          bigBlind: this.currentBigBlind,
          currentBet,
          minRaise,
          handNumber: this.handNumber,
          actionHistory: actionHistory.slice(-15),
          tableId: this.id,
          handId,
          turnId: `${handId}:turn-${++turnSequence}`,
        };

        // Emit thinking event before decision
        this.emit({
          type: "ai:thinking",
          playerId: agent.id,
          playerName: agent.name,
        });

        this.syncSnapshotFromDecision(view, validActions, callAmount, minRaise);
        const rawDecision = await agent.decide(view, validActions, callAmount, minRaise, this.language);
        if (!this.running) throw new Error("Table stopped");
        const platformFallback = rawDecision.thought.message.startsWith("[Auto-pilot]");
        const decision = auditDecision(rawDecision, view, validActions, minRaise, {
          tableMode: this.config.mode,
          strategyVersion: this.seats.find((seat) => seat.agent?.id === agent.id)?.agent?.strategyVersion,
          executionMode: agent.agentType === "builtin" ? "house_bot" : agent instanceof StrategyAgent ? "verified_package" : "remote_agent",
          runtime: platformFallback
            ? "platform_fallback"
            : agent instanceof StrategyAgent
              ? "declarative_v1"
              : agent instanceof WebSocketAgent
                ? "remote_websocket"
                : "legacy",
        });

        // Emit thought event after decision
        this.emit({
          type: "ai:thought",
          playerId: agent.id,
          thought: decision.thought,
          action: decision.action,
        });

        // Update shadow state based on the decision
        const action = decision.action;
        switch (action.type) {
          case "fold":
            myShadow.folded = true;
            break;
          case "call": {
            const toCall = Math.min(currentBet - myShadow.bet, myShadow.chips);
            myShadow.chips -= toCall;
            myShadow.bet += toCall;
            potTotal += toCall;
            if (myShadow.chips === 0) myShadow.allIn = true;
            break;
          }
          case "raise": {
            let raiseAmount = action.amount ?? currentBet + minRaise;
            const minTotalBet = currentBet + minRaise;
            if (raiseAmount < minTotalBet) {
              raiseAmount = minTotalBet;
            }
            const totalBet = Math.min(raiseAmount, myShadow.bet + myShadow.chips);
            const toAdd = totalBet - myShadow.bet;
            myShadow.chips -= toAdd;
            myShadow.bet = totalBet;
            potTotal += toAdd;
            if (myShadow.chips === 0) myShadow.allIn = true;
            break;
          }
        }
        actionHistory.push({ playerId, phase: currentPhase, action: { type: action.type as ActionType, amount: action.amount }, thought: decision.thought });

        if (agent.agentType !== "external") {
          const actionDelayMs = this.config.actionDelayMs;
          if (actionDelayMs === undefined) {
            await new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));
          } else if (actionDelayMs > 0) {
            await new Promise((r) => setTimeout(r, actionDelayMs));
          }
        }

        return { action: decision.action, thought: decision.thought, audit: decision.audit };
      }
    );

    for await (const event of gen) {
      if (event.type === "blinds-posted") {
        // Update shadow with blind bets
        const sbState = shadow.get(event.smallBlindPlayerId)!;
        sbState.chips -= event.smallBlind;
        sbState.bet = event.smallBlind;
        if (sbState.chips === 0) sbState.allIn = true;
        const bbState = shadow.get(event.bigBlindPlayerId)!;
        bbState.chips -= event.bigBlind;
        bbState.bet = event.bigBlind;
        if (bbState.chips === 0) bbState.allIn = true;
        potTotal += event.smallBlind + event.bigBlind;
      }
      if (event.type === "phase-change") {
        // Reset bets for new betting round
        for (const s of shadow.values()) {
          s.bet = 0;
        }
      }
      if (event.type === "cards-dealt") {
        for (const [id, cards] of Object.entries(event.hands)) {
          holeCards.set(id, cards);
        }
      }
      if (event.type === "phase-change") {
        currentPhaseCards = event.communityCards;
        currentPhase = event.phase as typeof currentPhase;
      }
      if (event.type === "showdown") {
        capturedShowdownResults = event.results;
      }
      if (event.type === "hand-complete") {
        winnerIds = [...new Set(event.winners.map((w) => w.playerId))];
        for (const player of event.players) {
          this.playerStates.set(player.id, { chips: player.chips });
        }
        for (const agent of this.agents) {
          // Update psychological state for StrategyAgent instances
          if (agent instanceof StrategyAgent) {
            const startChips = playerChipsAtStart.get(agent.id) ?? 0;
            const endChips = this.playerStates.get(agent.id)?.chips ?? 0;
            const chipDiff = endChips - startChips;
            const won = winnerIds.includes(agent.id);

            // Detect bad beat: had strong hand but lost
            const showdownResult = capturedShowdownResults?.find((r) => r.playerId === agent.id);
            const STRONG_HANDS = new Set(["two-pair", "three-of-a-kind", "straight", "flush", "full-house", "four-of-a-kind", "straight-flush", "royal-flush"]);
            const hadStrongHand = showdownResult && STRONG_HANDS.has(showdownResult.handRank);
            const wasBadBeat = !!hadStrongHand && !won;

            // Detect bluff caught: bet aggressively but lost at showdown
            const agentActions = actionHistory.filter((a) => a.playerId === agent.id);
            const raisedOrBet = agentActions.some((a) => a.action.type === "raise");
            const wasBluffCaught = !won && raisedOrBet && !!showdownResult;

            agent.updatePsychState({
              wasBadBeat,
              wasBluffCaught,
              bigLoss: chipDiff < -(this.config.startingChips * 0.3),
              bigWin: chipDiff > this.config.startingChips * 0.5,
              handsSinceAction: 0,
            });
          }
          agent.clearHistory();
        }
      }

      this.emit(event);
    }

    // Highlights are recorded without an external commentary call while the
    // match is running. Full-card replay is released only after completion.
    const reasons = detectHighlights({
      handNumber: this.handNumber,
      actionHistory,
      holeCards,
      communityCards: currentPhaseCards,
      showdownResults: capturedShowdownResults,
      potTotal,
      bigBlind: this.currentBigBlind,
      playerChipsAtStart,
      winnerIds,
    });

    console.log(`[highlight] hand #${this.handNumber}: potTotal=${potTotal}, bigBlind=${this.currentBigBlind}, reasons=${reasons.length > 0 ? reasons.join(",") : "none"}`);

    if (reasons.length > 0) {
      const highlightHandNumber = this.handNumber;
      const involvedPlayerIds = [...new Set([
        ...winnerIds,
        ...(capturedShowdownResults?.map((r) => r.playerId) ?? []),
      ])];

      // Offline runs use the same rule commentary without a network dependency.
      const playerNames = new Map(this.agents.map((a) => [a.id, a.name]));
      const commentaryCtx: CommentaryContext = {
        handNumber: this.handNumber,
        reasons,
        actionHistory,
        holeCards,
        communityCards: currentPhaseCards,
        showdownResults: capturedShowdownResults,
        potTotal,
        bigBlind: this.currentBigBlind,
        playerNames,
        winnerIds,
      };
      let commentary: string;
      if (this.config.commentaryMode === "rule") {
        commentary = this.buildLiveCommentary(reasons, actionHistory, capturedShowdownResults,
          winnerIds, potTotal, holeCards, currentPhaseCards, this.currentBigBlind);
      } else {
        let commentaryTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          commentary = await Promise.race([
            generateCommentary(commentaryCtx),
            new Promise<never>((_, reject) => {
              commentaryTimer = setTimeout(() => reject(new Error("LLM timeout")), 15000);
            }),
          ]);
        } catch {
          commentary = this.buildLiveCommentary(reasons, actionHistory, capturedShowdownResults, winnerIds, potTotal, holeCards, currentPhaseCards, this.currentBigBlind);
        } finally {
          clearTimeout(commentaryTimer);
        }
      }

      this.emit({
        type: "hand-highlight",
        handNumber: highlightHandNumber,
        reasons,
        commentary,
        potTotal,
        involvedPlayerIds,
      });
    }
  }

  private checkBlindLevel(): void {
    const schedule = this.blindSchedule;
    const levelIndex = Math.min(
      Math.floor((this.handNumber - 1) / schedule.handsPerLevel),
      schedule.levels.length - 1
    );

    if (levelIndex > this.currentBlindLevel) {
      this.currentBlindLevel = levelIndex;
      const level = schedule.levels[levelIndex];
      this.currentSmallBlind = level.small;
      this.currentBigBlind = level.big;
      this.emit({
        type: "blind-level-up",
        level: levelIndex + 1,
        smallBlind: level.small,
        bigBlind: level.big,
        handNumber: this.handNumber,
      });
    }
  }

  private checkEliminations(): void {
    const newlyEliminated: { id: string; chips: number }[] = [];

    for (const agent of this.agents) {
      const chips = this.playerStates.get(agent.id)?.chips ?? 0;
      if (chips === 0 && !this.eliminationOrder.includes(agent.id)) {
        newlyEliminated.push({ id: agent.id, chips: 0 });
      }
    }

    newlyEliminated.sort((a, b) => a.chips - b.chips);

    for (const eliminated of newlyEliminated) {
      this.eliminationOrder.push(eliminated.id);
      const finishPosition = this.agents.length - this.eliminationOrder.length + 1;
      this.emit({
        type: "player-eliminated",
        playerId: eliminated.id,
        finishPosition,
        handNumber: this.handNumber,
      });
    }
  }

  private emitTournamentComplete(): void {
    const totalPlayers = this.agents.length;
    const rankings: { playerId: string; position: number; handsPlayed: number }[] = [];
    const handsPlayed = new Map<string, number>();
    for (const event of this.eventHistory) {
      if (event.type !== "cards-dealt") continue;
      for (const playerId of Object.keys(event.hands)) {
        handsPlayed.set(playerId, (handsPlayed.get(playerId) ?? 0) + 1);
      }
    }

    if (this.config.handLimit !== undefined && this.handNumber >= this.config.handLimit) {
      const rankedAgents = this.agents.filter((agent) => !this.eliminationOrder.includes(agent.id)).sort((a, b) =>
        (this.playerStates.get(b.id)?.chips ?? 0) - (this.playerStates.get(a.id)?.chips ?? 0)
      );
      rankedAgents.forEach((agent, index) => {
        rankings.push({
          playerId: agent.id,
          position: index + 1,
          handsPlayed: handsPlayed.get(agent.id) ?? 0,
        });
      });
      for (let i = this.eliminationOrder.length - 1; i >= 0; i--) {
        rankings.push({ playerId: this.eliminationOrder[i], position: totalPlayers - i,
          handsPlayed: handsPlayed.get(this.eliminationOrder[i]) ?? 0 });
      }
      this.unlockMatchStyles();
      this.emit({ type: "tournament-complete", rankings });
      return;
    }

    const survivor = this.agents.find(
      (a) => !this.eliminationOrder.includes(a.id)
    );
    if (survivor) {
      rankings.push({ playerId: survivor.id, position: 1, handsPlayed: handsPlayed.get(survivor.id) ?? 0 });
    }

    for (let i = this.eliminationOrder.length - 1; i >= 0; i--) {
      rankings.push({
        playerId: this.eliminationOrder[i],
        position: totalPlayers - i,
        handsPlayed: handsPlayed.get(this.eliminationOrder[i]) ?? 0,
      });
    }

    this.unlockMatchStyles();
    this.emit({ type: "tournament-complete", rankings });
  }

  private unlockMatchStyles(): void {
    for (const agentId of this.lockedStyleAgentIds) {
      wsAgentManager.unlockStyleForMatch(agentId, this.id);
    }
    this.lockedStyleAgentIds.clear();
  }

  private buildLiveCommentary(
    reasons: HighlightReason[],
    actionHistory: ActionRecord[],
    showdownResults: ShowdownResult[] | null,
    winnerIds: string[],
    potTotal: number,
    holeCards: Map<string, Card[]>,
    communityCards: Card[],
    bigBlind: number,
  ): string {
    const RANK_NAMES: Record<number, string> = {
      2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8",
      9: "9", 10: "10", 11: "J", 12: "Q", 13: "K", 14: "A",
    };
    const SUIT_SYMBOLS: Record<string, string> = { h: "♥", d: "♦", c: "♣", s: "♠" };
    const cardStr = (c: Card) => `${RANK_NAMES[c.rank]}${SUIT_SYMBOLS[c.suit]}`;
    const nameOf = (id: string) => this.agents.find((a) => a.id === id)?.name ?? id;
    const isZh = this.language === "zh";

    // Group actions by phase
    const phaseOrder: ActionRecord["phase"][] = ["preflop", "flop", "turn", "river"];
    const phaseActions = new Map<string, ActionRecord[]>();
    for (const a of actionHistory) {
      const list = phaseActions.get(a.phase) ?? [];
      list.push(a);
      phaseActions.set(a.phase, list);
    }

    const narrative: string[] = [];

    // Build action description for each phase
    for (const phase of phaseOrder) {
      const actions = phaseActions.get(phase);
      if (!actions || actions.length === 0) continue;

      // Community cards at this phase
      if (phase === "flop" && communityCards.length >= 3) {
        const cards = communityCards.slice(0, 3).map(cardStr).join(" ");
        narrative.push(isZh ? `翻牌 ${cards}` : `Flop ${cards}`);
      } else if (phase === "turn" && communityCards.length >= 4) {
        narrative.push(isZh ? `转牌 ${cardStr(communityCards[3])}` : `Turn ${cardStr(communityCards[3])}`);
      } else if (phase === "river" && communityCards.length >= 5) {
        narrative.push(isZh ? `河牌 ${cardStr(communityCards[4])}` : `River ${cardStr(communityCards[4])}`);
      }

      // Describe each significant action in order
      for (const a of actions) {
        const who = nameOf(a.playerId);
        const t = a.action.type;
        if (t === "raise") {
          const amt = a.action.amount ?? 0;
          narrative.push(isZh ? `${who} 加注到 ${amt}` : `${who} raises to ${amt}`);
        } else if (t === "call") {
          narrative.push(isZh ? `${who} 跟注` : `${who} calls`);
        } else if (t === "fold" && actions.length <= 3) {
          // Only mention folds in short actions (not multi-way folds)
          narrative.push(isZh ? `${who} 弃牌` : `${who} folds`);
        }
        // Skip checks — not interesting for narrative
      }

      // If many folds in this phase, summarize
      const foldCount = actions.filter((a) => a.action.type === "fold").length;
      if (foldCount >= 3) {
        narrative.push(isZh ? `多人弃牌` : `Multiple folds`);
      }
    }

    // Compose final commentary
    const parts: string[] = [];

    // 1. Action narrative (main body)
    if (narrative.length > 0) {
      parts.push(narrative.join(isZh ? "，" : ", "));
    }

    // 2. Showdown / result
    if (showdownResults && showdownResults.length >= 2) {
      const resultLines = showdownResults.map((r) => {
        const cards = r.holeCards.map(cardStr).join(" ");
        const won = winnerIds.includes(r.playerId);
        return isZh
          ? `${nameOf(r.playerId)} 展示 ${cards}（${r.handName}）${won ? "赢下底池" : ""}`
          : `${nameOf(r.playerId)} shows ${cards} (${r.handName})${won ? " and wins" : ""}`;
      });
      parts.push(resultLines.join(isZh ? "，" : ". "));
    } else if (winnerIds.length > 0) {
      const winnerNames = winnerIds.map((id) => nameOf(id)).join(", ");
      const bluffer = actionHistory.find((a) => a.thought?.isBluffing);
      if (bluffer) {
        parts.push(isZh
          ? `${nameOf(bluffer.playerId)} 一手精彩诈唬，对手全部弃牌！`
          : `${nameOf(bluffer.playerId)} pulls off a bluff — everyone folds!`);
      } else {
        parts.push(isZh
          ? `${winnerNames} 收下底池`
          : `${winnerNames} takes the pot`);
      }
    }

    // 3. Highlight reason commentary (emotional color)
    const bbMultiple = Math.round(potTotal / bigBlind);
    if (reasons.includes("big-pot")) {
      parts.push(isZh
        ? `底池 ${potTotal.toLocaleString()}，超过 ${bbMultiple} 倍大盲！`
        : `Pot ${potTotal.toLocaleString()} — over ${bbMultiple}x big blind!`);
    }
    if (reasons.includes("bad-beat")) {
      parts.push(isZh ? "有人带着强牌倒下了，河牌杀！" : "Strong hand goes down — river card kills!");
    }
    if (reasons.includes("cooler")) {
      parts.push(isZh ? "两副强牌碰撞，谁都不想让步！" : "Two strong hands collide — neither backing down!");
    }
    if (reasons.includes("multi-way-allin")) {
      parts.push(isZh ? "多人全下，火药味拉满！" : "Multi-way all-in — maximum tension!");
    }
    if (reasons.includes("short-stack-comeback")) {
      parts.push(isZh ? "短码绝地翻盘！" : "Short stack comeback!");
    }

    return parts.join(isZh ? "，" : ". ") || (isZh ? "精彩一手！" : "Great hand!");
  }

  getStatus(): "waiting" | "playing" | "finished" {
    if (!this.running && this.handNumber === 0) return "waiting";
    if (this.running) return "playing";
    return "finished";
  }

  getHandNumber(): number {
    return this.handNumber;
  }

  getReplayData(): ReplayData {
    const players = new Map<string, { id: string; name: string; avatar: string; type: string; strategyVersion?: number }>();
    const hands: ReplayHand[] = [];
    const rankings: { playerId: string; position: number; handsPlayed?: number }[] = [];

    let currentHand: ReplayHand | null = null;
    let currentPhase: string = "preflop";
    let holeCards: Record<string, Card[]> = {};
    let activeSmallBlind = this.config.smallBlind;
    let activeBigBlind = this.config.bigBlind;

    for (const event of this.eventHistory) {
      switch (event.type) {
        case "agent-roster": {
          for (const agent of event.agents) {
            players.set(agent.id, {
              id: agent.id,
              name: agent.name,
              avatar: agent.avatar,
              type: agent.type,
              strategyVersion: agent.strategyVersion,
            });
          }
          break;
        }

        case "blind-level-up": {
          activeSmallBlind = event.smallBlind;
          activeBigBlind = event.bigBlind;
          break;
        }

        case "hand-start": {
          currentHand = {
            handId: `${this.id}:hand-${event.handNumber}`,
            handNumber: event.handNumber,
            smallBlind: activeSmallBlind,
            bigBlind: activeBigBlind,
            holeCards: {},
            communityCards: [],
            actions: [],
            winners: [],
          };
          holeCards = {};
          currentPhase = "preflop";
          break;
        }

        case "cards-dealt": {
          holeCards = event.hands;
          if (currentHand) {
            currentHand.holeCards = event.hands;
          }
          break;
        }

        case "phase-change": {
          currentPhase = event.phase;
          if (currentHand) {
            const prevCount = currentHand.communityCards.reduce((s, arr) => s + arr.length, 0);
            const newCards = event.communityCards.slice(prevCount);
            currentHand.communityCards.push(newCards);
          }
          break;
        }

        case "action-taken": {
          if (currentHand) {
            const action: ReplayHandAction = {
              turnId: event.audit?.turnId,
              playerId: event.playerId,
              phase: currentPhase as ReplayHandAction["phase"],
              action: event.action.type,
              amount: event.action.amount,
              thought: event.thought?.message,
            };
            currentHand.actions.push(action);
          }
          break;
        }

        case "showdown": {
          if (currentHand) {
            currentHand.showdown = event.results;
          }
          break;
        }

        case "hand-complete": {
          if (currentHand) {
            currentHand.winners = event.winners;
            hands.push(currentHand);
            currentHand = null;
          }
          break;
        }

        case "tournament-complete": {
          for (const r of event.rankings) {
            rankings.push({
              playerId: r.playerId,
              position: r.position,
              handsPlayed: r.handsPlayed,
            });
          }
          break;
        }
      }
    }

    return {
      tableId: this.id,
      tableName: this.config.name,
      config: this.config,
      players: [...players.values()],
      hands,
      rankings,
      totalHands: this.handNumber,
      timeline: this.getEventHistory(),
    };
  }
}
