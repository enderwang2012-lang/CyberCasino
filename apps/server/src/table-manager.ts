import type { TableConfig, TableInfo, AgentConfig } from "@cybercasino/shared";
import { TableInstance } from "./table-instance";

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
  smallBlind: 50,
  bigBlind: 100,
  startingChips: 5000,
  maxPlayers: 6,
};

let nextId = 1;

export class TableManager {
  private tables = new Map<string, TableInstance>();
  private agentConfigsForTable = new Map<string, Map<string, AgentConfig>>();
  private finishedTables: TableInfo[] = [];
  private presetTableId: string | null = null;

  ensurePresetTable(): TableInstance {
    if (this.presetTableId) {
      const existing = this.tables.get(this.presetTableId);
      if (existing && existing.getStatus() === "waiting") {
        return existing;
      }
    }
    const id = `table-${nextId++}`;
    const config = { ...DEFAULT_CONFIG, name: randomCasinoName() };
    const table = new TableInstance(id, config);
    this.tables.set(id, table);
    this.presetTableId = id;
    return table;
  }

  getPresetTableId(): string | null {
    return this.presetTableId;
  }

  getTable(id: string): TableInstance | undefined {
    return this.tables.get(id);
  }

  getHomepageTables(): TableInfo[] {
    const result: TableInfo[] = [];

    if (this.presetTableId) {
      const preset = this.tables.get(this.presetTableId);
      if (preset) {
        result.push(this.toTableInfo(preset));
      }
    }

    if (this.finishedTables.length > 0) {
      result.push(this.finishedTables[0]);
    }

    return result;
  }

  getHistoryTables(): TableInfo[] {
    return this.finishedTables;
  }

  archiveFinishedTable(tableId: string): void {
    const table = this.tables.get(tableId);
    if (!table || table.getStatus() !== "finished") return;

    const info = this.toTableInfo(table);
    info.finishedAt = Date.now();
    this.finishedTables.unshift(info);
    if (this.finishedTables.length > 10) {
      this.finishedTables.pop();
    }
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

  setAgentConfig(tableId: string, userId: string, config: AgentConfig): void {
    let configs = this.agentConfigsForTable.get(tableId);
    if (!configs) {
      configs = new Map();
      this.agentConfigsForTable.set(tableId, configs);
    }
    configs.set(userId, config);
  }

  getAgentConfigs(tableId: string): Map<string, AgentConfig> | undefined {
    return this.agentConfigsForTable.get(tableId);
  }

  removeTable(id: string): void {
    const table = this.tables.get(id);
    if (table) {
      table.stop();
      this.tables.delete(id);
      this.agentConfigsForTable.delete(id);
    }
  }
}
