import type {
  GameEvent,
  TableConfig,
  ActionType,
  Card,
  AgentPlayerView,
  AgentGameView,
  BlindSchedule,
  TableSeat,
  SeatAgent,
  AgentConfig,
  ActionRecord,
} from "@cybercasino/shared";
import { gameLoop } from "@cybercasino/engine";
import type { GamePlayer } from "@cybercasino/engine";
import type { IPokerAgent } from "./agents/agent-interface";
import { PokerAgent } from "./agents/agent";
import { SmartAgent } from "./agents/smart-agent";
import { ExternalAgent } from "./agents/external-agent";
import { PERSONALITIES } from "./agents/personalities";

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
  private eventHistory: GameEvent[] = [];
  private eliminationOrder: string[] = [];
  private currentBlindLevel = 0;
  private currentSmallBlind: number;
  private currentBigBlind: number;
  private blindSchedule: BlindSchedule;
  private autoStart: boolean;

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

  sit(agentConfig: AgentConfig): boolean {
    if (this.running) return false;
    if (this.seats.some((s) => s.agent?.userId === agentConfig.userId)) return false;

    const empty = this.seats.find((s) => s.status === "empty");
    if (!empty) return false;

    empty.status = "occupied";
    empty.agent = {
      id: agentConfig.id,
      name: agentConfig.name,
      avatar: agentConfig.avatar,
      type: agentConfig.mode === "smart" ? "smart" : "custom",
      userId: agentConfig.userId,
    };
    return true;
  }

  leaveSeat(userId: string): boolean {
    if (this.running) return false;
    const seat = this.seats.find((s) => s.agent?.userId === userId);
    if (!seat) return false;
    seat.status = "empty";
    seat.agent = undefined;
    return true;
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
        };
      }
    }
  }

  getSeats(): TableSeat[] {
    return this.seats.map((s) => ({ ...s }));
  }

  getOccupiedCount(): number {
    return this.seats.filter((s) => s.status === "occupied").length;
  }

  // --- Event system ---

  onEvent(listener: (event: GameEvent) => void): void {
    this.listeners.push(listener);
  }

  getEventHistory(): GameEvent[] {
    return this.eventHistory.filter((e) => e.type !== "action-required");
  }

  private emit(event: GameEvent): void {
    this.eventHistory.push(event);
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  // --- Game control ---

  async start(agentConfigs?: Map<string, AgentConfig>): Promise<void> {
    if (this.running) return;
    this.running = true;

    if (this.autoStart) {
      const count = Math.min(this.config.maxPlayers, PERSONALITIES.length);
      PERSONALITIES.slice(0, count).forEach((p, i) => {
        this.seats[i] = {
          seatIndex: i,
          status: "occupied",
          agent: { id: p.id, name: p.name, avatar: p.avatar, type: "builtin" },
        };
      });
    }

    this.agents = this.seats
      .filter((s) => s.status === "occupied" && s.agent)
      .map((s) => this.createAgent(s.agent!, agentConfigs));

    const roster: SeatAgent[] = this.agents.map((a) => ({
      id: a.id,
      name: a.name,
      avatar: a.avatar,
      type: a.agentType === "external" ? "custom" : a.agentType === "smart" ? "smart" : "builtin",
    }));
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
        this.emitTournamentComplete();
        this.running = false;
        break;
      }

      this.handNumber++;
      this.checkBlindLevel();
      try {
        await this.playHand(activePlayers);
        consecutiveErrors = 0;
      } catch (err) {
        consecutiveErrors++;
        console.error(`[table:${this.id}] hand #${this.handNumber} error (${consecutiveErrors}/5):`, err);
        if (consecutiveErrors >= 5) {
          console.error(`[table:${this.id}] too many consecutive errors, stopping tournament`);
          this.emitTournamentComplete();
          this.running = false;
          break;
        }
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      this.checkEliminations();

      const remaining = this.agents.filter(
        (a) => (this.playerStates.get(a.id)?.chips ?? 0) > 0
      );
      if (remaining.length < 2) {
        this.emitTournamentComplete();
        this.running = false;
        break;
      }

      this.dealerSeatIndex = (this.dealerSeatIndex + 1) % this.agents.length;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  stop(): void {
    this.running = false;
  }

  private createAgent(seat: SeatAgent, agentConfigs?: Map<string, AgentConfig>): IPokerAgent {
    if (seat.type === "builtin") {
      return new PokerAgent(seat.id);
    }

    const config = seat.userId && agentConfigs?.get(seat.userId);
    if (!config) {
      return new PokerAgent(PERSONALITIES[0].id);
    }

    if (config.mode === "smart") {
      return new SmartAgent(config);
    }
    return new ExternalAgent(config);
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

        const decision = await agent.decide(view, validActions, callAmount, minRaise);

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
            const raiseAmount = action.amount ?? currentBet + minRaise;
            const totalBet = Math.min(raiseAmount, myShadow.bet + myShadow.chips);
            const toAdd = totalBet - myShadow.bet;
            myShadow.chips -= toAdd;
            myShadow.bet = totalBet;
            potTotal += toAdd;
            if (myShadow.chips === 0) myShadow.allIn = true;
            break;
          }
        }
        actionHistory.push({ playerId, phase: currentPhase, action: { type: action.type as ActionType, amount: action.amount } });

        if (agent.agentType !== "external") {
          await new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));
        }

        return { action: decision.action, thought: decision.thought };
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
      if (event.type === "hand-complete") {
        for (const player of event.players) {
          this.playerStates.set(player.id, { chips: player.chips });
        }
        for (const agent of this.agents) {
          agent.clearHistory();
        }
      }

      this.emit(event);
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

    this.emit({ type: "tournament-complete", rankings });
  }

  getStatus(): "waiting" | "playing" | "finished" {
    if (!this.running && this.handNumber === 0) return "waiting";
    if (this.running) return "playing";
    return "finished";
  }

  getHandNumber(): number {
    return this.handNumber;
  }
}
