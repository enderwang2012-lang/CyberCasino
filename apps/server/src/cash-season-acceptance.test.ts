import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionType, AgentDecision, AgentGameView } from "@cybercasino/shared";
import { Deck } from "@cybercasino/engine";
import type { IPokerAgent } from "./agents/agent-interface";
import { sessionResultMessageFor } from "./agents/match-result-message";
import type { MatchEntry } from "./matchmaking-service";
import { PERSONALITIES } from "./agents/personalities";
import { SeasonStore } from "./season-store";
import { TableManager } from "./table-manager";

const dirs: string[] = [];
const originalShuffle = Deck.prototype.shuffle;

afterEach(() => {
  Deck.prototype.shuffle = originalShuffle;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scripted(id: string): IPokerAgent {
  return {
    id,
    name: id,
    avatar: "",
    agentType: "external",
    async decide(_view: AgentGameView, valid: ActionType[]): Promise<AgentDecision> {
      const action = valid.includes("check") ? { type: "check" as const } : { type: "call" as const };
      return {
        action,
        thought: { message: "script", confidence: 1, isBluffing: false, thinkingSource: "rule" },
      };
    },
    recordAction() {},
    clearHistory() {},
  };
}

describe("cash season acceptance", () => {
  it("seats a user, records a hand, sends the sitting result, and cashes out on restart", async () => {
    Deck.prototype.shuffle = function shuffle() {};
    const dir = mkdtempSync(join(tmpdir(), "cash-season-"));
    dirs.push(dir);
    const path = join(dir, "season.json");
    const started = Date.parse("2026-11-04T00:00:00.000Z");
    const store = SeasonStore.open({ file: path, now: started });
    const manager = new TableManager();
    manager.setSeasonStore(store);

    const user: MatchEntry = {
      userId: "user-hero",
      agent: {
        id: "hero",
        userId: "user-hero",
        name: "Hero",
        avatar: "",
        strategy: {} as MatchEntry["agent"]["strategy"],
        executionMode: "remote_agent",
        createdAt: 1,
        updatedAt: 1,
      },
      enteredAt: 1,
      autoRequeue: true,
    };
    const preset = PERSONALITIES[0];
    const presetEntry: MatchEntry = {
      userId: `builtin:${preset.id}`,
      agent: {
        id: preset.id,
        userId: `builtin:${preset.id}`,
        name: preset.name,
        avatar: preset.avatar,
        strategy: {} as MatchEntry["agent"]["strategy"],
        createdAt: 0,
        updatedAt: 0,
      },
      enteredAt: 0,
      autoRequeue: false,
    };

    const { opened, stillWaiting } = manager.syncCashTables([user], [presetEntry]);
    expect(stillWaiting).toEqual([]);
    expect(opened).toHaveLength(1);
    const table = opened[0];
    expect(table.isSpectator()).toBe(false);
    expect(table.getOccupiedCount()).toBe(2);
    table.useScriptedAgent(scripted("hero"));
    table.useScriptedAgent(scripted(preset.id));
    (table.config as { commentaryMode?: "rule"; interHandDelayMs?: number; actionDelayMs?: number }).commentaryMode = "rule";
    table.config.interHandDelayMs = 0;
    table.config.actionDelayMs = 0;
    table.setSeasonRecorder((entries, handNumber) => store.recordHand(table.id, handNumber, entries));
    const results: Array<{ type: string; net_chips: number; reason: string }> = [];
    table.setSeatVacatedHandler((agentId) => {
      const entry = table.getSeasonEntry(agentId);
      const sitting = table.getSitting(agentId);
      if (!entry || !sitting || agentId !== "hero") return;
      const equity = entry.bankroll + entry.tableStack;
      store.save(entry);
      results.push(sessionResultMessageFor({
        table_id: table.id,
        season_id: entry.seasonId,
        started_at: sitting.at,
        ended_at: sitting.at + 1,
        counted_hands: entry.countedHands - sitting.hands,
        sit_equity: sitting.equity,
        equity,
        net_chips: 0,
        reason: table.getDepartureReason(agentId),
        replay: table.getReplayData(),
      }, agentId));
    });
    table.setBetweenHandsHandler(() => table.requestSeasonWindDown());

    await table.start("en");

    expect(table.getHandNumber()).toBe(1);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ type: "session_result", reason: "season_ended" });
    expect(typeof results[0].net_chips).toBe("number");
    expect(JSON.stringify(results[0])).not.toContain("secret");

    const restarted = SeasonStore.open({ file: path, now: started });
    const hero = restarted.get("hero");
    expect(hero?.tableStack).toBe(0);
    expect(hero?.countedHands).toBe(1);
    expect((hero?.bankroll ?? 0) + (hero?.tableStack ?? 0)).toBeGreaterThan(0);
    const board = restarted.leaderboard();
    expect(board.provisional.some((row) => row.agentId === "hero")).toBe(true);
    expect(board.ranked).toEqual([]);
    manager.removeTable(table.id);
  });
});
