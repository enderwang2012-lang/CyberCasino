import type { TableConfig, TableInfo, AgentConfigV2 } from "@cybercasino/shared";
import { TableInstance } from "./table-instance";
import type { GameHistoryStore } from "./stores";

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

let nextId = 1;

export class TableManager {
  private tables = new Map<string, TableInstance>();
  private agentV2ConfigsForTable = new Map<string, Map<string, AgentConfigV2>>();
  private finishedTables: TableInfo[] = [];
  private presetTableId: string | null = null;
  private historyStore: GameHistoryStore | null = null;

  setHistoryStore(store: GameHistoryStore): void {
    this.historyStore = store;
  }

  /**
   * 必须在 ensurePresetTable 之前调用，否则新表 ID 可能与归档历史表碰撞。
   */
  loadPersistedHistory(): void {
    if (!this.historyStore) return;
    const entries = this.historyStore.getAll();
    this.finishedTables = entries.map((e) => e.info);

    // 防止重启后 table ID 与归档历史表碰撞
    let maxId = 0;
    for (const entry of entries) {
      const match = entry.info.id.match(/^table-(\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxId) maxId = num;
      }
    }
    if (maxId >= nextId) {
      nextId = maxId + 1;
      console.log(`[table-manager] nextId bumped to ${nextId} from persisted history`);
    }
  }

  ensurePresetTable(): TableInstance {
    if (this.presetTableId) {
      const existing = this.tables.get(this.presetTableId);
      if (existing && existing.getStatus() === "waiting") {
        return existing;
      }
    }
    // 跳过已归档的 ID，防止重启后新表和旧历史表 ID 碰撞
    let id: string;
    do {
      id = `table-${nextId++}`;
    } while (this.finishedTables.some((t) => t.id === id));
    const config = { ...DEFAULT_CONFIG, name: randomCasinoName() };
    const table = new TableInstance(id, config);
    this.tables.set(id, table);
    this.presetTableId = id;
    return table;
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

    if (this.historyStore) {
      const replayData = table.getReplayData();
      await this.historyStore.saveCompletedMatch(info, replayData, table.getAuditRecords());
    }

    this.finishedTables.unshift(info);
    if (this.finishedTables.length > 50) {
      this.finishedTables.pop();
    }
    this.tables.delete(tableId);
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
      this.agentV2ConfigsForTable.delete(id);
    }
  }
}
