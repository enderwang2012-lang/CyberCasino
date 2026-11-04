import { describe, expect, it } from "bun:test";
import type { GameEvent, TableConfig } from "@cybercasino/shared";
import { TableInstance } from "./table-instance";
import { wsAgentManager } from "./agents/websocket-agent-manager";
import { createAgentHarness, actionFor, type WireMessage } from "./test-utils/ws-agent-client";

const config: TableConfig = {
  name: "Protocol v1 acceptance",
  mode: "ranked",
  smallBlind: 1,
  bigBlind: 2,
  startingChips: 5000,
  maxPlayers: 3,
  handLimit: 100,
  interHandDelayMs: 0,
  actionDelayMs: 0,
  commentaryMode: "rule",
  blindSchedule: { handsPerLevel: 100, levels: [{ small: 1, big: 2 }] },
};

describe("external Agent continuous run", () => {
  it("rejects invalid bounded-run configuration", () => {
    expect(() => new TableInstance("invalid", { ...config, handLimit: 0 })).toThrow();
    expect(() => new TableInstance("invalid", { ...config, actionDelayMs: -1 })).toThrow();
  });

  it("plays 100 real hands, reconnects mid-turn, and records exactly one execution per action", async () => {
    const harness = await createAgentHarness(wsAgentManager);
    const table = new TableInstance("endurance-100", config);
    const clients = [];
    const events: GameEvent[] = [];
    const acceptedIds = new Set<string>();
    const contexts = new Set<string>();
    let finished = false;
    let reconnects = 0;
    let retries = 0;
    let staleRejected = 0;
    let snapshotResyncs = 0;
    let snapshotReconnects = 0;
    let observerSnapshots = 0;
    let lastSnapshotSeq = 0;
    let confirmAll!: () => void;
    const allAcknowledged = new Promise<void>((resolve) => { confirmAll = resolve; });
    const workers: Promise<void>[] = [];
    table.onEvent((event) => {
      events.push(event);
      if (event.type === "tournament-complete") finished = true;
    });

    try {
      for (let number = 1; number <= 3; number++) {
        const id = `test-agent-${number}`;
        const client = await harness.connect(id);
        await client.next("authenticated");
        clients.push(client);
        expect(table.sit({ id, userId: `user-${number}`, name: id, avatar: "" },
          "remote_agent", 1)).toBe(true);
      }

      for (let index = 0; index < clients.length; index++) {
        workers.push((async () => {
          let client = clients[index];
          let previous: WireMessage | undefined;
          try {
            while (!finished) {
              let turn = await client.next("your_turn", 5000);
              if (index === 0 && turn.handIndex === 50 && reconnects === 0) {
                const original = turn;
                await client.disconnect();
                client = await harness.connect("test-agent-1");
                await client.next("authenticated");
                turn = await client.next("pending_decision");
                expect(turn).toEqual({ ...original, type: "pending_decision" });
                const reconnectSnapshot = await client.next("table_snapshot");
                expect(reconnectSnapshot).toMatchObject({
                  table_id: "endurance-100",
                  table_seq: expect.any(Number),
                  is_current_actor: true,
                  turn: {
                    turn_id: original.turn_id,
                    turn_token: original.turn_token,
                    deadline_at: original.deadline_at,
                  },
                });
                snapshotReconnects++;
                reconnects++;
              }
              if (index === 0 && turn.handIndex === 50 && snapshotResyncs === 0) {
                client.send({ type: "resync", table_id: "endurance-100", last_seen_seq: 0 });
                const snapshot = await client.next("table_snapshot");
                expect(snapshot).toMatchObject({
                  table_id: "endurance-100",
                  sync_mode: "full",
                  unchanged: false,
                  is_current_actor: true,
                  turn: {
                    turn_id: turn.turn_id,
                    turn_token: turn.turn_token,
                    deadline_at: turn.deadline_at,
                  },
                });
                expect(snapshot.table_seq).toBeGreaterThan(lastSnapshotSeq);
                expect(snapshot.state_hash).toMatch(/^[a-f0-9]{64}$/);
                expect(snapshot.players.every((player: WireMessage) => !("holeCards" in player))).toBe(true);
                lastSnapshotSeq = snapshot.table_seq;

                client.send({
                  type: "resync",
                  table_id: "endurance-100",
                  last_seen_seq: snapshot.table_seq,
                });
                expect(await client.next("table_snapshot")).toMatchObject({
                  table_seq: snapshot.table_seq,
                  state_hash: snapshot.state_hash,
                  unchanged: true,
                });

                clients[1].send({ type: "resync", table_id: "endurance-100" });
                const observerSnapshot = await clients[1].next("table_snapshot");
                expect(observerSnapshot).toMatchObject({
                  table_id: "endurance-100",
                  is_current_actor: false,
                  valid_actions: [],
                });
                expect(observerSnapshot).not.toHaveProperty("turn");
                observerSnapshots++;
                snapshotResyncs++;
              }
              if (index === 0 && turn.handIndex === 51 && staleRejected === 0 && previous) {
                client.send({ ...previous, client_action_id: "late-action-from-previous-turn" });
                expect(await client.next("action_rejected")).toMatchObject({ reason: "unknown_turn" });
                staleRejected++;
              }
              expect(turn.myCards).toHaveLength(2);
              expect(turn.players.every((player: WireMessage) => !("holeCards" in player))).toBe(true);
              expect(contexts.has(turn.turn_id)).toBe(false);
              contexts.add(turn.turn_id);
              const action = actionFor(turn, {
                action: turn.validActions.includes("check") ? "check" : "call",
                thought: "Protocol acceptance client",
              });
              client.send(action);
              const ack = await client.next("action_ack");
              acceptedIds.add(ack.client_action_id);
              if (acceptedIds.size === 1200) confirmAll();
              if (turn.handIndex % 17 === 0) {
                client.send(action);
                expect(await client.next("action_ack")).toEqual(ack);
                retries++;
              }
              previous = action;
            }
          } catch (error) {
            if (!finished || !(error instanceof Error) || error.message !== "Client closed") throw error;
          }
        })());
      }
      const match = table.start("en");
      // Surface a client failure immediately instead of waiting for fallback.
      await Promise.race([Promise.all([match, allAcknowledged]), ...workers.map((worker) =>
        worker.then(() => new Promise<never>(() => {})))]);
      await match;
      await harness.close();
      await Promise.all(workers);

      const replay = table.getReplayData();
      const completed = events.filter((event) => event.type === "hand-complete");
      const actions = events.filter((event) => event.type === "action-taken");
      const audits = table.getAuditRecords();
      expect(table.getStatus()).toBe("finished");
      expect(replay.hands).toHaveLength(100);
      expect(replay.totalHands).toBe(100);
      expect(completed).toHaveLength(100);
      expect(completed.every((event) =>
        event.players.reduce((sum, player) => sum + player.chips, 0) === 15_000)).toBe(true);
      expect(actions).toHaveLength(1200); // 3 players * 4 streets * 100 hands
      expect(acceptedIds.size).toBe(1200);
      expect(audits).toHaveLength(1200);
      expect(audits.every((audit) => audit.runtime === "remote_websocket"
        && audit.strategyVersion === 1 && audit.tableId === "endurance-100"
        && audit.clientActionId && acceptedIds.has(audit.clientActionId)
        && audit.turnId && contexts.has(audit.turnId))).toBe(true);
      expect(replay.hands.every((hand) => hand.handId
        && hand.actions.length === 12 && hand.actions.every((action) => action.turnId))).toBe(true);
      expect(replay.players.every((player) => player.strategyVersion === 1)).toBe(true);
      expect(replay.rankings).toHaveLength(3);
      expect(reconnects).toBe(1);
      expect(snapshotReconnects).toBe(1);
      expect(snapshotResyncs).toBe(1);
      expect(observerSnapshots).toBe(1);
      expect(staleRejected).toBe(1);
      expect(retries).toBeGreaterThan(0);
      console.log(`[acceptance] hands=${completed.length} actions=${actions.length} `
        + `audits=${audits.length} reconnects=${reconnects} retries=${retries} `
        + `stale_rejected=${staleRejected} snapshots=${snapshotResyncs} chips=15000`);
    } finally {
      table.stop();
      finished = true;
      await harness.close();
      await Promise.allSettled(workers);
    }
  }, 15_000);

  it("stops a live table without applying the pending remote action", async () => {
    const harness = await createAgentHarness(wsAgentManager);
    const table = new TableInstance("stop-test", config);
    try {
      const client = await harness.connect();
      await client.next("authenticated");
      table.sit({ id: "test-agent-1", userId: "user-1", name: "A", avatar: "" });
      table.sit({ id: "test-agent-2", userId: "user-2", name: "B", avatar: "" });
      const second = await harness.connect("test-agent-2");
      await second.next("authenticated");
      // In heads-up play, the dealer (first seat) acts first.
      const match = table.start();
      const turn = await client.next("your_turn");
      table.stop();
      await match;
      client.send(actionFor(turn));
      expect(await client.next("action_rejected")).toMatchObject({ reason: "unknown_turn" });
      expect(table.getAuditRecords()).toEqual([]);
    } finally {
      table.stop();
      await harness.close();
    }
  });
});
