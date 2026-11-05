import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import type { SessionResultMessage } from "./match-result-message";
import { SessionResultStore } from "./session-result-store";

function message(endedAt: number): SessionResultMessage {
  return {
    type: "session_result",
    protocol_version: 1,
    table_id: "cash",
    season_id: "season-1",
    started_at: 1,
    ended_at: endedAt,
    counted_hands: 2,
    sit_equity: 20_000,
    equity: 19_000,
    net_chips: -1_000,
    reason: "left",
    replay: {
      tableId: "cash",
      tableName: "现金桌",
      config: {} as SessionResultMessage["replay"]["config"],
      players: [],
      hands: [],
      rankings: [],
      totalHands: 0,
    },
  };
}

describe("session result store", () => {
  it("keeps a result across a reload until the agent acknowledges it", () => {
    const file = join(mkdtempSync(join(tmpdir(), "session-results-")), "session-results.json");
    const store = new SessionResultStore(file);
    store.enqueue("agent-1", message(10));

    const reloaded = new SessionResultStore(file);
    expect(reloaded.list("agent-1")).toHaveLength(1);
    reloaded.acknowledge("agent-1", "cash", 10);
    expect(reloaded.list("agent-1")).toHaveLength(0);
    expect(new SessionResultStore(file).list("agent-1")).toHaveLength(0);
  });
});
