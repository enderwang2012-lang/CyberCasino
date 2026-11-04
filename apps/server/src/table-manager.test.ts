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
      expect(showcase?.config.mode).toBe("cash");
      expect(showcase?.isSpectator()).toBe(true);
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

    expect(table.config.mode).toBe("cash");
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

  it("seats one waiting user with idle presets immediately", () => {
    const manager = new TableManager();
    const user = entries()[0];
    const presets = manager["idlePresetEntries"]().slice(0, 5);
    const result = manager.syncCashTables([user], presets);

    expect(result.stillWaiting).toEqual([]);
    expect(result.opened).toHaveLength(1);
    expect(result.opened[0].isSpectator()).toBe(false);
    expect(result.opened[0].getOccupiedCount()).toBe(6);
    expect(result.opened[0].getSeats().some((seat) => seat.agent?.id === user.agent.id)).toBe(true);
    manager.removeTable(result.opened[0].id);
  });

  it("replaces one preset when a second user is waiting", () => {
    const manager = new TableManager();
    const [first, second] = entries();
    const presets = manager["idlePresetEntries"]();
    const opened = manager.syncCashTables([first], presets.slice(0, 5)).opened[0];
    const result = manager.syncCashTables([second], manager["idlePresetEntries"]());

    expect(result.opened).toEqual([]);
    expect(result.stillWaiting).toEqual([]);
    expect(opened.getSeats().filter((seat) => seat.agent?.type === "custom")).toHaveLength(2);
    expect(opened.getOccupiedCount()).toBe(6);
    manager.removeTable(opened.id);
  });

  it("keeps a seventh user waiting when no preset can join", () => {
    const manager = new TableManager();
    const users = entries();
    const seventh = {
      ...users[0],
      userId: "matched-user-7",
      agent: { ...users[0].agent, id: "matched-agent-7", userId: "matched-user-7" },
      enteredAt: 7,
    };
    const opened = manager.syncCashTables(users, []).opened[0];
    const result = manager.syncCashTables([seventh], []);

    expect(result.opened).toEqual([]);
    expect(result.stillWaiting.map((entry) => entry.userId)).toEqual(["matched-user-7"]);
    expect(opened.getOccupiedCount()).toBe(6);
    manager.removeTable(opened.id);
  });

  it("opens a spectator table and yields a preset when a user arrives", () => {
    const manager = new TableManager();
    const spectator = manager.ensureShowcaseTable();
    if (!spectator) throw new Error("expected a spectator table");
    expect(spectator.isSpectator()).toBe(true);
    expect(spectator.getOccupiedCount()).toBe(6);

    const result = manager.syncCashTables([entries()[0]], []);

    expect(result.stillWaiting).toEqual([]);
    expect(spectator.isSpectator()).toBe(false);
    expect(spectator.getSeats().some((seat) => seat.agent?.id === "matched-agent-1")).toBe(true);
    expect(spectator.getOccupiedCount()).toBe(6);
    manager.removeTable(spectator.id);
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
