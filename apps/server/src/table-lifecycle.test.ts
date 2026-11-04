import { afterEach, describe, expect, it } from "bun:test";
import type { AgentConfigV2, GameEvent } from "@cybercasino/shared";
import { TableManager } from "./table-manager";
import type { GameHistoryStore } from "./stores";
import type { MatchEntry } from "./matchmaking-service";
import { PERSONALITIES } from "./agents/personalities";

function presetEntries(): MatchEntry[] {
  return PERSONALITIES.slice(0, 6).map((preset) => ({
    userId: `builtin:${preset.id}`,
    agent: {
      id: preset.id, userId: `builtin:${preset.id}`, name: preset.name, avatar: "",
      strategy: {} as AgentConfigV2["strategy"], strategyVersion: 1,
      executionMode: "verified_package", createdAt: 0, updatedAt: 0,
    },
    autoRequeue: false,
    enteredAt: 0,
  }));
}

const managers: TableManager[] = [];
afterEach(() => {
  for (const manager of managers.splice(0)) {
    for (const info of manager.getHomepageTables()) manager.removeTable(info.id);
  }
});

function finishedTable(manager = new TableManager()) {
  managers.push(manager);
  const table = manager.createMatchedTable(presetEntries(), {
    handLimit: 1, actionDelayMs: 0, interHandDelayMs: 0, commentaryMode: "rule",
  });
  (table as any).handNumber = 1;
  const players = table.getSeats().flatMap((seat, seatIndex) => seat.agent ? [{
    id: seat.agent.id, name: seat.agent.name, avatar: seat.agent.avatar, chips: 5000,
    holeCards: null, bet: 0, folded: false, allIn: false, seatIndex,
  }] : []);
  (table as any).emit({
    type: "agent-roster",
    agents: table.getSeats().flatMap((seat) => seat.agent ? [seat.agent] : []),
  });
  (table as any).emit({ type: "hand-start", handNumber: 1, players, dealerSeatIndex: 0 });
  (table as any).emit({
    type: "cards-dealt",
    hands: Object.fromEntries(players.map((player) => [
      player.id, [{ rank: 14, suit: "s" }, { rank: 13, suit: "h" }],
    ])),
  });
  (table as any).emit({
    type: "hand-complete",
    winners: [{ playerId: players[0].id, amount: 600, potIndex: 0 }],
    players,
  });
  (table as any).emit({
    type: "tournament-complete",
    rankings: table.getSeats().flatMap((seat, position) =>
      seat.agent ? [{ playerId: seat.agent.id, position: position + 1, handsPlayed: 1 }] : []),
  });
  expect(table.getStatus()).toBe("finished");
  return { manager, table };
}

describe("table lifecycle", () => {
  it("keeps matched preset version 1 in seats, roster and complete replay players", async () => {
    const { manager, table } = finishedTable();
    try {
      expect(table.getSeats().map((seat) => seat.agent?.strategyVersion)).toEqual([1, 1, 1, 1, 1, 1]);
      const roster = table.getEventHistory().find((event) => event.type === "agent-roster") as
        Extract<GameEvent, { type: "agent-roster" }>;
      expect(roster.agents.map((agent) => agent.strategyVersion)).toEqual([1, 1, 1, 1, 1, 1]);
      const replay = table.getReplayData();
      expect(replay.hands).toHaveLength(1);
      expect(replay.players.map((player) => [player.type, player.strategyVersion]))
        .toEqual(Array.from({ length: 6 }, () => ["builtin", 1]));
    } finally {
      manager.removeTable(table.id);
    }
  });

  it("keeps the finished table viewable and retries a failed save", async () => {
    const { manager, table } = finishedTable(new TableManager({ archiveRetryDelaysMs: [5, 5] }));
    let attempts = 0;
    manager.setHistoryStore({
      saveCompletedMatch: async () => {
        attempts++;
        if (attempts < 3) throw new Error("Disk unavailable");
      },
    } as unknown as GameHistoryStore);
    try {
      const archived = manager.archiveFinishedTable(table.id);
      await Bun.sleep(2);
      expect(manager.getTable(table.id)?.getStatus()).toBe("finished");
      expect(await archived).toBe(true);
      expect(attempts).toBe(3);
      expect(manager.getTable(table.id)).toBeUndefined();
      expect(manager.getHistoryTables().map((info) => info.id)).toEqual([table.id]);
    } finally {
      manager.removeTable(table.id);
    }
  });

  it("discards a finished table and frozen configs when every save attempt rejects", async () => {
    const { manager, table } = finishedTable(new TableManager({ archiveRetryDelaysMs: [] }));
    manager.setHistoryStore({
      saveCompletedMatch: async () => { throw new Error("Disk unavailable"); },
    } as unknown as GameHistoryStore);
    try {
      const archived = manager.archiveFinishedTable(table.id);
      expect(manager.getHistoryTables()).toEqual([]);
      expect(manager.getAgentV2Configs(table.id)?.size).toBe(6);
      await expect(archived).rejects.toThrow("Disk unavailable");
      expect(manager.getTable(table.id)).toBeUndefined();
      expect(manager.getAgentV2Configs(table.id)).toBeUndefined();
      expect(manager.getHistoryTables()).toEqual([]);
    } finally {
      manager.removeTable(table.id);
    }
  });

  it("publishes history and releases configs only after persistence succeeds", async () => {
    const { manager, table } = finishedTable();
    manager.setHistoryStore({
      saveCompletedMatch: async () => {},
    } as unknown as GameHistoryStore);
    try {
      const archived = manager.archiveFinishedTable(table.id);
      expect(await archived).toBe(true);
      expect(manager.getTable(table.id)).toBeUndefined();
      expect(manager.getAgentV2Configs(table.id)).toBeUndefined();
      expect(manager.getHistoryTables().map((info) => info.id)).toEqual([table.id]);
    } finally {
      manager.removeTable(table.id);
    }
  });

  it("uses UUID table IDs for showcase and matched tables", () => {
    const first = new TableManager();
    const second = new TableManager();
    managers.push(first, second);
    const ids = [first, second].flatMap((manager) => {
      const showcase = manager.ensureShowcaseTable()!;
      manager.removeTable(showcase.id);
      return [showcase.id, manager.createMatchedTable(presetEntries()).id];
    });
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) {
      expect(id).toMatch(/^table-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it("preserves legacy and UUID archives when new tables are created after restart", async () => {
    const { manager, table } = finishedTable();
    const replay = table.getReplayData();
    await manager.archiveFinishedTable(table.id);
    const archived = manager.getHistoryTables()[0];
    const history = [
      { info: archived, events: replay },
      { info: { ...archived, id: "table-1" }, events: replay },
    ];
    const restored = new TableManager();
    managers.push(restored);
    restored.setHistoryStore({
      getAll: () => history,
    } as unknown as GameHistoryStore);

    restored.loadPersistedHistory();
    const publicTable = restored.ensureShowcaseTable();
    if (!publicTable) throw new Error("expected an exhibition after restart");
    restored.removeTable(publicTable.id);
    const matchedTable = restored.createMatchedTable(presetEntries());

    expect(restored.getHistoryTables()).toEqual(history.map((entry) => entry.info));
    expect(restored.getHomepageTables().map((info) => info.id))
      .toContain(archived.id);
    expect(restored.getTable(archived.id)).toBeUndefined();
    expect(restored.getTable("table-1")).toBeUndefined();
    expect(new Set([publicTable.id, matchedTable.id, archived.id, "table-1"]).size).toBe(4);
  });
});
