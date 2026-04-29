import type { TableConfig, TableInfo, AgentConfig } from "@cybercasino/shared";
import { TableInstance } from "./table-instance";

let nextId = 1;

export class TableManager {
  private tables = new Map<string, TableInstance>();
  private agentConfigsForTable = new Map<string, Map<string, AgentConfig>>();

  createTable(config: TableConfig, creatorUserId?: string, autoStart = false): TableInstance {
    const id = `table-${nextId++}`;
    const table = new TableInstance(id, config, creatorUserId, autoStart);
    this.tables.set(id, table);
    return table;
  }

  getTable(id: string): TableInstance | undefined {
    return this.tables.get(id);
  }

  hasActiveTable(): boolean {
    return [...this.tables.values()].some(
      (t) => t.getStatus() === "waiting" || t.getStatus() === "playing"
    );
  }

  listTables(): TableInfo[] {
    return [...this.tables.values()].map((t) => ({
      id: t.id,
      name: t.config.name,
      config: t.config,
      playerCount: t.getOccupiedCount(),
      handNumber: t.getHandNumber(),
      status: t.getStatus(),
      seats: t.getSeats(),
      creatorUserId: t.creatorUserId,
    }));
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
