import { describe, expect, it } from "bun:test";
import type { ExternalAgentMatchResult, ReplayData } from "@cybercasino/shared";
import { matchResultMessageFor } from "./match-result-message";

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
});
