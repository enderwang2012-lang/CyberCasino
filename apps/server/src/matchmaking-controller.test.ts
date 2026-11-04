import { describe, expect, it, spyOn } from "bun:test";
import type { AgentConfigV2, MatchmakingState } from "@cybercasino/shared";
import { MatchmakingService, type MatchEntry } from "./matchmaking-service";
import {
  MatchmakingController,
  type MatchmakingTable,
} from "./matchmaking-controller";

function agent(index: number): AgentConfigV2 {
  return {
    id: `controller-agent-${index}`,
    userId: `controller-user-${index}`,
    name: `Controller Agent ${index}`,
    avatar: "🤖",
    strategy: {} as AgentConfigV2["strategy"],
    executionMode: "verified_package",
    strategyVersion: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

function builtinEntries(): MatchEntry[] {
  return Array.from({ length: 6 }, (_, index) => ({
    userId: `builtin:personality-${index + 1}`,
    agent: {
      ...agent(index + 1),
      id: `personality-${index + 1}`,
      userId: `builtin:personality-${index + 1}`,
      name: `Preset Agent ${index + 1}`,
    },
    enteredAt: 1,
    autoRequeue: false,
  }));
}

function createController(getFillEntries?: () => MatchEntry[]) {
  const agents = new Map(Array.from({ length: 12 }, (_, index) => {
    const config = agent(index + 1);
    return [config.userId, config] as const;
  }));
  const service = new MatchmakingService();
  const created: MatchmakingTable[] = [];
  const started: Array<{ table: MatchmakingTable; entries: MatchEntry[] }> = [];
  const states: Array<{ userId: string; state: MatchmakingState }> = [];
  const matched: Array<{ userId: string; tableId: string }> = [];
  const errors: Array<{ userId: string; code: string }> = [];
  const controller = new MatchmakingController({
    service,
    getAgent: (userId, agentId) => {
      const config = agents.get(userId);
      return config && (!agentId || config.id === agentId) ? config : undefined;
    },
    isAgentPlaying: () => false,
    getFillEntries,
    createTable: (entries) => {
      const table = { id: `controller-table-${created.length + 1}` };
      created.push(table);
      expect(entries).toHaveLength(6);
      return table;
    },
    removeTable: () => {},
    startTable: (table, entries) => {
      started.push({ table, entries });
    },
    emitState: (userId, state) => states.push({ userId, state }),
    emitMatched: (userId, tableId) => matched.push({ userId, tableId }),
    emitError: (userId, error) => errors.push({ userId, code: error.code }),
  });

  return { agents, service, controller, created, started, states, matched, errors };
}

describe("MatchmakingController", () => {
  it("rejects unregistered users and missing Agents with stable errors", () => {
    const { controller, errors } = createController();

    controller.join(undefined);
    controller.join("unknown-user");

    expect(errors).toEqual([
      { userId: "", code: "not_registered" },
      { userId: "unknown-user", code: "agent_not_found" },
    ]);
  });

  it("creates one table and notifies six users when the queue fills", () => {
    const { controller, created, started, matched } = createController();

    for (let index = 1; index <= 6; index++) {
      controller.join(`controller-user-${index}`);
    }

    expect(created).toHaveLength(1);
    expect(started).toHaveLength(1);
    expect(started[0].entries.map((entry) => entry.agent.id)).toEqual([
      "controller-agent-1",
      "controller-agent-2",
      "controller-agent-3",
      "controller-agent-4",
      "controller-agent-5",
      "controller-agent-6",
    ]);
    expect(matched).toHaveLength(6);
    expect(matched.every((item) => item.tableId === "controller-table-1")).toBe(true);
  });

  it("rejects a duplicate queued Agent and removes a queued user on leave", () => {
    const { controller, errors, service } = createController();

    controller.join("controller-user-1");
    controller.join("controller-user-1");
    controller.leave("controller-user-1");

    expect(errors).toEqual([{ userId: "controller-user-1", code: "already_queued" }]);
    expect(service.getQueueSnapshot()).toHaveLength(0);
  });

  it("starts the next table when the completed match requeues six opted-in Agents", () => {
    const { controller, created, started } = createController();

    for (let index = 1; index <= 6; index++) {
      controller.join(`controller-user-${index}`);
    }
    controller.completeTable("controller-table-1");

    expect(created).toHaveLength(2);
    expect(started).toHaveLength(2);
    expect(started[1].table.id).toBe("controller-table-2");
  });

  it.each([0, 2])("does not fill a queue containing %i presets without real user demand", (presetCount) => {
    const service = new MatchmakingService();
    const created: MatchmakingTable[] = [];
    const controller = new MatchmakingController({
      service,
      getAgent: () => undefined,
      isAgentPlaying: () => false,
      getFillEntries: builtinEntries,
      createTable: (entries) => {
        const table = { id: `preset-only-table-${created.length + 1}` };
        created.push(table);
        expect(entries).toHaveLength(6);
        return table;
      },
      removeTable: () => {},
      startTable: () => {},
      emitState: () => {},
      emitMatched: () => {},
      emitError: (userId, error) => { throw new Error(`${userId}:${error.code}`); },
    });

    for (const entry of builtinEntries().slice(0, presetCount)) {
      service.join(entry);
    }
    controller.completeTable("missing-table");
    controller.completeTable("missing-table");

    expect(created).toHaveLength(0);
    expect(service.getQueueSnapshot()).toHaveLength(0);
  });

  it("reuses preset Agents that are already playing so concurrent users are not starved", () => {
    const service = new MatchmakingService();
    const users = [agent(1), agent(2)];
    const playing = new Set<string>();
    const created: Array<{ id: string; entries: MatchEntry[] }> = [];
    const controller = new MatchmakingController({
      service,
      getAgent: (userId) => users.find((config) => config.userId === userId),
      isAgentPlaying: (agentId) => playing.has(agentId),
      getFillEntries: () => builtinEntries(),
      createTable: (entries) => {
        const table = { id: `concurrent-table-${created.length + 1}`, entries };
        created.push(table);
        for (const entry of entries) playing.add(entry.agent.id);
        return table;
      },
      removeTable: () => {},
      startTable: () => {},
      emitState: () => {},
      emitMatched: () => {},
      emitError: (userId, error) => { throw new Error(`${userId}:${error.code}`); },
    });

    for (const config of users) controller.join(config.userId);

    expect(created).toHaveLength(2);
    for (const [index, table] of created.entries()) {
      expect(table.entries.map((entry) => entry.userId)).toContain(users[index].userId);
      expect(table.entries.filter((entry) => entry.userId.startsWith("builtin:"))).toHaveLength(5);
      expect(service.getState(users[index].userId)).toMatchObject({ status: "playing", tableId: table.id });
    }
  });

  it("fills a real Agent with five formal built-in Agents without requeueing the built-ins", () => {
    const service = new MatchmakingService();
    const realAgent = agent(1);
    const presetEntries = builtinEntries().slice(0, 5);
    const created: MatchmakingTable[] = [];
    const started: Array<{ table: MatchmakingTable; entries: MatchEntry[] }> = [];
    const controller = new MatchmakingController({
      service,
      getAgent: (userId) => userId === realAgent.userId ? realAgent : undefined,
      isAgentPlaying: () => false,
      getFillEntries: () => presetEntries,
      createTable: (entries) => {
        const table = { id: `builtin-table-${created.length + 1}` };
        created.push(table);
        expect(entries).toHaveLength(6);
        return table;
      },
      removeTable: () => {},
      startTable: (table, entries) => started.push({ table, entries }),
      emitState: () => {},
      emitMatched: () => {},
      emitError: (userId, error) => { throw new Error(`${userId}:${error.code}`); },
    });

    controller.join(realAgent.userId);

    expect(created).toHaveLength(1);
    expect(started[0].entries.map((entry) => entry.userId)).toEqual([
      realAgent.userId,
      "builtin:personality-1",
      "builtin:personality-2",
      "builtin:personality-3",
      "builtin:personality-4",
      "builtin:personality-5",
    ]);
    expect(started[0].entries.slice(1).every((entry) => entry.autoRequeue === false)).toBe(true);

    controller.completeTable(created[0].id);

    expect(created).toHaveLength(2);
    expect(started[1].entries.map((entry) => entry.userId)).toEqual([
      realAgent.userId,
      "builtin:personality-1",
      "builtin:personality-2",
      "builtin:personality-3",
      "builtin:personality-4",
      "builtin:personality-5",
    ]);
    expect(service.getState(realAgent.userId)).toMatchObject({
      status: "playing",
      tableId: created[1].id,
      autoRequeue: true,
    });
    expect(started[1].entries.slice(1).every((entry) => entry.autoRequeue === false)).toBe(true);
    expect(service.getQueueSnapshot()).toHaveLength(0);
  });

  it.each([5, 6])("does not requeue a departed user or leave a preset-only queue with %i available presets", (presetCount) => {
    const service = new MatchmakingService();
    const realAgent = agent(1);
    const presetEntries = builtinEntries().slice(0, presetCount);
    const created: MatchmakingTable[] = [];
    const controller = new MatchmakingController({
      service,
      getAgent: (userId) => userId === realAgent.userId ? realAgent : undefined,
      isAgentPlaying: () => false,
      getFillEntries: () => presetEntries,
      createTable: (entries) => {
        const table = { id: `leave-table-${created.length + 1}` };
        created.push(table);
        expect(entries).toHaveLength(6);
        return table;
      },
      removeTable: () => {},
      startTable: () => {},
      emitState: () => {},
      emitMatched: () => {},
      emitError: (userId, error) => { throw new Error(`${userId}:${error.code}`); },
    });

    controller.join(realAgent.userId);
    controller.leave(realAgent.userId);
    expect(service.getState(realAgent.userId)).toMatchObject({
      status: "playing",
      tableId: created[0].id,
      autoRequeue: false,
    });
    controller.completeTable(created[0].id);
    controller.completeTable(created[0].id);

    expect(created).toHaveLength(1);
    expect(service.getQueueSnapshot()).toHaveLength(0);
    expect(service.getState(realAgent.userId)).toMatchObject({
      status: "idle",
      autoRequeue: false,
    });
  });

  it("keeps presets while another user is queued and clears them when the last user leaves", () => {
    const { controller, service, created, states } = createController(
      () => builtinEntries().slice(0, 2),
    );
    controller.join("controller-user-1");
    controller.join("controller-user-2");

    controller.leave("controller-user-1");

    expect(service.getQueueSnapshot().map((entry) => entry.userId)).toEqual([
      "builtin:personality-1",
      "builtin:personality-2",
      "controller-user-2",
    ]);

    controller.leave("controller-user-2");

    expect(service.getQueueSnapshot()).toHaveLength(0);
    expect(created).toHaveLength(0);
    expect(states.filter((item) => item.userId === "controller-user-2").at(-1)?.state).toMatchObject({
      status: "idle",
      queueSize: 0,
      autoRequeue: false,
    });
  });

  it.each(["create", "start"] as const)("clears a failed batch, emits idle before error, and allows retry after synchronous %s failure", (failureStage) => {
    const service = new MatchmakingService();
    const realAgents = [agent(1), agent(2)];
    const presets = builtinEntries().slice(0, 4);
    const participants = [...realAgents.map((config) => config.userId), ...presets.map((entry) => entry.userId)];
    const tables = new Map<string, MatchEntry[]>();
    const removed: string[] = [];
    const started: MatchEntry[][] = [];
    const events: Array<
      | { type: "state"; userId: string; state: MatchmakingState }
      | { type: "error"; userId: string; code: string }
    > = [];
    let shouldFail = true;
    let createAttempts = 0;
    const failure = new Error(`synchronous ${failureStage} failure`);
    const logError = spyOn(console, "error").mockImplementation(() => {});
    const controller = new MatchmakingController({
      service,
      getAgent: (userId) => realAgents.find((config) => config.userId === userId),
      isAgentPlaying: () => false,
      getFillEntries: () => presets,
      createTable: (entries) => {
        createAttempts++;
        if (shouldFail && failureStage === "create") throw failure;
        const table = { id: `failure-table-${createAttempts}` };
        tables.set(table.id, entries);
        return table;
      },
      removeTable: (tableId) => {
        removed.push(tableId);
        tables.delete(tableId);
      },
      startTable: (_table, entries) => {
        if (shouldFail && failureStage === "start") throw failure;
        started.push(entries);
      },
      emitState: (userId, state) => events.push({ type: "state", userId, state }),
      emitMatched: () => {},
      emitError: (userId, error) => events.push({ type: "error", userId, code: error.code }),
    });

    try {
      for (const config of realAgents) controller.join(config.userId);

      expect(createAttempts).toBe(1);
      expect(tables.size).toBe(0);
      expect(removed).toEqual(failureStage === "create" ? [] : ["failure-table-1"]);
      expect(started).toHaveLength(0);
      expect(service.getQueueSnapshot()).toEqual([]);
      expect(service.getTrackedUserIds()).toEqual([]);
      for (const userId of participants) {
        expect(service.getState(userId)).toMatchObject({
          status: "idle",
          queueSize: 0,
          autoRequeue: false,
        });
        expect(service.getState(userId).tableId).toBeUndefined();
      }
      for (const config of realAgents) {
        expect(events.filter((event) => event.userId === config.userId).slice(-2)).toEqual([
          {
            type: "state",
            userId: config.userId,
            state: {
              queue: "ranked-default",
              status: "idle",
              queueSize: 0,
              requiredPlayers: 6,
              autoRequeue: false,
            },
          },
          { type: "error", userId: config.userId, code: "match_start_failed" },
        ]);
      }
      for (const entry of presets) {
        expect(events.filter((event) => event.userId === entry.userId).at(-1)).toEqual({
          type: "state",
          userId: entry.userId,
          state: {
            queue: "ranked-default",
            status: "idle",
            queueSize: 0,
            requiredPlayers: 6,
            autoRequeue: false,
          },
        });
      }
      expect(events.filter((event) => event.type === "error")).toHaveLength(2);

      controller.completeTable("failure-table-1");
      expect(createAttempts).toBe(1);
      expect(service.getQueueSnapshot()).toEqual([]);

      shouldFail = false;
      for (const config of realAgents) controller.join(config.userId);

      expect(createAttempts).toBe(2);
      expect(tables.size).toBe(1);
      expect(started).toHaveLength(1);
      expect(started[0].map((entry) => entry.userId).sort()).toEqual([...participants].sort());
      for (const config of realAgents) {
        expect(service.getState(config.userId)).toMatchObject({
          status: "playing",
          tableId: "failure-table-2",
        });
      }
      for (const entry of presets) {
        expect(service.getState(entry.userId).status).toBe("idle");
      }
      expect(events.filter((event) => event.type === "error")).toHaveLength(2);
    } finally {
      logError.mockRestore();
    }
  });
});
