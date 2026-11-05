import { describe, expect, it } from "bun:test";
import type { Card, GameEvent, ReplayData, ShowdownResult } from "@cybercasino/shared";
import { matchResultMessageFor, publicReplayFor, sessionResultMessageFor, sittingReplay } from "./match-result-message";

describe("match_result message", () => {
  it("sets the protocol identity and removes internal action audits from replay timeline", () => {
    const replay = {
      tableId: "table-1",
      tableName: "Ranked Table",
      config: {} as ReplayData["config"],
      players: [],
      hands: [],
      rankings: [],
      totalHands: 1,
      timeline: [{
        type: "action-taken",
        playerId: "agent-1",
        action: { type: "call" },
        thought: { message: "call", confidence: 0.5, isBluffing: false, thinkingSource: "llm" },
        audit: {
          agentId: "agent-1",
          executionMode: "remote_agent",
          runtime: "remote_websocket",
          turnToken: "must-not-leak",
        },
      }],
    } as unknown as ReplayData;

    const message = matchResultMessageFor({
      table_id: "table-1",
      finished_at: 123,
      total_hands: 1,
      rankings: [{ player_id: "agent-1", position: 1, hands_played: 1 }],
      players: [],
      replay,
    });

    expect(message).toMatchObject({
      type: "match_result",
      protocol_version: 1,
      table_id: "table-1",
      total_hands: 1,
    });
    expect(message.replay.timeline?.[0]).not.toHaveProperty("audit");
    expect(JSON.stringify(message)).not.toContain("must-not-leak");
  });

  it("publishes only hole cards shown at showdown, plus the viewer's own", () => {
    const shown = [{ rank: 14, suit: "s" }, { rank: 14, suit: "h" }] as Card[];
    const folded = [{ rank: 2, suit: "c" }, { rank: 7, suit: "d" }] as Card[];
    const own = [{ rank: 9, suit: "c" }, { rank: 9, suit: "d" }] as Card[];
    const player = (id: string, holeCards: Card[]) => ({
      id, name: id, avatar: "", chips: 5000, holeCards, bet: 0, folded: false, allIn: false, seatIndex: 0,
    });
    const replay = {
      tableId: "table-1",
      tableName: "Ranked Table",
      config: {} as ReplayData["config"],
      players: [],
      hands: [{
        handNumber: 1, smallBlind: 50, bigBlind: 100, communityCards: [], actions: [], winners: [],
        holeCards: { winner: shown, loser: shown, folder: folded, viewer: own },
        showdown: [{ playerId: "winner" }, { playerId: "loser" }] as ShowdownResult[],
      }],
      rankings: [],
      totalHands: 1,
      timeline: [
        { type: "hand-start", handNumber: 1, dealerSeatIndex: 0,
          players: [player("winner", shown), player("folder", folded)] },
        { type: "cards-dealt", hands: { winner: shown, loser: shown, folder: folded, viewer: own } },
        { type: "showdown", results: [{ playerId: "winner" }, { playerId: "loser" }] },
        { type: "hand-complete", winners: [], players: [player("winner", shown), player("folder", folded)] },
      ],
    } as unknown as ReplayData;

    const forPublic = publicReplayFor(replay);
    expect(Object.keys(forPublic.hands[0].holeCards).sort()).toEqual(["loser", "winner"]);
    const dealt = forPublic.timeline?.find((event) => event.type === "cards-dealt") as
      Extract<GameEvent, { type: "cards-dealt" }>;
    expect(Object.keys(dealt.hands).sort()).toEqual(["loser", "winner"]);
    for (const event of forPublic.timeline ?? []) {
      if (event.type !== "hand-start" && event.type !== "hand-complete") continue;
      expect(event.players.find((entry) => entry.id === "folder")?.holeCards).toBeNull();
      expect(event.players.find((entry) => entry.id === "winner")?.holeCards).toEqual(shown);
    }
    expect(JSON.stringify(forPublic)).not.toContain(JSON.stringify(folded));

    const forViewer = publicReplayFor(replay, "viewer");
    expect(forViewer.hands[0].holeCards.viewer).toEqual(own);
    expect(forViewer.hands[0].holeCards.folder).toBeUndefined();
  });

  it("omits Agent thoughts and highlight commentary, which are shown only during the live match", () => {
    const thought = { message: "secret-plan", confidence: 0.9, isBluffing: true, thinkingSource: "llm" };
    const replay = {
      tableId: "table-1",
      tableName: "Ranked Table",
      config: {} as ReplayData["config"],
      players: [],
      hands: [{
        handNumber: 1, smallBlind: 50, bigBlind: 100, communityCards: [], winners: [], holeCards: {},
        actions: [{ playerId: "agent-1", phase: "preflop", action: "raise", amount: 300, thought: "secret-plan" }],
      }],
      rankings: [],
      totalHands: 1,
      timeline: [
        { type: "ai:thinking", playerId: "agent-1", playerName: "A" },
        { type: "ai:thought", playerId: "agent-1", thought, action: { type: "raise", amount: 300 } },
        { type: "action-taken", playerId: "agent-1", action: { type: "raise", amount: 300 }, thought },
        { type: "hand-highlight", handNumber: 1, reasons: ["bluff-success"], commentary: "secret-plan worked",
          potTotal: 600, involvedPlayerIds: ["agent-1"] },
      ],
    } as unknown as ReplayData;

    const forViewer = publicReplayFor(replay, "agent-1");
    expect(forViewer.hands[0].actions).toEqual([
      { playerId: "agent-1", phase: "preflop", action: "raise", amount: 300 },
    ]);
    expect(forViewer.timeline).toEqual([
      { type: "action-taken", playerId: "agent-1", action: { type: "raise", amount: 300 } },
    ]);
    expect(JSON.stringify(forViewer)).not.toContain("secret-plan");
    expect(JSON.stringify(forViewer)).not.toContain("isBluffing");
    expect(JSON.stringify(forViewer)).not.toContain("bluff-success");
  });

  it("sends a cash sitting result without thoughts and with the chip delta", () => {
    const replay = {
      tableId: "cash-1",
      tableName: "Cash",
      config: {} as ReplayData["config"],
      players: [],
      hands: [],
      rankings: [],
      totalHands: 2,
      timeline: [{
        type: "ai:thought",
        playerId: "hero",
        thought: { message: "secret", confidence: 1, isBluffing: true, thinkingSource: "llm" },
        action: { type: "check" },
      }],
    } as unknown as ReplayData;

    const message = sessionResultMessageFor({
      table_id: "cash-1",
      season_id: "season-1",
      started_at: 10,
      ended_at: 20,
      counted_hands: 2,
      sit_equity: 20_000,
      equity: 21_500,
      net_chips: 0,
      reason: "left",
      replay,
    }, "hero");

    expect(message.type).toBe("session_result");
    expect(message.net_chips).toBe(1_500);
    expect(JSON.stringify(message.replay)).not.toContain("secret");
  });

  it("keeps only the hands played after the player sat down", () => {
    const replay = {
      tableId: "cash",
      tableName: "现金桌",
      config: {} as ReplayData["config"],
      players: [],
      rankings: [],
      totalHands: 2,
      hands: [
        { handNumber: 1, smallBlind: 50, bigBlind: 100, holeCards: {}, communityCards: [], actions: [], winners: [] },
        { handNumber: 2, smallBlind: 50, bigBlind: 100, holeCards: {}, communityCards: [], actions: [], winners: [] },
      ],
      timeline: [
        { type: "hand-start", handNumber: 1, players: [], dealerSeatIndex: 0 },
        { type: "hand-complete", winners: [], players: [] },
        { type: "hand-start", handNumber: 2, players: [], dealerSeatIndex: 0 },
        { type: "hand-complete", winners: [], players: [] },
      ],
    } as ReplayData;

    const sliced = sittingReplay(replay, 1, "replay-1");
    expect(sliced.hands.map((hand) => hand.handNumber)).toEqual([2]);
    expect(sliced.timeline?.filter((event) => event.type === "hand-start")).toHaveLength(1);
  });
});
