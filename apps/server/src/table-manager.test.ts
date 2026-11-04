import { describe, expect, it } from "bun:test";
import type { AgentConfigV2 } from "@cybercasino/shared";
import { MatchmakingService, type MatchEntry } from "./matchmaking-service";
import { TableManager } from "./table-manager";

function agent(index: number): AgentConfigV2 {
  return {
    id: `matched-agent-${index}`,
    userId: `matched-user-${index}`,
    name: `Matched Agent ${index}`,
    avatar: "🤖",
    strategy: {} as AgentConfigV2["strategy"],
    executionMode: index % 2 === 0 ? "verified_package" : "remote_agent",
    strategyVersion: index,
    createdAt: 1,
    updatedAt: 1,
  };
}

function entries(): MatchEntry[] {
  return Array.from({ length: 6 }, (_, index) => {
    const config = agent(index + 1);
    return {
      userId: config.userId,
      agent: config,
      enteredAt: index + 1,
      autoRequeue: true,
    };
  });
}

describe("TableManager automatic matches", () => {
  it.each(["waiting", "playing"] as const)(
    "does not reuse presets from a %s exhibition in a ranked table",
    (status) => {
      const manager = new TableManager();
      const showcase = manager.ensureShowcaseTable()!;
      if (status === "playing") (showcase as any).running = true;
      const matchEntries = entries();
      matchEntries[0] = {
        ...matchEntries[0],
        userId: "builtin:neon",
        agent: { ...matchEntries[0].agent, id: "neon", userId: "builtin:neon" },
      };
      try {
        expect(() => manager.createMatchedTable(matchEntries)).toThrow();
        expect(manager.getActiveTableInfos().map((table) => table.id)).toEqual([showcase.id]);
      } finally {
        for (const table of manager.getActiveTableInfos()) manager.removeTable(table.id);
      }
    },
  );

  it("waits to create an exhibition until ranked presets have finished", () => {
    const manager = new TableManager();
    const matchEntries = entries();
    matchEntries[0] = {
      ...matchEntries[0],
      userId: "builtin:neon",
      agent: { ...matchEntries[0].agent, id: "neon", userId: "builtin:neon" },
    };
    const table = manager.createMatchedTable(matchEntries);
    try {
      expect(manager.ensureShowcaseTable()).toBeUndefined();
      (table as any).handNumber = 1;
      (table as any).emit({ type: "tournament-complete", rankings: [] });
      const showcase = manager.ensureShowcaseTable();
      expect(showcase?.getOccupiedCount()).toBe(6);
      expect(showcase?.config.mode).toBe("exhibition");
      expect(manager.getTable(table.id)?.getStatus()).toBe("finished");
    } finally {
      manager.removeTable(table.id);
      for (const active of manager.getActiveTableInfos()) manager.removeTable(active.id);
    }
  });

  it("creates a ranked table with six frozen custom Agent seats", () => {
    const manager = new TableManager();
    const matchEntries = entries();

    const table = manager.createMatchedTable(matchEntries);

    expect(table.config.mode).toBe("ranked");
    expect(table.getOccupiedCount()).toBe(6);
    expect(table.getSeats().every((seat) => seat.agent?.type === "custom")).toBe(true);
    expect(table.getSeats().map((seat) => seat.agent?.id)).toEqual(
      matchEntries.map((entry) => entry.agent.id),
    );
    expect(manager.getAgentV2Configs(table.id)?.get("matched-user-1")).toEqual(matchEntries[0].agent);
    expect(manager.getActiveTableInfos().some((info) => info.id === table.id)).toBe(true);
  });

  it("does not create a partial table when an entry cannot be seated", () => {
    const manager = new TableManager();
    const duplicate = entries();
    duplicate[5] = { ...duplicate[5], agent: { ...duplicate[5].agent, userId: duplicate[0].userId } };

    expect(() => manager.createMatchedTable(duplicate)).toThrow();
    expect(manager.getActiveTableInfos()).toHaveLength(0);
  });

  it("keeps a preset Agent visibly identified as a formal built-in participant", () => {
    const manager = new TableManager();
    const matchEntries = entries();
    matchEntries[0] = {
      ...matchEntries[0],
      userId: "builtin:neon",
      autoRequeue: false,
      agent: {
        ...matchEntries[0].agent,
        id: "neon",
        userId: "builtin:neon",
        name: "Neon",
      },
    };

    const table = manager.createMatchedTable(matchEntries);

    expect(table.getSeats()[0].agent).toMatchObject({
      id: "neon",
      type: "builtin",
    });
    expect(table.getSeats().slice(1).every((seat) => seat.agent?.type === "custom")).toBe(true);
  });

  it("keeps the existing default queue size at six", () => {
    const service = new MatchmakingService();
    expect(service.getState("unknown")).toMatchObject({
      queue: "ranked-default",
      requiredPlayers: 6,
      status: "idle",
    });
  });
});
