import { describe, expect, it } from "bun:test";
import type { ReplayData, ReplayHand, TableInfo } from "@cybercasino/shared";
import { recentMatchesFor } from "./agent-summary";

function match(tableId: string, finishedAt: number, version = 1) {
  const hand = (handNumber: number, participates: boolean): ReplayHand => ({
    handNumber, smallBlind: 1, bigBlind: 2,
    holeCards: participates ? { "agent-a": [{ suit: "h", rank: 2 }] } : {},
    communityCards: [], actions: [], winners: [],
  });
  const replay: ReplayData = {
    tableId, tableName: tableId, config: {} as ReplayData["config"],
    players: [{ id: "agent-a", name: "A", avatar: "", type: "custom", strategyVersion: version }],
    hands: [hand(1, true), hand(2, false)],
    rankings: [{ playerId: "agent-a", position: 2 }], totalHands: 2,
  };
  return { info: { id: tableId, finishedAt } as TableInfo, events: replay };
}

describe("Agent recent matches", () => {
  it("returns no other Agent's matches and ignores missing replay or ranking", () => {
    const missingRanking = match("no-ranking", 4);
    missingRanking.events.rankings = [];
    expect(recentMatchesFor("agent-b", [match("one", 1)])).toEqual([]);
    expect(recentMatchesFor("agent-a", [
      { info: { id: "missing" } as TableInfo, events: null },
      missingRanking,
    ])).toEqual([]);
  });

  it("sorts newest first and uses the frozen replay version and actual participation", () => {
    const entries = [match("old", 100, 1), match("new", 200, 2)];
    expect(recentMatchesFor("agent-a", entries)).toEqual([
      { tableId: "new", tableName: "new", finishedAt: 200, position: 2,
        totalPlayers: 1, handsPlayed: 1, totalHands: 2, strategyVersion: 2, replayAvailable: true },
      { tableId: "old", tableName: "old", finishedAt: 100, position: 2,
        totalPlayers: 1, handsPlayed: 1, totalHands: 2, strategyVersion: 1, replayAvailable: true },
    ]);
    expect(entries[0].info.id).toBe("old");
  });

  it("uses explicit hand counts, limits results, and supports legacy replays", () => {
    const explicit = match("explicit", 300);
    explicit.events.rankings[0].handsPlayed = 2;
    expect(recentMatchesFor("agent-a", [explicit, match("old", 100)], 1)[0].handsPlayed).toBe(2);
    expect(recentMatchesFor("agent-a", [explicit, match("old", 100)], 1)).toHaveLength(1);
    const legacy = match("legacy", 1);
    legacy.events.hands = [];
    expect(recentMatchesFor("agent-a", [legacy])[0].handsPlayed).toBe(2);
  });
});
