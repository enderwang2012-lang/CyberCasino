import { afterEach, describe, expect, it } from "bun:test";
import type { ActionType, AgentDecision, AgentGameView, TableConfig } from "@cybercasino/shared";
import { Deck } from "@cybercasino/engine";
import type { IPokerAgent } from "./agents/agent-interface";
import { createSeasonEntry } from "./season-ledger";
import { TableInstance } from "./table-instance";

const originalShuffle = Deck.prototype.shuffle;

afterEach(() => {
  Deck.prototype.shuffle = originalShuffle;
});

function cashConfig(maxPlayers: number, handLimit?: number): TableConfig {
  return {
    name: "cash",
    mode: "cash",
    smallBlind: 50,
    bigBlind: 100,
    startingChips: 5_000,
    maxPlayers,
    handLimit,
    interHandDelayMs: 0,
    actionDelayMs: 0,
    commentaryMode: "rule",
  };
}

function scripted(
  id: string,
  choose: (view: AgentGameView, valid: ActionType[]) => AgentDecision["action"],
): IPokerAgent {
  return {
    id,
    name: id,
    avatar: "",
    agentType: "external",
    async decide(view, validActions) {
      return {
        action: choose(view, validActions),
        thought: { message: "script", confidence: 1, isBluffing: false, thinkingSource: "rule" },
      };
    },
    recordAction() {},
    clearHistory() {},
  };
}

function callOrCheck(valid: ActionType[]): AgentDecision["action"] {
  if (valid.includes("call")) return { type: "call" };
  if (valid.includes("check")) return { type: "check" };
  return { type: "fold" };
}

describe("cash table loop", () => {
  it("keeps playing after a busted player stands up", async () => {
    Deck.prototype.shuffle = function shuffle() {};
    const table = new TableInstance("cash-bust", cashConfig(3, 1));
    let shortStillSeatedWhileAllIn = false;
    table.useScriptedAgent(scripted("short", (_view, valid) => callOrCheck(valid)));
    table.useScriptedAgent(scripted("caller", (view, valid) => {
      const short = view.players.find((player) => player.id === "short");
      if (short && short.chips === 0) {
        shortStillSeatedWhileAllIn = table.getSeats().some((seat) => seat.agent?.id === "short");
      }
      return callOrCheck(valid);
    }));
    table.useScriptedAgent(scripted("blind", (_view, valid) => callOrCheck(valid)));
    for (const id of ["short", "caller", "blind"]) {
      table.sit({ id, userId: `user-${id}`, name: id, avatar: "" });
    }
    table.fund("short", 100);
    table.fund("caller", 5_000);
    table.fund("blind", 5_000);

    await table.start("en");

    expect(shortStillSeatedWhileAllIn).toBe(true);
    expect(table.cashSettlements).toHaveLength(1);
    expect(table.cashSettlements[0].status).toBe("playing");
    expect(table.cashSettlements[0].seatedIds).not.toContain("short");
    expect(table.cashSettlements[0].seatedIds).toEqual(["caller", "blind"]);
    expect(table.cashSettlements[0].smallBlind).toBe(50);
    expect(table.cashSettlements[0].bigBlind).toBe(100);
    expect(table.cashSettlements[0].chips.caller).not.toBe(5_000);
    expect(table.getLiveEventHistory().some((event) => event.type === "tournament-complete")).toBe(false);
    expect(table.getLiveEventHistory().some((event) => event.type === "blind-level-up")).toBe(false);
  });

  it("buys back in and stays seated when the wallet still covers 5000", async () => {
    Deck.prototype.shuffle = function shuffle() {};
    const table = new TableInstance("cash-rebuy", cashConfig(3, 1));
    table.useScriptedAgent(scripted("short", (_view, valid) => callOrCheck(valid)));
    table.useScriptedAgent(scripted("caller", (_view, valid) => callOrCheck(valid)));
    table.useScriptedAgent(scripted("blind", (_view, valid) => callOrCheck(valid)));
    for (const id of ["short", "caller", "blind"]) {
      table.sit({ id, userId: `user-${id}`, name: id, avatar: "" });
    }
    table.fund("short", 100);
    table.fund("caller", 5_000);
    table.fund("blind", 5_000);
    table.attachSeason({
      ...createSeasonEntry("s1", "short", "short", "user"),
      bankroll: 10_000,
      tableStack: 100,
    });

    await table.start("en");

    expect(table.cashSettlements[0].seatedIds).toContain("short");
    expect(table.cashSettlements[0].chips.short).toBe(5_000);
    expect(table.cashSettlements[0].seasons.find((entry) => entry.agentId === "short")).toEqual(
      expect.objectContaining({ bankroll: 5_000, tableStack: 5_000 }),
    );
  });

  it("deals the next hand to a user who takes a preset seat between hands", async () => {
    Deck.prototype.shuffle = function shuffle() {};
    const dealt = new Set<string>();
    const table = new TableInstance("cash-yield", cashConfig(2, 2));
    const remember = (id: string) => (_view: AgentGameView, valid: ActionType[]) => {
      dealt.add(id);
      return callOrCheck(valid);
    };
    table.useScriptedAgent(scripted("neon", remember("neon")));
    table.useScriptedAgent(scripted("viper", remember("viper")));
    table.useScriptedAgent(scripted("hero", remember("hero")));
    table.sitBuiltin("neon");
    table.sitBuiltin("viper");
    table.fund("neon", 5_000);
    table.fund("viper", 5_000);
    let yielded = false;
    table.setBetweenHandsHandler(() => {
      if (yielded) return;
      yielded = true;
      table.standUp("viper");
      table.sit({ id: "hero", userId: "user-hero", name: "hero", avatar: "" });
      table.fund("hero", 5_000);
      table.refreshCashRoster();
    });

    await table.start("en");

    expect(dealt.has("hero")).toBe(true);
    expect(table.cashSettlements.at(-1)?.seatedIds).toContain("hero");
    expect(table.cashSettlements.at(-1)?.seatedIds).not.toContain("viper");
  });

  it("skims a stack above 15000 back into the season bankroll", () => {
    const table = new TableInstance("cash-skim", cashConfig(2));
    table.sit({ id: "hero", userId: "user-hero", name: "hero", avatar: "" });
    table.sit({ id: "villain", userId: "user-villain", name: "villain", avatar: "" });
    table.useScriptedAgent(scripted("hero", (_view, valid) => callOrCheck(valid)));
    table.useScriptedAgent(scripted("villain", (_view, valid) => callOrCheck(valid)));
    table.fund("hero", 18_000);
    table.fund("villain", 5_000);
    const before = { ...createSeasonEntry("s1", "hero", "Hero", "user"), bankroll: 10_000, tableStack: 5_000 };
    table.attachSeason(before);

    table.applyBetweenHands();

    expect(table.getPlayerChips("hero")).toBe(15_000);
    expect(table.getSeasonEntry("hero")).toEqual(expect.objectContaining({
      bankroll: 13_000,
      tableStack: 15_000,
      countedHands: 1,
    }));
  });

  it("finishes the current hand and does not start another during season wind-down", async () => {
    Deck.prototype.shuffle = function shuffle() {};
    const table = new TableInstance("cash-wind-down", cashConfig(2));
    table.useScriptedAgent(scripted("hero", (_view, valid) => callOrCheck(valid)));
    table.useScriptedAgent(scripted("villain", (_view, valid) => callOrCheck(valid)));
    table.sit({ id: "hero", userId: "user-hero", name: "hero", avatar: "" });
    table.sit({ id: "villain", userId: "user-villain", name: "villain", avatar: "" });
    table.fund("hero", 5_000);
    table.fund("villain", 5_000);
    table.setBetweenHandsHandler(() => table.requestSeasonWindDown());

    await table.start("en");

    expect(table.cashSettlements).toHaveLength(1);
    expect(table.getHandNumber()).toBe(1);
    expect(table.getStatus()).toBe("finished");
    expect(table.getDepartureReason("hero")).toBe("season_ended");
  });

  it("moves the button by seat index after seat 5 leaves", () => {
    const table = new TableInstance("cash-button", cashConfig(6));
    for (let index = 0; index < 6; index += 1) {
      const id = `p${index}`;
      table.sit({ id, userId: `user-${id}`, name: id, avatar: "" });
      table.useScriptedAgent(scripted(id, (_view, valid) => callOrCheck(valid)));
      table.fund(id, index === 5 ? 0 : 1_000);
    }
    (table as unknown as { dealerSeatIndex: number }).dealerSeatIndex = 5;

    table.applyBetweenHands();

    expect(table.getSeats().find((seat) => seat.seatIndex === 5)?.status).toBe("empty");
    expect(table.getDealerSeatIndex()).toBe(0);
  });

  it("keeps the presets playing as a spectator table after the last user leaves", () => {
    const table = new TableInstance("cash-flow", cashConfig(2));
    table.sitBuiltin("neon");
    table.sit({ id: "hero", userId: "user-hero", name: "hero", avatar: "" });
    table.fund("neon", 5_000);
    table.fund("hero", 5_000);
    table.attachSeason(createSeasonEntry("s1", "neon", "neon", "preset"));
    table.attachSeason(createSeasonEntry("s1", "hero", "hero", "user"));
    let records = 0;
    table.setSeasonRecorder((entries) => {
      records += 1;
      const neon = entries.find((entry) => entry.agentId === "neon");
      expect(neon).toEqual(expect.objectContaining({ tableStack: 0, countedHands: 1, bankroll: 25_000 }));
    });

    table.requestCashLeave("hero");
    table.applyBetweenHands();

    expect(table.isSpectator()).toBe(true);
    expect(table.getSeats().some((seat) => seat.agent?.id === "neon")).toBe(true);
    expect(table.getSeats().some((seat) => seat.agent?.id === "hero")).toBe(false);
    expect(table.getPlayerChips("neon")).toBe(5_000);
    expect(records).toBe(1);

    table.applyBetweenHands();
    expect(records).toBe(1);
    expect(table.isSpectator()).toBe(true);
  });
});
