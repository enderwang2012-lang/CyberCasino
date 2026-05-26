import { describe, expect, it } from "bun:test";
import type { StrategyConfig } from "@cybercasino/shared";
import { createAgentFromAI } from "./agent-create";

const strategy = {
  preflop: { ranges: {}, sizing: { openRaise: "2.5bb" } },
  postflop: [],
} as unknown as StrategyConfig;

const preview = {
  name: "Hero",
  description: "test",
  sampleThoughts: ["think"],
  playStyle: "TAG",
};

describe("agent strategy versioning", () => {
  it("keeps agent identity stable when activating a new strategy version", () => {
    const first = createAgentFromAI("user-1", { config: strategy, preview }, () => "agent-1", "soul-1");
    const upgraded = createAgentFromAI("user-1", { config: strategy, preview }, () => "agent-2", "soul-1", undefined, first);

    expect(upgraded.id).toBe("agent-1");
    expect(upgraded.strategyPackage?.manifest.version).toBe(2);
    expect(upgraded.strategyPackage?.manifest.basedOnVersion).toBe(1);
    expect(upgraded.strategyVersion).toBe(2);
    expect(upgraded.strategyVersions?.map((version) => version.version)).toEqual([1, 2]);
  });
});
