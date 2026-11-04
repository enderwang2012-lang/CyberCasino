import { afterEach, describe, expect, it } from "bun:test";
import type { AgentGameView, ExternalAgentMatchResult, ProtocolActionAck, ReplayData } from "@cybercasino/shared";
import { createAgentHarness } from "./ws-agent-client";
import { ReferenceAgentClient, type ReferenceTurn } from "./reference-agent-client";

const harnesses: Awaited<ReturnType<typeof createAgentHarness>>[] = [];
const clients: ReferenceAgentClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  for (const harness of harnesses.splice(0)) await harness.close();
});

function view(): AgentGameView {
  return {
    myId: "test-agent-1",
    myCards: [],
    myChips: 5000,
    myBet: 0,
    phase: "preflop",
    communityCards: [],
    pots: [],
    players: [],
    dealerSeatIndex: 0,
    smallBlind: 50,
    bigBlind: 100,
    currentBet: 100,
    minRaise: 100,
    handNumber: 1,
    actionHistory: [],
    tableId: "table-reference-client",
    handId: "table-reference-client:hand-1",
    turnId: "table-reference-client:hand-1:turn-1",
  };
}

function matchResult(): Omit<ExternalAgentMatchResult, "type" | "protocol_version"> {
  const players: ReplayData["players"] = [
    { id: "test-agent-1", name: "Reference", avatar: "", type: "custom", strategyVersion: 3 },
    { id: "test-agent-2", name: "Opponent", avatar: "", type: "builtin", strategyVersion: 1 },
  ];
  return {
    table_id: "table-reference-client",
    finished_at: 123,
    total_hands: 1,
    rankings: [
      { player_id: "test-agent-1", position: 1, hands_played: 1 },
      { player_id: "test-agent-2", position: 2, hands_played: 1 },
    ],
    players,
    replay: {
      tableId: "table-reference-client",
      tableName: "Reference Client Table",
      config: {
        name: "Reference Client Table", mode: "ranked",
        smallBlind: 50, bigBlind: 100, startingChips: 5000, maxPlayers: 2,
      },
      players,
      hands: [{
        handId: "table-reference-client:hand-1",
        handNumber: 1, smallBlind: 50, bigBlind: 100,
        holeCards: {
          "test-agent-1": [{ rank: 14, suit: "s" }, { rank: 14, suit: "h" }],
          "test-agent-2": [{ rank: 13, suit: "s" }, { rank: 13, suit: "h" }],
        },
        communityCards: [],
        actions: [{ playerId: "test-agent-1", phase: "preflop", action: "call", thought: "Call" }],
        winners: [{ playerId: "test-agent-1", amount: 200, potIndex: 0 }],
      }],
      rankings: [
        { playerId: "test-agent-1", position: 1, handsPlayed: 1 },
        { playerId: "test-agent-2", position: 2, handsPlayed: 1 },
      ],
      totalHands: 1,
      timeline: [{
        type: "action-taken", playerId: "test-agent-1", action: { type: "call" },
        thought: { message: "Call", confidence: 0.5, isBluffing: false, thinkingSource: "rule" },
      }],
    },
  };
}

describe("ReferenceAgentClient", () => {
  it("authenticates, answers your_turn, and receives a complete result after reconnect", async () => {
    const harness = await createAgentHarness();
    harnesses.push(harness);

    const client = await ReferenceAgentClient.connect(harness.url, "test-agent-1", {
      heartbeatIntervalMs: 10,
    });
    clients.push(client);
    expect(client.authenticated).toMatchObject({
      type: "authenticated",
      protocol_version: 1,
      agentId: "test-agent-1",
    });
    expect(await client.next("pong", 1000)).toMatchObject({ type: "pong" });

    const decision = harness.manager.requestDecision(
      "test-agent-1",
      view(),
      ["call", "fold", "raise"],
      100,
      100,
      "",
      "table-reference-client",
      2000,
    );
    const turn = await client.next<ReferenceTurn>("your_turn");
    const action = client.respondToTurn(turn);
    const ack = await client.next<ProtocolActionAck>("action_ack");
    expect(ack).toMatchObject({
      type: "action_ack",
      protocol_version: 1,
      table_id: turn.table_id,
      hand_id: turn.hand_id,
      turn_id: turn.turn_id,
      client_action_id: action.client_action_id,
    });
    await expect(decision).resolves.toMatchObject({
      action: { type: "call" },
      protocol: { clientActionId: ack.client_action_id },
    });

    await client.close();
    harness.manager.sendMatchResult(["test-agent-1"], matchResult());

    await client.reconnect();
    const result = await client.next<ExternalAgentMatchResult>("match_result");
    expect(result).toEqual({
      ...matchResult(),
      type: "match_result",
      protocol_version: 1,
    });
    expect(client.results.get(result.table_id)).toEqual(result);
    harness.manager.sendMatchResult(["test-agent-1"], matchResult());
    expect(await client.next("match_result")).toEqual(result);
    expect(client.results.size).toBe(1);
  });

  it("resumes the original pending decision and retries the identical payload", async () => {
    const harness = await createAgentHarness();
    harnesses.push(harness);
    const client = await ReferenceAgentClient.connect(harness.url, "test-agent-1");
    clients.push(client);
    const decision = harness.manager.requestDecision(
      "test-agent-1", view(), ["call", "fold", "raise"], 100, 100, "",
      "table-reference-client", 2000,
    );
    const original = await client.next<ReferenceTurn>("your_turn");
    await client.reconnect();
    const resumed = await client.next<ReferenceTurn>("pending_decision");
    expect(resumed).toEqual({ ...original, type: "pending_decision" });
    const action = client.respondToTurn(resumed, { action: "raise", amount: 200 });
    expect(client.respondToTurn(resumed, { action: "fold" })).toEqual(action);
    const ack = await client.next("action_ack");
    expect(await client.next("action_ack")).toEqual(ack);
    expect(await decision).toMatchObject({ action: { type: "raise", amount: 200 } });
  });

});
