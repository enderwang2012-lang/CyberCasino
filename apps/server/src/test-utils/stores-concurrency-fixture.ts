import assert from "node:assert/strict";
import { mock } from "bun:test";
import type { AgentActionAudit, ReplayData, TableConfig, TableInfo } from "@cybercasino/shared";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const transactions: Array<ReturnType<typeof deferred>> = [];
mock.module("../db", () => ({
  sql: {
    begin: async (work: (tx: () => Promise<unknown[]>) => Promise<unknown>) => {
      const commit = deferred();
      transactions.push(commit);
      // Attach the commit rejection immediately, including rollback scenarios.
      await Promise.all([work(async () => []), commit.promise]);
    },
  },
  ensureSchema: async () => {},
}));

const { GameHistoryStore } = await import("../stores");
const store = new GameHistoryStore();
const config: TableConfig = {
  name: "Concurrent archive",
  mode: "ranked",
  smallBlind: 50,
  bigBlind: 100,
  startingChips: 5000,
  maxPlayers: 2,
};

function match(id: string, finishedAt: number) {
  const info: TableInfo = {
    id, name: id, config, playerCount: 2, handNumber: 1,
    status: "finished", seats: [], finishedAt,
  };
  const replay: ReplayData = {
    tableId: id, tableName: id, config,
    players: [
      { id: "hero", name: "Hero", avatar: "", type: "custom" },
      { id: "preset", name: "Preset", avatar: "", type: "builtin" },
    ],
    hands: [],
    rankings: [{ playerId: "hero", position: 1 }, { playerId: "preset", position: 2 }],
    totalHands: 1,
  };
  const audits: AgentActionAudit[] = [{
    agentId: "hero", tableId: id, handNumber: 1, street: "preflop",
    tableMode: "ranked", executionMode: "remote_agent", runtime: "remote_websocket",
    stateScope: "visible_information_only", validActions: ["check"],
    proposedAction: { type: "check" }, executedAction: { type: "check" },
    validation: { accepted: true, corrections: [] }, decidedAt: finishedAt,
  }];
  return { info, replay, audits };
}

const first = match("match-A", 1);
const second = match("match-B", 2);
const save = (value: ReturnType<typeof match>) =>
  store.saveCompletedMatch(value.info, value.replay, value.audits);
const scenario = process.argv[2];

if (scenario === "replacement") {
  const original = save(first);
  transactions[0].resolve();
  await original;
  assert.equal(store.getLeaderboard().find((entry) => entry.agentId === "hero")?.wins, 1);
  const corrected = match("match-A", 1);
  corrected.replay.rankings = [
    { playerId: "preset", position: 1 }, { playerId: "hero", position: 2 },
  ];
  const replacement = save(corrected);
  transactions[1].resolve();
  await replacement;
  assert.equal(store.getAll().length, 1);
  assert.equal(store.getLeaderboard().find((entry) => entry.agentId === "hero")?.wins, 0);
  assert.equal(store.getRecentMatchesForAgent("hero")[0].position, 2);
} else {
  const savingFirst = save(first);
  // Attach the rejection handler before simulating the failed transaction.
  const firstRejected = scenario === "retry"
    ? assert.rejects(savingFirst, /transaction rolled back/)
    : undefined;
  const savingSecond = save(second);
  assert.deepEqual(store.getAll(), []);
  assert.equal(store.getAudits("match-A"), undefined);
  assert.deepEqual(store.getLeaderboard(), []);

  if (scenario === "retry") {
    transactions[0].reject(new Error("transaction rolled back"));
    await firstRejected;
    assert.equal(store.get("match-A"), undefined);
    assert.equal(store.getAudits("match-A"), undefined);
    const retried = save(first);
    transactions[1].resolve();
    await savingSecond;
    assert.equal(store.getLeaderboard().find((entry) => entry.agentId === "hero")?.gamesPlayed, 1);
    transactions[2].resolve();
    await retried;
  } else {
    assert.ok(scenario === "in-order" || scenario === "reverse-order");
    const order = scenario === "in-order" ? [0, 1] : [1, 0];
    const saves = [savingFirst, savingSecond];
    transactions[order[0]].resolve();
    await saves[order[0]];
    assert.equal(store.getAll().length, 1);
    assert.equal(store.getLeaderboard().find((entry) => entry.agentId === "hero")?.gamesPlayed, 1);
    transactions[order[1]].resolve();
    await saves[order[1]];
  }

  assert.deepEqual(store.getAll().map(({ info }) => info.id).sort(), ["match-A", "match-B"]);
  for (const value of [first, second]) {
    assert.deepEqual(store.get(value.info.id), { info: value.info, events: value.replay });
    assert.deepEqual(store.getAudits(value.info.id), value.audits);
  }
  assert.deepEqual(store.getRecentMatchesForAgent("hero").map((entry) => entry.tableId), [
    "match-B", "match-A",
  ]);
  assert.equal(store.getLeaderboard().find((entry) => entry.agentId === "hero")?.gamesPlayed, 2);

  const duplicate = save(first);
  transactions.at(-1)!.resolve();
  await duplicate;
  assert.equal(store.getAll().length, 2);
  assert.equal(store.getLeaderboard().find((entry) => entry.agentId === "hero")?.gamesPlayed, 2);
}
