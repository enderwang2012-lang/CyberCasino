import { describe, expect, it } from "bun:test";
import type { AgentConfigV2, MatchmakingState } from "@cybercasino/shared";
import {
  MatchmakingService,
  type MatchEntry,
} from "./matchmaking-service";

function agent(index: number): AgentConfigV2 {
  return {
    id: `agent-${index}`,
    userId: `user-${index}`,
    name: `Agent ${index}`,
    avatar: "🤖",
    strategy: {
      preflop: {},
      postflop: [],
    } as unknown as AgentConfigV2["strategy"],
    executionMode: "verified_package",
    strategyVersion: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

function entry(index: number, enteredAt = index): MatchEntry {
  return {
    userId: `user-${index}`,
    agent: agent(index),
    enteredAt,
    autoRequeue: true,
  };
}

describe("matchmaking contract", () => {
  it("describes a six-player default ranked queue", () => {
    const state: MatchmakingState = {
      queue: "ranked-default",
      status: "queued",
      agentId: "agent-1",
      position: 2,
      queueSize: 5,
      requiredPlayers: 6,
      enteredAt: 123,
      autoRequeue: true,
    };

    expect(state.requiredPlayers).toBe(6);
    expect(state.queue).toBe("ranked-default");
  });
});

describe("MatchmakingService", () => {
  it("claims exactly six entries when the queue reaches the table size", () => {
    const service = new MatchmakingService({ requiredPlayers: 6, now: () => 1000 });

    for (let index = 1; index <= 5; index++) {
      expect(service.join(entry(index))).toMatchObject({
        accepted: true,
        batch: undefined,
      });
    }

    const sixth = service.join(entry(6));

    expect(sixth.accepted).toBe(true);
    if (!sixth.accepted) throw new Error("expected sixth entry to be accepted");
    expect(sixth.batch?.entries.map((item) => item.agent.id)).toEqual([
      "agent-1",
      "agent-2",
      "agent-3",
      "agent-4",
      "agent-5",
      "agent-6",
    ]);
    expect(service.getQueueSnapshot()).toHaveLength(0);
  });

  it("rejects duplicate users and duplicate agents without changing the queue", () => {
    const service = new MatchmakingService();

    expect(service.join(entry(1)).accepted).toBe(true);
    expect(service.join({
      ...entry(2),
      userId: "user-1",
      agent: { ...agent(2), userId: "user-1" },
    })).toMatchObject({
      accepted: false,
      code: "already_queued",
    });
    expect(service.join({ ...entry(3), agent: { ...agent(1), userId: "user-3" } })).toMatchObject({
      accepted: false,
      code: "already_queued",
    });
    expect(service.getQueueSnapshot()).toHaveLength(1);
  });

  it("reports queue position and removes a queued entry", () => {
    const service = new MatchmakingService({ now: () => 2000 });
    service.join(entry(1));
    service.join(entry(2));

    expect(service.getState("user-2")).toMatchObject({
      status: "queued",
      agentId: "agent-2",
      position: 2,
      queueSize: 2,
      requiredPlayers: 6,
      enteredAt: 2,
      autoRequeue: true,
    });

    expect(service.leave("user-1")).toMatchObject({ removed: true });
    expect(service.getState("user-2")).toMatchObject({
      position: 1,
      queueSize: 1,
    });
    expect(service.getState("user-1")).toMatchObject({
      status: "idle",
      queueSize: 1,
      autoRequeue: false,
    });
  });

  it("keeps active participation but disables automatic requeue on leave", () => {
    const service = new MatchmakingService();
    let batchId = "";
    for (let index = 1; index <= 6; index++) {
      const result = service.join(entry(index));
      if (result.accepted && result.batch) batchId = result.batch.batchId;
    }
    if (!batchId) throw new Error("expected a full batch");
    service.startBatch(batchId, "table-1");

    expect(service.getState("user-1")).toMatchObject({
      status: "playing",
      tableId: "table-1",
      autoRequeue: true,
    });
    expect(service.leave("user-1")).toMatchObject({
      removed: false,
      state: {
        status: "playing",
        tableId: "table-1",
        autoRequeue: false,
      },
    });
  });

  it("requeues opted-in players after completion and preserves entry order", () => {
    const service = new MatchmakingService();
    let batchId = "";
    for (let index = 1; index <= 6; index++) {
      const result = service.join(entry(index));
      if (result.accepted && result.batch) batchId = result.batch.batchId;
    }
    if (!batchId) {
      throw new Error("expected a full batch");
    }
    service.startBatch(batchId, "table-1");
    service.leave("user-2");

    const completed = service.completeTable("table-1");

    expect(completed.requeued.map((item) => item.userId)).toEqual([
      "user-1",
      "user-3",
      "user-4",
      "user-5",
      "user-6",
    ]);
    expect(service.getQueueSnapshot().map((item) => item.userId)).toEqual([
      "user-1",
      "user-3",
      "user-4",
      "user-5",
      "user-6",
    ]);
    expect(service.getState("user-2")).toMatchObject({
      status: "idle",
      autoRequeue: false,
    });
  });

  it("refreshes pending entries from the latest Agent config before table creation", () => {
    const service = new MatchmakingService();
    let batchId = "";
    for (let index = 1; index <= 6; index++) {
      const result = service.join(entry(index));
      if (result.accepted && result.batch) batchId = result.batch.batchId;
    }

    const updated = { ...agent(1), strategyVersion: 2, updatedAt: 2 };
    const refreshed = service.refreshBatch(batchId, (item) =>
      item.userId === "user-1" ? updated : undefined);

    expect(refreshed?.entries.find((item) => item.userId === "user-1")?.agent).toMatchObject({
      id: "agent-1",
      strategyVersion: 2,
      updatedAt: 2,
    });
  });
});
