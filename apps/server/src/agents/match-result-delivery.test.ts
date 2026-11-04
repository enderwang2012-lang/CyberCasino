import { describe, expect, it } from "bun:test";
import type { ExternalAgentMatchResult } from "@cybercasino/shared";
import { MatchResultDeliveryQueue } from "./match-result-delivery";

function result(tableId: string): ExternalAgentMatchResult {
  return {
    type: "match_result",
    protocol_version: 1,
    table_id: tableId,
    finished_at: 123,
    total_hands: 1,
    rankings: [],
    players: [],
    replay: {} as ExternalAgentMatchResult["replay"],
  };
}

describe("MatchResultDeliveryQueue", () => {
  it("buffers results while an Agent is offline and drains them after reconnect", () => {
    const queue = new MatchResultDeliveryQueue();
    const completed = result("table-1");

    queue.enqueue(["agent-1"], completed);

    expect(queue.drain("agent-1")).toEqual([completed]);
    expect(queue.drain("agent-1")).toEqual([]);
  });

  it("keeps one result per Agent and table when delivery is retried", () => {
    const queue = new MatchResultDeliveryQueue();
    const first = result("table-1");
    const replacement = { ...first, total_hands: 2 };

    queue.enqueue(["agent-1"], first);
    queue.enqueue(["agent-1"], replacement);

    expect(queue.drain("agent-1")).toEqual([replacement]);
  });
});
