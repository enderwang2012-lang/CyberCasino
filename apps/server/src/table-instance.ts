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
} from "@cybercasino/shared";
import { gameLoop } from "@cybercasino/engine";
import type { GamePlayer } from "@cybercasino/engine";
import type { IPokerAgent } from "./agents/agent-interface";
import { PokerAgent } from "./agents/agent";
import { StrategyAgent } from "./agents/strategy-agent";
import { WebSocketAgent } from "./agents/websocket-agent";
import { wsAgentManager } from "./agents/websocket-agent-manager";
import { loadBuiltinStrategies } from "./agents/strategy-loader";
import { createStrategyPackage } from "./agents/strategy-package";
import { auditDecision } from "./agents/action-audit";
import { PERSONALITIES } from "./agents/personalities";
import { detectHighlights } from "./highlight-detector";
import { generateCommentary, type CommentaryContext } from "./highlight-commentary";

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
  private controllerUserId?: string;
  private lockedStyleAgentIds = new Set<string>();

  constructor(id: string, config: TableConfig, creatorUserId?: string, autoStart = false) {
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
  }

  // --- Seat management ---

  sit(
    agentConfig: Pick<AgentConfigV2, "id" | "userId" | "name" | "avatar">,
    executionMode: "verified_package" | "remote_agent" = "remote_agent",
    strategyVersion?: number,
  ): boolean {
    if (this.running) return false;
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
    this.controllerUserId ??= agentConfig.userId;
    return true;
  }

  sitBuiltin(personalityId: string): boolean {
    if (this.running) return false;
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
    };
    return true;
  }

  removeSeat(seatIndex: number): SeatAgent | null {
    if (this.running) return null;
    const seat = this.seats[seatIndex];
    if (!seat || seat.status === "empty") return null;
    const agent = seat.agent ?? null;
    seat.status = "empty";
    seat.agent = undefined;
    if (agent?.userId && agent.userId === this.controllerUserId) {
      this.controllerUserId = this.seats.find((entry) => entry.agent?.type === "custom")?.agent?.userId;
    }
    return agent;
  }

  clearAllSeats(): void {
    if (this.running) return;
    for (const seat of this.seats) {
      seat.status = "empty";
      seat.agent = undefined;
    }
    this.controllerUserId = undefined;
  }

  isFull(): boolean {
    return this.seats.every((s) => s.status === "occupied");
  }

  leaveSeat(userId: string): boolean {
    if (this.running) return false;
    const seat = this.seats.find((s) => s.agent?.userId === userId);
    if (!seat) return false;
    seat.status = "empty";
    seat.agent = undefined;
    return true;
  }

  canManage(userId: string | undefined): boolean {
    return !!userId && this.controllerUserId === userId;
  }

  fillWithAI(): void {
    if (this.running) return;
    let personalityIdx = 0;
    const usedIds = new Set(this.seats.filter((s) => s.agent).map((s) => s.agent!.id));

    for (const seat of this.seats) {
      if (seat.status === "empty") {
        while (personalityIdx < PERSONALITIES.length && usedIds.has(PERSONALITIES[personalityIdx].id)) {
          personalityIdx++;
        }
        if (personalityIdx >= PERSONALITIES.length) break;

        const p = PERSONALITIES[personalityIdx++];
        seat.status = "occupied";
        seat.agent = {
          id: p.id,
          name: p.name,
          avatar: p.avatar,
          type: "builtin",
          executionMode: "house_bot",
        };
      }
    }
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

  private toLiveEvent(event: GameEvent): GameEvent | undefined {
    switch (event.type) {
      case "agent-roster":
        return event;
      case "hand-complete":
        return {
          type: "public-standings",
          handNumber: this.handNumber,
          players: event.players.map((player) => ({ id: player.id, chips: player.chips })),
        };
      case "player-eliminated":
        return event;
      case "hand-highlight":
        return event;
      default:
        return undefined;
    }
  }

  // --- Game control ---

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
      this.playerStates.set(agent.id, { chips: this.config.startingChips });
    }

    let consecutiveErrors = 0;

    while (this.running) {
      const activePlayers = this.agents.filter(
        (a) => (this.playerStates.get(a.id)?.chips ?? 0) > 0
      );
      if (activePlayers.length < 2) {
        this.running = false;
        this.emitTournamentComplete();
        break;
      }

      this.handNumber++;
      this.checkBlindLevel();

      // Ensure dealer is an active player
      const dealerAgent = this.agents[this.dealerSeatIndex];
      if (!dealerAgent || (this.playerStates.get(dealerAgent.id)?.chips ?? 0) <= 0) {
        for (let i = 0; i < this.agents.length; i++) {
          const idx = (this.dealerSeatIndex + i) % this.agents.length;
          if ((this.playerStates.get(this.agents[idx]?.id)?.chips ?? 0) > 0) {
            this.dealerSeatIndex = idx;
            break;
          }
        }
      }

      try {
        await this.playHand(activePlayers);
        consecutiveErrors = 0;
      } catch (err) {
        consecutiveErrors++;
        console.error(`[table:${this.id}] hand #${this.handNumber} error (${consecutiveErrors}/5):`, err);
        if (consecutiveErrors >= 5) {
          this.running = false;
          throw new Error(`Tournament aborted after ${consecutiveErrors} consecutive hand errors: ${String(err)}`);
        }
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
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
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  stop(): void {
    this.running = false;
    this.unlockMatchStyles();
  }

  private createAgent(
    seat: SeatAgent,
    v2Configs?: Map<string, AgentConfigV2>,
  ): IPokerAgent {
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
      return new WebSocketAgent(
        seat.id,
        conn?.name ?? seat.name,
        seat.avatar,
        wsAgentManager.getStylePrompt(seat.id),
        this.id,
        wsAgentManager.getStyleProfile(seat.id),
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
      );
    }

    // House bots execute the same declarative package runtime, but remain
    // identifiable as non-ranked fillers/benchmarks.
    if (seat.type === "builtin") {
      const personality = PERSONALITIES.find((p) => p.id === seat.id);
      const strategy = builtinStrategies.get(seat.id);

      if (strategy) {
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
          createdAt: 0,
          updatedAt: 0,
        }, "builtin", this.config.mode);
      }
      return new PokerAgent(seat.id);
    }

    return new PokerAgent(PERSONALITIES[0].id);
  }

  private async playHand(activePlayers: IPokerAgent[]): Promise<void> {
    const gamePlayers: GamePlayer[] = activePlayers.map((agent) => ({
      id: agent.id,
      name: agent.name,
      avatar: agent.avatar,
      chips: this.playerStates.get(agent.id)?.chips ?? 0,
      seatIndex: this.agents.indexOf(agent),
    }));

    let currentPhaseCards: Card[] = [];
    let currentPhase: "preflop" | "flop" | "turn" | "river" | "showdown" = "preflop";
    const holeCards = new Map<string, Card[]>();

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
        };

        // Emit thinking event before decision
        this.emit({
          type: "ai:thinking",
          playerId: agent.id,
          playerName: agent.name,
        });

        const rawDecision = await agent.decide(view, validActions, callAmount, minRaise, this.language);
        const platformFallback = rawDecision.thought.message.startsWith("[Auto-pilot]");
        const decision = auditDecision(rawDecision, view, validActions, minRaise, {
          tableMode: this.config.mode,
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
          await new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));
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

      // Try LLM commentary with timeout, fall back to rule-based
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
      try {
        commentary = await Promise.race([
          generateCommentary(commentaryCtx),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("LLM timeout")), 15000)
          ),
        ]);
      } catch {
        commentary = this.buildLiveCommentary(reasons, actionHistory, capturedShowdownResults, winnerIds, potTotal, holeCards, currentPhaseCards, this.currentBigBlind);
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

    const survivor = this.agents.find(
      (a) => !this.eliminationOrder.includes(a.id)
    );
    if (survivor) {
      rankings.push({ playerId: survivor.id, position: 1, handsPlayed: this.handNumber });
    }

    for (let i = this.eliminationOrder.length - 1; i >= 0; i--) {
      rankings.push({
        playerId: this.eliminationOrder[i],
        position: totalPlayers - i,
        handsPlayed: this.handNumber,
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
    const rankings: { playerId: string; position: number }[] = [];

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
            rankings.push({ playerId: r.playerId, position: r.position });
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
