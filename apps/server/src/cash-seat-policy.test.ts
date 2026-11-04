import { describe, expect, it } from "bun:test";
import { planCashSeats, type CashTableSnapshot, type WaitingAgent } from "./cash-seat-policy";

const user = (agentId: string, enteredAt: number): WaitingAgent => ({
  userId: `user-${agentId}`,
  agentId,
  enteredAt,
  kind: "user",
});

const preset = (agentId: string): WaitingAgent => ({
  userId: `builtin:${agentId}`,
  agentId,
  enteredAt: 0,
  kind: "preset",
});

const table = (id: string, seats: CashTableSnapshot["seats"]): CashTableSnapshot => ({ id, seats });

describe("planCashSeats", () => {
  it("seats a waiting user into the fullest open table", () => {
    const moves = planCashSeats({
      tables: [
        table("short", [{ agentId: "u1", kind: "user", userId: "user-u1" }]),
        table("fuller", [
          { agentId: "u2", kind: "user", userId: "user-u2" },
          { agentId: "p1", kind: "preset" },
        ]),
      ],
      waitingUsers: [user("u3", 10)],
      idlePresets: [],
    });

    const fuller = moves.find((move) => move.tableId === "fuller");
    expect(fuller?.sit.map((agent) => agent.agentId)).toEqual(["u3"]);
    expect(fuller?.standAgentIds).toEqual([]);
  });

  it("replaces one preset when every current seat is taken", () => {
    const moves = planCashSeats({
      tables: [table("main", [
        { agentId: "u1", kind: "user", userId: "user-u1" },
        ...["p1", "p2", "p3", "p4", "p5"].map((agentId) => ({ agentId, kind: "preset" as const })),
      ])],
      waitingUsers: [user("u2", 10)],
      idlePresets: [],
    });

    expect(moves).toEqual([
      expect.objectContaining({
        tableId: "main",
        standAgentIds: ["p1"],
        open: false,
      }),
    ]);
    expect(moves[0].sit.map((agent) => agent.agentId)).toEqual(["u2"]);
  });

  it("opens a new table for a seventh user and an idle preset", () => {
    const moves = planCashSeats({
      tables: [table("full", ["u1", "u2", "u3", "u4", "u5", "u6"].map((agentId) => ({
        agentId,
        kind: "user" as const,
        userId: `user-${agentId}`,
      })))],
      waitingUsers: [user("u7", 10)],
      idlePresets: [preset("p1")],
    });

    expect(moves).toEqual([
      { tableId: "", sit: [user("u7", 10), preset("p1")], standAgentIds: [], open: true },
    ]);
  });

  it("keeps a lone waiting user unseated when nobody can join them", () => {
    expect(planCashSeats({
      tables: [table("full", ["u1", "u2", "u3", "u4", "u5", "u6"].map((agentId) => ({
        agentId,
        kind: "user" as const,
        userId: `user-${agentId}`,
      })))],
      waitingUsers: [user("u7", 10)],
      idlePresets: [],
    })).toEqual([]);
  });

  it("opens one spectator table from idle presets when no user is waiting", () => {
    const moves = planCashSeats({
      tables: [],
      waitingUsers: [],
      idlePresets: ["p1", "p2", "p3", "p4", "p5", "p6"].map(preset),
    });

    expect(moves).toHaveLength(1);
    expect(moves[0].open).toBe(true);
    expect(moves[0].sit.map((agent) => agent.agentId)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);
  });

  it("does not seat a preset that is already at a table", () => {
    const moves = planCashSeats({
      tables: [table("busy", [{ agentId: "p1", kind: "preset" }])],
      waitingUsers: [user("u1", 1)],
      idlePresets: [preset("p1"), preset("p2")],
    });

    const seated = moves.flatMap((move) => move.sit.map((agent) => agent.agentId));
    expect(seated).toEqual(["u1", "p2"]);
    expect(seated.filter((agentId) => agentId === "p1")).toEqual([]);
  });
});
