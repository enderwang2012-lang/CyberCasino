import { describe, expect, it } from "bun:test";
import type { AgentConfigV2, MatchmakingState } from "@cybercasino/shared";
import { MatchmakingController, type MatchmakingTable } from "./matchmaking-controller";
import { MatchmakingService } from "./matchmaking-service";
import type { TableInstance } from "./table-instance";
import { TableManager } from "./table-manager";

function agent(index: number): AgentConfigV2 {
  return {
    id: `acceptance-agent-${index}`,
    userId: `acceptance-user-${index}`,
    name: `Acceptance Agent ${index}`,
    avatar: "🤖",
    strategy: {} as AgentConfigV2["strategy"],
    executionMode: "verified_package",
    strategyVersion: index,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("automatic matchmaking acceptance", () => {
  it("forms one six-Agent table and requeues every opted-in Agent", () => {
    const tableManager = new TableManager();
    const service = new MatchmakingService();
    const configs = new Map(Array.from({ length: 6 }, (_, index) => {
      const config = agent(index + 1);
      return [config.userId, config] as const;
    }));
    const tables: TableInstance[] = [];
    const started: string[] = [];
    const states = new Map<string, MatchmakingState>();
    const controller = new MatchmakingController({
      service,
      getAgent: (userId) => configs.get(userId),
      isAgentPlaying: (agentId) => tableManager.isAgentPlaying(agentId),
      createTable: (entries) => {
        const table = tableManager.createMatchedTable(entries);
        tables.push(table);
        return table;
      },
      removeTable: (tableId) => tableManager.removeTable(tableId),
      startTable: (table) => started.push(table.id),
      emitState: (userId, state) => states.set(userId, state),
      emitMatched: () => {},
      emitError: (userId, error) => { throw new Error(`${userId}:${error.code}`); },
    });

    for (const userId of configs.keys()) controller.join(userId);

    expect(tables).toHaveLength(1);
    expect(started).toEqual([tables[0].id]);
    expect(tables[0].getOccupiedCount()).toBe(6);
    expect(tables[0].getSeats().map((seat) => seat.agent?.id)).toEqual([
      "acceptance-agent-1",
      "acceptance-agent-2",
      "acceptance-agent-3",
      "acceptance-agent-4",
      "acceptance-agent-5",
      "acceptance-agent-6",
    ]);
    expect(tableManager.getAgentV2Configs(tables[0].id)?.get("acceptance-user-1")).toEqual(
      configs.get("acceptance-user-1"),
    );

    controller.completeTable(tables[0].id);

    expect(tables).toHaveLength(2);
    expect(started).toEqual([tables[0].id, tables[1].id]);
    expect(states.get("acceptance-user-1")).toMatchObject({
      status: "playing",
      tableId: tables[1].id,
      autoRequeue: true,
    });
  });

  it("keeps the current match running but excludes a user from the next queue", () => {
    const tableManager = new TableManager();
    const service = new MatchmakingService();
    const configs = new Map(Array.from({ length: 6 }, (_, index) => {
      const config = agent(index + 1);
      return [config.userId, config] as const;
    }));
    const tables: MatchmakingTable[] = [];
    const controller = new MatchmakingController({
      service,
      getAgent: (userId) => configs.get(userId),
      isAgentPlaying: (agentId) => tableManager.isAgentPlaying(agentId),
      createTable: (entries) => {
        const table = tableManager.createMatchedTable(entries);
        tables.push(table);
        return table;
      },
      removeTable: (tableId) => tableManager.removeTable(tableId),
      startTable: () => {},
      emitState: () => {},
      emitMatched: () => {},
      emitError: (userId, error) => { throw new Error(`${userId}:${error.code}`); },
    });

    for (const userId of configs.keys()) controller.join(userId);
    controller.leave("acceptance-user-1");
    controller.completeTable(tables[0].id);

    expect(tables).toHaveLength(1);
    expect(service.getQueueSnapshot().map((entry) => entry.userId)).toEqual([
      "acceptance-user-2",
      "acceptance-user-3",
      "acceptance-user-4",
      "acceptance-user-5",
      "acceptance-user-6",
    ]);
  });
});
