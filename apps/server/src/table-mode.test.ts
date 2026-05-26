import { describe, expect, it } from "bun:test";
import type { AgentConfigV2, TableConfig } from "@cybercasino/shared";
import { TableInstance } from "./table-instance";
import { TableManager } from "./table-manager";

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
  it("admits hosted packages, remote agents and reference AI to ranked tables", () => {
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

  it("does not expose match events until the ranked match has finished", () => {
    const table = new TableInstance("ranked", config("ranked"));
    const cardsEvent = {
      type: "cards-dealt" as const,
      hands: { hero: [{ rank: 14 as const, suit: "s" as const }, { rank: 14 as const, suit: "h" as const }] },
    };

    (table as any).emit(cardsEvent);
    expect(table.getEventHistory()).toEqual([]);

    (table as any).handNumber = 1;
    expect(table.getEventHistory()).toEqual([cardsEvent]);
  });

  it("publishes only sanitized live standings and commentary during play", () => {
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
        type: "public-standings",
        handNumber: 0,
        players: [{ id: "hero", chips: 5100 }, { id: "villain", chips: 4900 }],
      },
      {
        type: "public-commentary",
        handNumber: 1,
        commentary: "精彩一手，完整牌面请在赛后回放中查看。",
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

  it("lets only the first seated custom agent manage ranked seating", () => {
    const table = new TableInstance("ranked", config("ranked"));
    expect(table.sit(agent("owner"), "verified_package")).toBe(true);
    expect(table.canManage("user-owner")).toBe(true);
    expect(table.canManage("user-other")).toBe(false);
  });

  it("detects an actively competing agent so strategy updates can be blocked", () => {
    const manager = new TableManager();
    const table = manager.ensurePresetTable();
    expect(table.sit(agent("active"), "verified_package")).toBe(true);
    expect(manager.isAgentPlaying("active")).toBe(false);

    (table as any).running = true;
    expect(manager.isAgentPlaying("active")).toBe(true);
  });
});
