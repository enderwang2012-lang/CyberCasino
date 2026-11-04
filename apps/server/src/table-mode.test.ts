import { describe, expect, it } from "bun:test";
import type { AgentConfigV2, TableConfig } from "@cybercasino/shared";
import { TableInstance } from "./table-instance";
import { TableManager } from "./table-manager";
import { PERSONALITIES } from "./agents/personalities";

function config(mode: TableConfig["mode"]): TableConfig {
  return {
    name: "mode test",
    mode,
    smallBlind: 50,
    bigBlind: 100,
    startingChips: 5000,
    maxPlayers: 4,
  };
}

function agent(id: string): Pick<AgentConfigV2, "id" | "userId" | "name" | "avatar"> {
  return {
    id,
    userId: `user-${id}`,
    name: id,
    avatar: "",
  };
}

describe("open ranked competition", () => {
  it("keeps a stable, privacy-safe snapshot for a seated Agent", () => {
    const table = new TableInstance("snapshot", config("ranked"));
    const heroCards = [{ rank: 14 as const, suit: "s" as const }, { rank: 14 as const, suit: "h" as const }];
    const villainCards = [{ rank: 2 as const, suit: "c" as const }, { rank: 7 as const, suit: "d" as const }];

    (table as any).emit({
      type: "hand-start",
      handNumber: 1,
      dealerSeatIndex: 0,
      players: [
        { id: "hero", name: "Hero", avatar: "", chips: 5000, holeCards: null, bet: 0, folded: false, allIn: false, seatIndex: 0 },
        { id: "villain", name: "Villain", avatar: "", chips: 5000, holeCards: null, bet: 0, folded: false, allIn: false, seatIndex: 1 },
      ],
    });
    (table as any).emit({
      type: "cards-dealt",
      hands: { hero: heroCards, villain: villainCards },
    });

    const first = table.getSnapshotForAgent("hero");
    const second = table.getSnapshotForAgent("hero");
    if (!first || !second) throw new Error("expected seated Agent snapshot");
    (table as any).snapshotSeq++;
    const sameStateAtLaterSequence = table.getSnapshotForAgent("hero");
    if (!sameStateAtLaterSequence) throw new Error("expected later Agent snapshot");
    expect(first.tableSeq).toBeGreaterThan(0);
    expect(first.stateHash).toHaveLength(64);
    expect(first.stateHash).toBe(second.stateHash);
    expect(sameStateAtLaterSequence.tableSeq).toBeGreaterThan(first.tableSeq);
    expect(sameStateAtLaterSequence.stateHash).toBe(first.stateHash);
    expect(first.myCards).toEqual(heroCards);
    expect(first).not.toHaveProperty("holeCards");
    expect(JSON.stringify(first)).not.toContain(JSON.stringify(villainCards));
  });

  it("admits hosted packages, remote agents and preset Agents to ranked tables", () => {
    const table = new TableInstance("ranked", config("ranked"));

    expect(table.sit(agent("strategy"), "verified_package")).toBe(true);
    expect(table.sit(agent("remote"), "remote_agent")).toBe(true);
    expect(table.sitBuiltin("shark")).toBe(true);
    expect(table.getSeats().map((seat) => seat.agent?.executionMode)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("keeps the full public match history available to live viewers", () => {
    const table = new TableInstance("ranked", config("ranked"));
    const cardsEvent = {
      type: "cards-dealt" as const,
      hands: { hero: [{ rank: 14 as const, suit: "s" as const }, { rank: 14 as const, suit: "h" as const }] },
    };

    (table as any).emit(cardsEvent);
    expect(table.getEventHistory()).toEqual([]);
    expect(table.getLiveEventHistory()).toEqual([cardsEvent]);

    (table as any).handNumber = 1;
    expect(table.getEventHistory()).toEqual([cardsEvent]);
  });

  it("publishes live cards, standings and completed-hand highlights", () => {
    const table = new TableInstance("ranked", config("ranked"));
    const live: unknown[] = [];
    table.onLiveEvent((event) => live.push(event));

    (table as any).emit({
      type: "cards-dealt",
      hands: { hero: [{ rank: 14, suit: "s" }, { rank: 14, suit: "h" }] },
    });
    (table as any).emit({
      type: "hand-complete",
      winners: [],
      players: [{ id: "hero", chips: 5100 }, { id: "villain", chips: 4900 }],
    });
    (table as any).emit({
      type: "hand-highlight",
      handNumber: 1,
      reasons: ["bad-beat"],
      commentary: "精彩一手，完整牌面请在赛后回放中查看。",
      potTotal: 5000,
      involvedPlayerIds: ["hero"],
    });

    expect(live).toEqual([
      {
        type: "cards-dealt",
        hands: { hero: [{ rank: 14, suit: "s" }, { rank: 14, suit: "h" }] },
      },
      {
        type: "hand-complete",
        winners: [],
        players: [{ id: "hero", chips: 5100 }, { id: "villain", chips: 4900 }],
      },
      {
        type: "hand-highlight",
        handNumber: 1,
        commentary: "精彩一手，完整牌面请在赛后回放中查看。",
        reasons: ["bad-beat"],
        potTotal: 5000,
        involvedPlayerIds: ["hero"],
      },
    ]);
  });

  it("keeps action audit internally while omitting it from finished public events", () => {
    const table = new TableInstance("ranked", config("ranked"));
    const audit = {
      agentId: "hero",
      handNumber: 1,
      street: "preflop" as const,
      tableMode: "ranked" as const,
      executionMode: "remote_agent" as const,
      runtime: "remote_websocket" as const,
      stateScope: "visible_information_only" as const,
      validActions: ["check" as const],
      proposedAction: { type: "check" as const },
      executedAction: { type: "check" as const },
      validation: { accepted: true, corrections: [] },
      decidedAt: 1,
    };
    const event = { type: "action-taken", playerId: "hero", action: { type: "check" }, thought: {}, audit };
    (table as any).emit(event);

    expect(table.getAuditRecords()).toEqual([audit]);
    (table as any).handNumber = 1;
    expect((table.getEventHistory()[0] as any).audit).toBeUndefined();
  });

  it("seats six preset Agents at a single unranked exhibition table", () => {
    const manager = new TableManager();
    const table = manager.ensureShowcaseTable();
    try {
      expect(table.config.mode).toBe("exhibition");
      expect(table.getSeats().map((seat) => seat.agent?.type)).toEqual(Array(6).fill("builtin"));
      expect(manager.ensureShowcaseTable()).toBe(table);
      expect(manager.isShowcaseTable(table.id)).toBe(true);
    } finally {
      manager.removeTable(table.id);
    }
  });

  it("detects an actively competing agent so strategy updates can be blocked", () => {
    const manager = new TableManager();
    const entries = PERSONALITIES.slice(0, 5).map((preset) => ({
      userId: `builtin:${preset.id}`,
      agent: { ...agent(preset.id), userId: `builtin:${preset.id}` } as AgentConfigV2,
      enteredAt: 0,
      autoRequeue: false,
    }));
    entries.push({ userId: "user-active", agent: agent("active") as AgentConfigV2, enteredAt: 0, autoRequeue: false });
    const table = manager.createMatchedTable(entries);
    expect(manager.isAgentPlaying("active")).toBe(false);

    (table as any).running = true;
    expect(manager.isAgentPlaying("active")).toBe(true);
    (table as any).running = false;
    manager.removeTable(table.id);
  });
});
