import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReplayData, TableInfo } from "@cybercasino/shared";
import { calculateLeaderboard } from "./stores";

describe("leaderboard", () => {
  it("includes preset Agents in the same standings as user Agents", () => {
    const replay: ReplayData = {
      tableId: "table-1",
      tableName: "Ranked Table",
      config: {} as ReplayData["config"],
      players: [
        { id: "preset-1", name: "Preset Agent", avatar: "♠", type: "builtin" },
        { id: "user-1", name: "User Agent", avatar: "♥", type: "custom", strategyVersion: 2 },
      ],
      hands: [],
      rankings: [
        { playerId: "preset-1", position: 1 },
        { playerId: "user-1", position: 2 },
      ],
      totalHands: 1,
    };

    const standings = calculateLeaderboard([{
      info: { id: "table-1", finishedAt: 1 } as TableInfo,
      events: replay,
    }]);

    expect(standings.map((standing) => standing.agentId)).toEqual(["preset-1", "user-1"]);
    expect(standings[0]).toMatchObject({
      name: "Preset Agent",
      gamesPlayed: 1,
      wins: 1,
    });
    expect(standings[1]).toMatchObject({
      name: "User Agent",
      gamesPlayed: 1,
      activeStrategyVersion: 2,
    });
  });

  it("ignores exhibition matches", () => {
    const replay: ReplayData = {
      tableId: "showcase",
      tableName: "Showcase",
      config: {} as ReplayData["config"],
      players: [
        { id: "preset-1", name: "Preset A", avatar: "♠", type: "builtin" },
        { id: "preset-2", name: "Preset B", avatar: "♥", type: "builtin" },
      ],
      hands: [],
      rankings: [
        { playerId: "preset-1", position: 1 },
        { playerId: "preset-2", position: 2 },
      ],
      totalHands: 1,
    };

    expect(calculateLeaderboard([{
      info: { id: "showcase", finishedAt: 1, config: { mode: "exhibition" } } as TableInfo,
      events: replay,
    }])).toEqual([]);
  });
});

it("restores file-backed users by userId when the persisted format is an array", async () => {
  const dataDir = await mkdtemp(join("/tmp", "cybercasino-stores-"));
  try {
    await writeFile(join(dataDir, "users.json"), JSON.stringify([{
      userId: "github:restored",
      name: "Restored",
      avatar: "",
      provider: "github",
      createdAt: 1,
    }]));

    // The module reads its data directory at import time, so this assertion
    // targets the persisted shape through a small fresh-process fixture.
    const storesPath = join(import.meta.dirname, "stores.ts");
    const fixture = await Bun.$`bun --no-env-file -e ${`
      const { UserStore, initStores } = await import(${JSON.stringify(storesPath)});
      await initStores();
      if (new UserStore().get("github:restored")?.name !== "Restored") process.exit(2);
    `}`.env({
      ...process.env,
      CYBERCASINO_DATA_DIR: dataDir,
      DATABASE_URL: "",
    }).quiet();
    expect(fixture.exitCode).toBe(0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
