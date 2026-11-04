import type { TableConfig, TableInfo, AgentConfigV2 } from "@cybercasino/shared";
import { randomUUID } from "node:crypto";
import { TableInstance } from "./table-instance";
import type { GameHistoryStore } from "./stores";
import type { MatchEntry } from "./matchmaking-service";

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

export class TableManager {
  private tables = new Map<string, TableInstance>();
  private agentV2ConfigsForTable = new Map<string, Map<string, AgentConfigV2>>();
  private finishedTables: TableInfo[] = [];
  private presetTableId: string | null = null;
  private historyStore: GameHistoryStore | null = null;

  setHistoryStore(store: GameHistoryStore): void {
    this.historyStore = store;
  }

  loadPersistedHistory(): void {
    if (!this.historyStore) return;
    const entries = this.historyStore.getAll();
    this.finishedTables = entries.map((e) => e.info);
  }

  ensurePresetTable(): TableInstance {
    if (this.presetTableId) {
      const existing = this.tables.get(this.presetTableId);
      if (existing && existing.getStatus() === "waiting") {
        return existing;
      }
    }
    const id = `table-${randomUUID()}`;
    const config = { ...DEFAULT_CONFIG, name: randomCasinoName() };
    const table = new TableInstance(id, config);
    this.tables.set(id, table);
    this.presetTableId = id;
    return table;
  }

  createMatchedTable(
    entries: MatchEntry[],
    runOptions: Pick<TableConfig, "handLimit" | "interHandDelayMs" | "actionDelayMs" | "commentaryMode"> = {},
  ): TableInstance {
    if (entries.length !== DEFAULT_CONFIG.maxPlayers) {
      throw new Error(`Automatic ranked tables require ${DEFAULT_CONFIG.maxPlayers} Agents`);
    }

    const id = `table-${randomUUID()}`;
    const config = { ...DEFAULT_CONFIG, ...runOptions, name: randomCasinoName() };
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
    const result = this.presetTableId
      ? activeTables.sort((a, b) => (a.id === this.presetTableId ? -1 : b.id === this.presetTableId ? 1 : 0))
      : activeTables;

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

  async archiveFinishedTable(tableId: string): Promise<boolean> {
    const table = this.tables.get(tableId);
    if (!table || table.getStatus() !== "finished") return false;

    const info = this.toTableInfo(table);
    info.finishedAt = Date.now();

    try {
      if (this.historyStore) {
        const replayData = table.getReplayData();
        await this.historyStore.saveCompletedMatch(info, replayData, table.getAuditRecords());
      }
    } catch (error) {
      this.removeTable(tableId);
      throw error;
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

  private toTableInfo(table: TableInstance): TableInfo {
    return {
      id: table.id,
      name: table.config.name,
      config: table.config,
      playerCount: table.getOccupiedCount(),
      handNumber: table.getHandNumber(),
      status: table.getStatus(),
      seats: table.getSeats(),
    };
  }

  setAgentV2Config(tableId: string, userId: string, config: AgentConfigV2): void {
    let configs = this.agentV2ConfigsForTable.get(tableId);
    if (!configs) {
      configs = new Map();
      this.agentV2ConfigsForTable.set(tableId, configs);
    }
    configs.set(userId, config);
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
