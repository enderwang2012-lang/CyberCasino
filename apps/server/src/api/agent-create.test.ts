import { describe, expect, it } from "bun:test";
import type { AgentConfigV2, StrategyConfig } from "@cybercasino/shared";
import { createAgentFromAI } from "./agent-create";
import { createStrategyPackage } from "../agents/strategy-package";

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
  it("defaults new agents to remote WebSocket execution while allowing hosted execution explicitly", () => {
    const remote = createAgentFromAI("user-1", { config: strategy, preview }, () => "agent-1", "soul-1");
    const hosted = createAgentFromAI("user-2", { config: strategy, executionMode: "verified_package", preview }, () => "agent-2", "soul-2");

    expect(remote.executionMode).toBe("remote_agent");
    expect(hosted.executionMode).toBe("verified_package");
  });

  it("keeps agent identity stable when activating a new strategy version", () => {
    const first = createAgentFromAI("user-1", { config: strategy, preview }, () => "agent-1", "soul-1");
    const upgraded = createAgentFromAI("user-1", { config: strategy, preview }, () => "agent-2", "soul-1", undefined, first);

    expect(upgraded.id).toBe("agent-1");
    expect(upgraded.strategyPackage?.manifest.version).toBe(2);
    expect(upgraded.strategyPackage?.manifest.basedOnVersion).toBe(1);
    expect(upgraded.strategyVersion).toBe(2);
    expect(upgraded.strategyVersions?.map((version) => version.version)).toEqual([1, 2]);
  });

  const existingCases: Array<{
    name: string;
    fields: Partial<AgentConfigV2>;
    previousVersion: number;
    nextVersion: number;
  }> = [
    {
      name: "quick-created agent after style v3 without a package",
      fields: { strategyVersion: 3 },
      previousVersion: 3,
      nextVersion: 4,
    },
    {
      name: "style v3 with an older v1 package",
      fields: {
        strategyVersion: 3,
        strategyPackage: createStrategyPackage(strategy, { version: 1, createdBy: "user_upload" }),
      },
      previousVersion: 3,
      nextVersion: 4,
    },
    {
      name: "package v5 ahead of the active counter",
      fields: {
        strategyVersion: 3,
        strategyPackage: createStrategyPackage(strategy, { version: 5, createdBy: "user_upload" }),
      },
      previousVersion: 5,
      nextVersion: 6,
    },
    {
      name: "pending style v5 ahead of active v3 and package v1",
      fields: {
        strategyVersion: 3,
        strategyPackage: createStrategyPackage(strategy, { version: 1, createdBy: "user_upload" }),
        pendingStrategyVersion: 5,
        pendingStylePrompt: "patient",
      },
      previousVersion: 5,
      nextVersion: 6,
    },
    {
      name: "recorded version v7 ahead of the current package and counters",
      fields: {
        strategyVersion: 3,
        strategyPackage: createStrategyPackage(strategy, { version: 1, createdBy: "user_upload" }),
        pendingStrategyVersion: 4,
        strategyVersions: [{ version: 7, packageId: "agent-1-v7", createdAt: 1 }],
      },
      previousVersion: 7,
      nextVersion: 8,
    },
  ];

  for (const { name, fields, previousVersion, nextVersion } of existingCases) {
    it.each(["config", "package"] as const)(`advances ${name} for %s submission`, (submission) => {
      const existing: AgentConfigV2 = {
        id: "agent-1",
        userId: "user-1",
        name: "Hero",
        avatar: "",
        strategy,
        executionMode: "remote_agent",
        soulKey: "soul-1",
        createdAt: 1,
        updatedAt: 2,
        ...fields,
      };
      const before = structuredClone(existing);
      const incomingPackage = createStrategyPackage(strategy, {
        version: 1,
        packageId: "uploaded-package",
        createdBy: "user_upload",
      });
      const upgraded = createAgentFromAI(
        "user-1",
        submission === "config" ? { config: strategy, preview } : { strategyPackage: incomingPackage, preview },
        () => { throw new Error("An existing Agent must retain its identity"); },
        undefined,
        undefined,
        existing,
      );

      expect(upgraded.strategyVersion).toBe(nextVersion);
      expect(upgraded.strategyPackage?.manifest).toMatchObject({
        agentId: "agent-1",
        packageId: `agent-1-v${nextVersion}`,
        version: nextVersion,
        basedOnVersion: previousVersion,
      });
      expect(upgraded.strategyVersions?.at(-1)).toMatchObject({
        version: nextVersion,
        basedOnVersion: previousVersion,
      });
      expect(upgraded).toMatchObject({
        id: "agent-1",
        soulKey: "soul-1",
        createdAt: 1,
        executionMode: "remote_agent",
      });
      expect(existing).toEqual(before);
      expect(incomingPackage.manifest.version).toBe(1);
    });
  }

  it.each([false, true])("preserves initial version selection for a legacy unversioned Agent: %s", (legacy) => {
    const existing: AgentConfigV2 | undefined = legacy ? {
      id: "agent-1",
      userId: "user-1",
      name: "Hero",
      avatar: "",
      strategy,
      createdAt: 1,
      updatedAt: 1,
    } : undefined;
    const incomingPackage = createStrategyPackage(strategy, {
      version: 7,
      packageId: "uploaded-v7",
      createdBy: "user_upload",
    });
    const fromConfig = createAgentFromAI(
      "user-1", { config: strategy, preview }, () => "agent-1", undefined, undefined, existing,
    );
    const fromPackage = createAgentFromAI(
      "user-1", { strategyPackage: incomingPackage, preview }, () => "agent-1", undefined, undefined, existing,
    );

    expect(fromConfig.strategyVersion).toBe(1);
    expect(fromConfig.strategyPackage?.manifest.basedOnVersion).toBeUndefined();
    expect(fromPackage.strategyVersion).toBe(7);
    expect(fromPackage.strategyPackage?.manifest).toMatchObject({
      version: 7,
      packageId: legacy ? "agent-1-v7" : "uploaded-v7",
    });
    expect(fromPackage.strategyPackage?.manifest.basedOnVersion).toBeUndefined();
    expect(fromPackage.strategyVersions?.map((entry) => entry.version)).toEqual([7]);
  });

  it("assigns the next existing version even when an upload declares a higher version", () => {
    const first = createAgentFromAI("user-1", { config: strategy, preview }, () => "agent-1");
    const incomingPackage = createStrategyPackage(strategy, { version: 99, createdBy: "user_upload" });
    const upgraded = createAgentFromAI(
      "user-1", { strategyPackage: incomingPackage, preview }, () => "agent-2", undefined, undefined, first,
    );

    expect(upgraded.strategyVersion).toBe(2);
    expect(upgraded.strategyPackage?.manifest.basedOnVersion).toBe(1);
    expect(upgraded.strategyVersions?.map((entry) => entry.version)).toEqual([1, 2]);
  });
});
