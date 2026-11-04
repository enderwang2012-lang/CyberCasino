import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { AgentGameView, ExternalAgentMatchResult, ReplayData } from "@cybercasino/shared";
import type { AgentSnapshotState } from "../external-agent-protocol";
import { createAgentHarness, actionFor } from "../../test-utils/ws-agent-client";
import { decisionKey, parseActionMessage, parseResyncMessage } from "../external-agent-protocol";

const harnesses: Awaited<ReturnType<typeof createAgentHarness>>[] = [];
afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close();
});

async function setup() {
  const harness = await createAgentHarness();
  harnesses.push(harness);
  const client = await harness.connect();
  const auth = await client.next("authenticated");
  const request = (overrides: Partial<AgentGameView> = {}, timeoutMs = 2000) =>
    harness.manager.requestDecision("test-agent-1", view(overrides), ["call", "fold", "raise"],
      100, 100, "", overrides.tableId ?? "table-1", timeoutMs);
  return { ...harness, client, auth, request };
}

function view(overrides: Partial<AgentGameView> = {}): AgentGameView {
  return {
    myId: "test-agent-1", myCards: [], myChips: 5000, myBet: 0,
    phase: "preflop", communityCards: [], pots: [], players: [],
    dealerSeatIndex: 0, smallBlind: 50, bigBlind: 100, currentBet: 100,
    minRaise: 100, handNumber: 1, actionHistory: [],
    tableId: "table-1", handId: "table-1:hand-1", turnId: "table-1:hand-1:turn-1",
    ...overrides,
  };
}

describe("Protocol v1 parsing", () => {
  it("does not collide when ids contain separators", () => {
    expect(decisionKey("a:b", { tableId: "c", handId: "d", turnId: "e" }))
      .not.toBe(decisionKey("a", { tableId: "b:c", handId: "d", turnId: "e" }));
  });

  it.each([
    [{ type: "action", action: "call" }, "missing_context"],
    [actionFor({ table_id: "t", hand_id: "h", turn_id: "r", turn_token: "s" },
      { client_action_id: "" }), "missing_client_action_id"],
    [actionFor({ table_id: "t", hand_id: "h", turn_id: "r", turn_token: "s" },
      { action: "dance" }), "invalid_action"],
    [actionFor({ table_id: "t", hand_id: "h", turn_id: "r", turn_token: "s" },
      { action: "raise", amount: 1.5 }), "invalid_amount"],
    [actionFor({ table_id: "t", hand_id: "h", turn_id: "r", turn_token: "s" },
      { action: "raise", amount: NaN }), "invalid_amount"],
  ])("rejects malformed actions (%#)", (input, reason) => {
    expect(parseActionMessage(input)).toMatchObject({ ok: false, reason });
  });

  it("parses a resync request with an optional non-negative sequence", () => {
    expect(parseResyncMessage({
      type: "resync",
      table_id: "table-1",
      last_seen_seq: 42,
    })).toEqual({
      ok: true,
      request: {
        type: "resync",
        table_id: "table-1",
        last_seen_seq: 42,
      },
    });
    expect(parseResyncMessage({ type: "resync", table_id: "table-1" }))
      .toMatchObject({ ok: true });
  });

  it.each([
    [{ type: "resync" }, "missing_context"],
    [{ type: "resync", table_id: "" }, "missing_context"],
    [{ type: "resync", table_id: "table-1", last_seen_seq: 1.5 }, "invalid_sequence"],
    [{ type: "resync", table_id: "table-1", last_seen_seq: -1 }, "invalid_sequence"],
  ])("rejects malformed resync requests (%#)", (input, reason) => {
    expect(parseResyncMessage(input)).toMatchObject({ ok: false, reason });
  });
});

describe("Protocol v1 WebSocket decisions", () => {
  it("redelivers a completed match result after the Agent reconnects", async () => {
    const harness = await createAgentHarness();
    harnesses.push(harness);
    const client = await harness.connect("test-agent-1");
    await client.next("authenticated");
    await client.disconnect();

    const result: Omit<ExternalAgentMatchResult, "type" | "protocol_version"> = {
      table_id: "table-finished",
      finished_at: 123,
      total_hands: 42,
      rankings: [{ player_id: "test-agent-1", position: 1, hands_played: 42 }],
      players: [],
      replay: {
        tableId: "table-finished",
        tableName: "Finished Table",
        config: {} as ReplayData["config"],
        players: [],
        hands: [],
        rankings: [],
        totalHands: 42,
      },
    };
    harness.manager.sendMatchResult(["test-agent-1"], result);

    const reconnected = await harness.connect("test-agent-1");
    await reconnected.next("authenticated");
    expect(await reconnected.next("match_result")).toMatchObject({
      type: "match_result",
      protocol_version: 1,
      table_id: "table-finished",
      total_hands: 42,
    });
  });

  it("returns an Agent-scoped snapshot and preserves the current pending turn", async () => {
    const harness = await createAgentHarness();
    harnesses.push(harness);
    const current = await harness.connect("test-agent-1");
    await current.next("authenticated");
    const observer = await harness.connect("test-agent-2");
    await observer.next("authenticated");

    const source = (agentId: string): AgentSnapshotState => ({
      tableId: "table-resync",
      tableSeq: 7,
      stateHash: "a".repeat(64),
      status: "playing",
      handId: "table-resync:hand-3",
      handNumber: 3,
      phase: "flop",
      myCards: agentId === "test-agent-1"
        ? [{ rank: 14, suit: "s" }, { rank: 13, suit: "h" }]
        : [{ rank: 2, suit: "c" }, { rank: 7, suit: "d" }],
      communityCards: [
        { rank: 10, suit: "s" },
        { rank: 9, suit: "d" },
        { rank: 3, suit: "c" },
      ],
      players: [
        { id: "test-agent-1", name: "A", avatar: "", chips: 4700, bet: 300, folded: false, allIn: false, seatIndex: 0 },
        { id: "test-agent-2", name: "B", avatar: "", chips: 5300, bet: 0, folded: false, allIn: false, seatIndex: 1 },
      ],
      pots: [{ amount: 600, eligiblePlayerIds: ["test-agent-1", "test-agent-2"] }],
      dealerSeatIndex: 1,
      currentPlayerId: "test-agent-1",
      currentBet: 300,
      callAmount: 100,
      minRaiseTo: 600,
      maxRaiseTo: 4700,
      validActions: ["call", "fold", "raise"],
      actionHistory: [],
    });
    harness.manager.registerSnapshotSource("table-resync", source);

    const result = harness.manager.requestDecision(
      "test-agent-1",
      view({
        tableId: "table-resync",
        handId: "table-resync:hand-3",
        turnId: "table-resync:hand-3:turn-1",
        phase: "flop",
      }),
      ["call", "fold", "raise"],
      100,
      300,
      "",
      "table-resync",
      2000,
    );
    const turn = await current.next("your_turn");

    current.send({ type: "resync", table_id: "table-resync", last_seen_seq: 0 });
    const snapshot = await current.next("table_snapshot");
    expect(snapshot).toMatchObject({
      protocol_version: 1,
      table_id: "table-resync",
      table_seq: 7,
      sync_mode: "full",
      unchanged: false,
      is_current_actor: true,
      my_cards: ["As", "Kh"],
      community_cards: ["10s", "9d", "3c"],
      current_player_id: "test-agent-1",
      valid_actions: ["call", "fold", "raise"],
      turn: {
        turn_id: turn.turn_id,
        turn_token: turn.turn_token,
        deadline_at: turn.deadline_at,
      },
    });
    expect(snapshot.players[0]).not.toHaveProperty("holeCards");
    expect(snapshot.my_cards).not.toContain("2c");
    expect(snapshot.community_cards).not.toContain("2c");

    current.send({ type: "resync", table_id: "table-resync", last_seen_seq: 7 });
    expect(await current.next("table_snapshot")).toMatchObject({
      unchanged: true,
      table_seq: 7,
      state_hash: "a".repeat(64),
    });

    observer.send({ type: "resync", table_id: "table-resync" });
    const observerSnapshot = await observer.next("table_snapshot");
    expect(observerSnapshot).toMatchObject({
      is_current_actor: false,
      valid_actions: [],
      call_amount: 0,
      min_raise_to: null,
      max_raise_to: null,
    });
    expect(observerSnapshot).not.toHaveProperty("turn");

    current.send(actionFor(turn));
    await current.next("action_ack");
    await result;
  });

  it("announces the protocol and resolves the matching turn with a receipt", async () => {
    const { auth, client, request } = await setup();
    expect(auth.protocol_version).toBe(1);
    const result = request();
    const turn = await client.next("your_turn");
    expect(turn).toMatchObject({
      protocol_version: 1, table_id: "table-1", hand_id: "table-1:hand-1",
      turn_id: "table-1:hand-1:turn-1", minRaiseTo: 200, maxRaiseTo: 5000,
    });
    expect(turn.deadline_at).toBeGreaterThan(Date.now());
    client.send(actionFor(turn));
    expect(await client.next("action_ack")).toMatchObject({ action: "call" });
    expect(await result).toMatchObject({
      action: { type: "call" },
      protocol: { tableId: "table-1", handId: turn.hand_id, turnId: turn.turn_id,
        clientActionId: `${turn.turn_id}:action` },
    });
  });

  it("rejects wrong tokens, illegal actions and out-of-range raises without consuming the turn", async () => {
    const { client, request } = await setup();
    const result = request();
    const turn = await client.next("your_turn");
    for (const [change, reason] of [
      [{ turn_token: "expired" }, "stale_turn_token"],
      [{ action: "check" }, "invalid_action"],
      [{ action: "raise", amount: 100 }, "invalid_amount"],
      [{ action: "raise", amount: 5001 }, "invalid_amount"],
    ] as const) {
      client.send(actionFor(turn, change));
      expect(await client.next("action_rejected")).toMatchObject({ reason });
    }
    client.send(actionFor(turn, { action: "raise", amount: 200 }));
    expect(await client.next("action_ack")).toMatchObject({ action: "raise", amount: 200 });
    expect((await result).action).toEqual({ type: "raise", amount: 200 });
  });

  it("accepts a short-stack all-in below the full minimum raise", async () => {
    const { client, request } = await setup();
    const result = request({ myChips: 150 });
    const turn = await client.next("your_turn");
    client.send(actionFor(turn, { action: "raise", amount: 150 }));
    expect(await client.next("action_ack")).toMatchObject({ amount: 150 });
    expect((await result).action.amount).toBe(150);
  });

  it("keeps the original ACK after conflicting retries and reconnects", async () => {
    const { client, request, connect } = await setup();
    const result = request();
    const turn = await client.next("your_turn");
    const action = actionFor(turn);
    client.send(action);
    const ack = await client.next("action_ack");
    await result;
    for (let attempt = 0; attempt < 2; attempt++) {
      client.send({ ...action, action: "fold" });
      expect(await client.next("action_rejected")).toMatchObject({ reason: "duplicate_action_id" });
    }
    await client.disconnect();
    const reconnected = await connect();
    await reconnected.next("authenticated");
    reconnected.send(action);
    expect(await reconnected.next("action_ack")).toEqual(ack);
  });

  it("isolates two concurrent tables for the same Agent", async () => {
    const { client, request } = await setup();
    const first = request();
    const turnA = await client.next("your_turn");
    const second = request({ tableId: "table-2", handId: "hand-2", turnId: "turn-2" });
    const turnB = await client.next("your_turn");
    client.send(actionFor(turnA, { table_id: "table-2" }));
    expect(await client.next("action_rejected")).toMatchObject({ reason: "unknown_turn" });
    client.send(actionFor(turnB, { action: "fold" }));
    await client.next("action_ack");
    expect((await second).action.type).toBe("fold");
    client.send(actionFor(turnA));
    await client.next("action_ack");
    expect((await first).action.type).toBe("call");
  });

  it("rejects overlapping requests in the same table without replacing the first promise", async () => {
    const { client, request } = await setup();
    const first = request();
    const turn = await client.next("your_turn");
    await expect(request({ turnId: "another-turn" })).rejects.toThrow("already pending");
    client.send(actionFor(turn));
    await client.next("action_ack");
    expect((await first).action.type).toBe("call");
  });

  it("resends the same pending turn with its original deadline on reconnect", async () => {
    const { client, request, connect } = await setup();
    const result = request();
    const turn = await client.next("your_turn");
    await client.disconnect();
    const reconnected = await connect();
    await reconnected.next("authenticated");
    const resumed = await reconnected.next("pending_decision");
    expect(resumed).toEqual({ ...turn, type: "pending_decision" });
    reconnected.send(actionFor(resumed));
    await reconnected.next("action_ack");
    expect((await result).action.type).toBe("call");
  });

  it("times out at the original deadline even after a reconnect", async () => {
    const { client, request, connect } = await setup();
    const started = Date.now();
    const outcome = request({}, 400).then(() => "accepted", (error) => error.message);
    const turn = await client.next("your_turn");
    await new Promise((resolve) => setTimeout(resolve, 250));
    await client.disconnect();
    const reconnected = await connect();
    await reconnected.next("authenticated");
    const resumed = await reconnected.next("pending_decision");
    expect(resumed.deadline_at).toBe(turn.deadline_at);
    expect(await outcome).toBe("Decision timeout");
    expect(Date.now() - started).toBeLessThan(600);
    reconnected.send(actionFor(turn));
    expect(await reconnected.next("action_rejected")).toMatchObject({ reason: "unknown_turn" });
  });

  it("checks wall-clock expiry even before the timeout callback runs", async () => {
    const { client, request } = await setup();
    const outcome = request().then(() => "accepted", (error) => error.message);
    const turn = await client.next("your_turn");
    const clock = spyOn(Date, "now").mockReturnValue(Date.now() + 10_000);
    try {
      client.send(actionFor(turn));
      expect(await client.next("action_rejected")).toMatchObject({ reason: "decision_expired" });
      expect(await outcome).toBe("Decision timeout");
    } finally {
      clock.mockRestore();
    }
  });

  it("invalidates pending actions when the table stops", async () => {
    const { manager, client, request } = await setup();
    const outcome = request().then(() => "accepted", (error) => error.message);
    const turn = await client.next("your_turn");
    manager.cancelTableDecisions("table-1");
    expect(await outcome).toBe("Table stopped");
    client.send(actionFor(turn));
    expect(await client.next("action_rejected")).toMatchObject({ reason: "unknown_turn" });
  });
});
