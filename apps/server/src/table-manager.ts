import type { TableConfig, TableInfo, AgentConfigV2 } from "@cybercasino/shared";
import { randomUUID } from "node:crypto";
import { TableInstance } from "./table-instance";
import type { GameHistoryStore } from "./stores";
import type { MatchEntry } from "./matchmaking-service";
import { PERSONALITIES } from "./agents/personalities";
import { planCashSeats, type WaitingAgent } from "./cash-seat-policy";
import { buyIn, createSeasonEntry } from "./season-ledger";
import type { SeasonStore } from "./season-store";

const CASINO_NAMES = [
  "Bellagio", "Marina Bay Sands", "The Venetian", "Wynn Palace",
  "Casino de Monte-Carlo", "Crown Melbourne", "City of Dreams",
  "Caesars Palace", "MGM Grand", "The Cosmopolitan",
  "Resorts World", "Atlantis", "Galaxy Macau", "Foxwoods",
  "Borgata", "Hard Rock", "Aria", "Encore", "Palazzo", "Mirage",
];

function randomCasinoName(): string {
  return CASINO_NAMES[Math.floor(Math.random() * CASINO_NAMES.length)];
}

const DEFAULT_CONFIG: TableConfig = {
  name: "",
  mode: "ranked",
  smallBlind: 50,
  bigBlind: 100,
  startingChips: 5000,
  maxPlayers: 6,
};

const CASH_CONFIG: TableConfig = {
  ...DEFAULT_CONFIG,
  mode: "cash",
};

const DEFAULT_ARCHIVE_RETRY_DELAYS_MS = [2_000, 10_000, 30_000];

export class TableManager {
  private tables = new Map<string, TableInstance>();
  private agentV2ConfigsForTable = new Map<string, Map<string, AgentConfigV2>>();
  private finishedTables: TableInfo[] = [];
  private showcaseTableId: string | null = null;
  private historyStore: GameHistoryStore | null = null;
  private seasonStore: SeasonStore | null = null;
  private readonly archiveRetryDelaysMs: readonly number[];

  constructor(options: { archiveRetryDelaysMs?: readonly number[] } = {}) {
    this.archiveRetryDelaysMs = options.archiveRetryDelaysMs ?? DEFAULT_ARCHIVE_RETRY_DELAYS_MS;
  }

  setHistoryStore(store: GameHistoryStore): void {
    this.historyStore = store;
  }

  setSeasonStore(store: SeasonStore): void {
    this.seasonStore = store;
  }

  loadPersistedHistory(): void {
    if (!this.historyStore) return;
    const entries = this.historyStore.getAll();
    this.finishedTables = entries.map((e) => e.info);
  }

  ensureShowcaseTable(): TableInstance | undefined {
    const existing = this.showcaseTableId ? this.tables.get(this.showcaseTableId) : undefined;
    if (existing && existing.getStatus() !== "finished") return existing;
    const { opened } = this.syncCashTables([], this.idlePresetEntries());
    return opened.find((table) => table.isSpectator());
  }

  syncCashTables(waiting: MatchEntry[], idlePresets: MatchEntry[]): {
    opened: TableInstance[];
    stillWaiting: MatchEntry[];
  } {
    const moves = planCashSeats({
      tables: this.cashSnapshots(),
      waitingUsers: waiting.filter((entry) => !entry.userId.startsWith("builtin:")).map(toWaitingUser),
      idlePresets: idlePresets.filter((entry) => !this.isAgentSeated(entry.agent.id)).map(toWaitingPreset),
    });
    const opened: TableInstance[] = [];
    const seatedUsers = new Set<string>();
    for (const move of moves) {
      const table = move.open ? this.openCashTable(move.sit, waiting, idlePresets) : this.tables.get(move.tableId);
      if (!table) continue;
      if (move.open) opened.push(table);
      else this.applySeatMove(table, move, waiting, idlePresets);
      for (const agent of move.sit) {
        if (agent.kind === "user") seatedUsers.add(agent.userId);
      }
    }
    return {
      opened,
      stillWaiting: waiting.filter((entry) => !seatedUsers.has(entry.userId)),
    };
  }

  isShowcaseTable(id: string): boolean {
    return this.showcaseTableId === id;
  }

  createMatchedTable(
    entries: MatchEntry[],
    runOptions: Pick<TableConfig, "handLimit" | "interHandDelayMs" | "actionDelayMs" | "commentaryMode"> = {},
  ): TableInstance {
    if (entries.length < 2 || entries.length > DEFAULT_CONFIG.maxPlayers) {
      throw new Error(`Cash tables require 2 to ${DEFAULT_CONFIG.maxPlayers} Agents`);
    }
    for (const entry of entries) {
      if (entry.userId.startsWith("builtin:") && this.isAgentSeated(entry.agent.id)) {
        throw new Error(`Preset Agent ${entry.agent.id} is already seated at another table`);
      }
    }

    const id = `table-${randomUUID()}`;
    const config = { ...CASH_CONFIG, ...runOptions, name: randomCasinoName() };
    const table = new TableInstance(id, config);
    const frozenConfigs = new Map<string, AgentConfigV2>();

    try {
      for (const entry of entries) {
        const frozenAgent = cloneAgentConfig(entry.agent);
        const executionMode = frozenAgent.executionMode === "verified_package"
          ? "verified_package"
          : "remote_agent";
        const seated = entry.userId.startsWith("builtin:")
          ? table.sitBuiltin(
            frozenAgent.id,
            frozenAgent.strategyVersion ?? frozenAgent.strategyPackage?.manifest.version,
          )
          : table.sit(frozenAgent, executionMode, frozenAgent.strategyVersion
            ?? frozenAgent.strategyPackage?.manifest.version);
        if (!seated) {
          throw new Error(`Unable to seat matched Agent ${frozenAgent.id}`);
        }
        frozenConfigs.set(entry.userId, frozenAgent);
      }
    } catch (error) {
      table.stop();
      throw error;
    }

    this.tables.set(id, table);
    this.agentV2ConfigsForTable.set(id, frozenConfigs);
    return table;
  }

  getTable(id: string): TableInstance | undefined {
    return this.tables.get(id);
  }

  getActiveTableInfos(): TableInfo[] {
    return Array.from(this.tables.values())
      .filter((table) => table.getStatus() !== "finished")
      .map((table) => this.toTableInfo(table));
  }

  getHomepageTables(): TableInfo[] {
    const activeTables = this.getActiveTableInfos();
    const result = activeTables.sort((a, b) =>
      Number(a.id === this.showcaseTableId) - Number(b.id === this.showcaseTableId));

    if (this.finishedTables.length > 0) {
      result.push(this.finishedTables[0]);
    }

    return result;
  }

  getHistoryTables(): TableInfo[] {
    return this.finishedTables;
  }

  isAgentPlaying(agentId: string): boolean {
    for (const table of this.tables.values()) {
      if (table.getStatus() !== "playing") continue;
      if (table.getSeats().some((seat) => seat.agent?.id === agentId)) {
        return true;
      }
    }
    return false;
  }

  isAgentSeated(agentId: string): boolean {
    for (const table of this.tables.values()) {
      if (table.getStatus() === "finished") continue;
      if (table.getSeats().some((seat) => seat.agent?.id === agentId)) return true;
    }
    return false;
  }

  async archiveFinishedTable(tableId: string): Promise<boolean> {
    const table = this.tables.get(tableId);
    if (!table || table.getStatus() !== "finished") return false;

    const info = this.toTableInfo(table);
    info.finishedAt = Date.now();

    if (this.historyStore) {
      const replayData = table.getReplayData();
      const auditRecords = table.getAuditRecords();
      // Retries rely on saveCompletedMatch being idempotent. The finished table
      // stays viewable in memory meanwhile.
      for (let attempt = 0; ; attempt++) {
        try {
          await this.historyStore.saveCompletedMatch(info, replayData, auditRecords);
          break;
        } catch (error) {
          const delayMs = this.archiveRetryDelaysMs[attempt];
          if (delayMs === undefined || this.tables.get(tableId) !== table) {
            this.removeTable(tableId);
            throw error;
          }
          console.warn(`[table:${tableId}] archive attempt ${attempt + 1} failed, retrying in ${delayMs}ms:`, error);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    table.stop();
    this.finishedTables.unshift(info);
    if (this.finishedTables.length > 50) {
      this.finishedTables.pop();
    }
    this.tables.delete(tableId);
    this.agentV2ConfigsForTable.delete(tableId);
    return true;
  }

  private idlePresetEntries(): MatchEntry[] {
    return PERSONALITIES
      .filter((personality) => !this.isAgentSeated(personality.id))
      .map((personality) => ({
        userId: `builtin:${personality.id}`,
        agent: {
          id: personality.id,
          userId: `builtin:${personality.id}`,
          name: personality.name,
          avatar: personality.avatar,
          strategy: {} as AgentConfigV2["strategy"],
          createdAt: 0,
          updatedAt: 0,
        },
        enteredAt: 0,
        autoRequeue: false,
      }));
  }

  private cashSnapshots() {
    return [...this.tables.values()]
      .filter((table) => table.config.mode === "cash" && table.getStatus() !== "finished")
      .map((table) => ({
        id: table.id,
        seats: table.getSeats().flatMap((seat) => seat.agent ? [{
          agentId: seat.agent.id,
          kind: seat.agent.type === "builtin" ? "preset" as const : "user" as const,
          userId: seat.agent.userId,
        }] : []),
      }));
  }

  private findEntry(agent: WaitingAgent, waiting: MatchEntry[], idlePresets: MatchEntry[]): MatchEntry | undefined {
    return [...waiting, ...idlePresets].find((entry) => entry.agent.id === agent.agentId);
  }

  private openCashTable(sit: WaitingAgent[], waiting: MatchEntry[], idlePresets: MatchEntry[]): TableInstance {
    const id = `table-${randomUUID()}`;
    const table = new TableInstance(id, { ...CASH_CONFIG, name: randomCasinoName() });
    const spectator = sit.every((agent) => agent.kind === "preset");
    table.markSpectator(spectator);
    this.tables.set(id, table);
    if (spectator) this.showcaseTableId = id;
    this.seatAgents(table, sit, waiting, idlePresets, spectator);
    return table;
  }

  private applySeatMove(
    table: TableInstance,
    move: { sit: WaitingAgent[]; standAgentIds: string[] },
    waiting: MatchEntry[],
    idlePresets: MatchEntry[],
  ): void {
    for (const agentId of move.standAgentIds) {
      if (!table.standUp(agentId)) return;
    }
    const becomingSeason = table.isSpectator() && move.sit.some((agent) => agent.kind === "user");
    if (becomingSeason) {
      table.markSpectator(false);
      if (this.showcaseTableId === table.id) this.showcaseTableId = null;
      for (const seat of table.getSeats()) {
        if (!seat.agent) continue;
        this.fundSeasonSeat(table, seat.agent.id, seat.agent.userId ?? `builtin:${seat.agent.id}`, seat.agent.name);
      }
    }
    this.seatAgents(table, move.sit, waiting, idlePresets, table.isSpectator());
    if (table.getOccupiedCount() < 2) {
      table.stop();
      this.tables.delete(table.id);
    }
  }

  private seatAgents(
    table: TableInstance,
    sit: WaitingAgent[],
    waiting: MatchEntry[],
    idlePresets: MatchEntry[],
    spectator: boolean,
  ): void {
    const frozen = this.agentV2ConfigsForTable.get(table.id) ?? new Map<string, AgentConfigV2>();
    for (const agent of sit) {
      const entry = this.findEntry(agent, waiting, idlePresets);
      if (!entry) throw new Error(`Missing cash entry for ${agent.agentId}`);
      if (entry.userId.startsWith("builtin:") && this.isAgentSeated(entry.agent.id)) {
        throw new Error(`Preset Agent ${entry.agent.id} is already seated at another table`);
      }
      const frozenAgent = cloneAgentConfig(entry.agent);
      const seated = agent.kind === "preset"
        ? table.sitBuiltin(frozenAgent.id, frozenAgent.strategyVersion)
        : table.sit(frozenAgent, frozenAgent.executionMode === "verified_package" ? "verified_package" : "remote_agent", frozenAgent.strategyVersion);
      if (!seated) throw new Error(`Unable to seat cash Agent ${frozenAgent.id}`);
      if (!spectator) this.fundSeasonSeat(table, frozenAgent.id, entry.userId, frozenAgent.name);
      else table.fund(frozenAgent.id, CASH_CONFIG.startingChips);
      frozen.set(entry.userId, frozenAgent);
    }
    this.agentV2ConfigsForTable.set(table.id, frozen);
  }

  private fundSeasonSeat(table: TableInstance, agentId: string, userId: string, name: string): void {
    const kind = userId.startsWith("builtin:") ? "preset" : "user";
    const existing = this.seasonStore?.getOrCreate(agentId, name, kind)
      ?? createSeasonEntry("season-current", agentId, name, kind);
    if (existing.tableStack > 0) {
      table.standUp(agentId);
      return;
    }
    const bought = buyIn(existing);
    if (!bought.ok) {
      table.standUp(agentId);
      return;
    }
    table.fund(agentId, bought.entry.tableStack);
    table.attachSeason(bought.entry);
    this.seasonStore?.save(bought.entry);
  }

  private toTableInfo(table: TableInstance): TableInfo {
    return {
      id: table.id,
      name: table.config.name,
      config: table.config,
      playerCount: table.getOccupiedCount(),
      handNumber: table.getHandNumber(),
      status: table.getStatus(),
      seats: table.getSeats(),
      spectator: table.isSpectator(),
    };
  }

  getAgentV2Configs(tableId: string): Map<string, AgentConfigV2> | undefined {
    return this.agentV2ConfigsForTable.get(tableId);
  }

  removeTable(id: string): void {
    const table = this.tables.get(id);
    if (table) {
      table.stop();
      this.tables.delete(id);
    }
    this.agentV2ConfigsForTable.delete(id);
  }
}

function cloneAgentConfig(agent: AgentConfigV2): AgentConfigV2 {
  return JSON.parse(JSON.stringify(agent)) as AgentConfigV2;
}

function toWaitingUser(entry: MatchEntry): WaitingAgent {
  return {
    userId: entry.userId,
    agentId: entry.agent.id,
    enteredAt: entry.enteredAt,
    kind: "user",
  };
}

function toWaitingPreset(entry: MatchEntry): WaitingAgent {
  return {
    userId: entry.userId,
    agentId: entry.agent.id,
    enteredAt: entry.enteredAt,
    kind: "preset",
  };
}
