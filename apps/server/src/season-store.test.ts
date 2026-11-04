import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buyIn, createSeasonEntry, settleHandStacks } from "./season-ledger";
import { SeasonStore } from "./season-store";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function file(): string {
  const dir = mkdtempSync(join(tmpdir(), "season-"));
  dirs.push(dir);
  return join(dir, "season.json");
}

describe("season store", () => {
  it("keeps the sum of equities unchanged and does not add a win twice", () => {
    const store = SeasonStore.open({ now: Date.parse("2026-11-04T00:00:00.000Z") });
    const hero = buyIn(store.getOrCreate("hero", "Hero", "user")).entry;
    const villain = buyIn(store.getOrCreate("villain", "Villain", "user")).entry;
    const settled = [
      settleHandStacks(hero, hero.tableStack + 100),
      settleHandStacks(villain, villain.tableStack - 100),
    ];
    store.recordHand("table-1", 1, settled);
    store.recordHand("table-1", 1, settled);

    const equity = [store.get("hero"), store.get("villain")]
      .reduce((sum, entry) => sum + (entry?.bankroll ?? 0) + (entry?.tableStack ?? 0), 0);
    expect(equity).toBe(40_000);
    expect(store.get("hero")?.tableStack).toBe(5_100);
    expect(store.get("hero")?.countedHands).toBe(1);
    expect(() => store.recordHand("table-1", 1, [
      settleHandStacks(hero, 9_999),
      villain,
    ])).toThrow(/Conflicting/);
  });

  it("refuses a second table while chips remain on the first", () => {
    const store = SeasonStore.open({ now: Date.parse("2026-11-04T00:00:00.000Z") });
    const hero = buyIn(store.getOrCreate("hero", "Hero", "user")).entry;
    store.recordHand("table-1", 1, [settleHandStacks(hero, 5_000)]);
    expect(() => store.recordHand("table-2", 1, [settleHandStacks(hero, 5_000)])).toThrow(/already has chips/);
  });

  it("cashes table stacks back to the wallet when the process restarts", () => {
    const path = file();
    const started = Date.parse("2026-11-04T00:00:00.000Z");
    const first = SeasonStore.open({ file: path, now: started });
    const hero = buyIn(first.getOrCreate("hero", "Hero", "user")).entry;
    first.recordHand("table-1", 1, [settleHandStacks(hero, 7_500)]);

    const restarted = SeasonStore.open({ file: path, now: started });
    expect(restarted.get("hero")).toEqual(expect.objectContaining({
      bankroll: 22_500,
      tableStack: 0,
      countedHands: 1,
    }));
  });

  it("opens the next season at 20000 instead of adding the old balance", () => {
    const started = Date.parse("2026-11-04T00:00:00.000Z");
    const store = SeasonStore.open({ now: started });
    const hero = store.getOrCreate("hero", "Hero", "user");
    store.recordHand("table-1", 1, [{ ...hero, bankroll: 30_000, tableStack: 0, countedHands: 500 }]);
    store.restoreAfterRestart(started + 14 * 24 * 60 * 60 * 1000);

    expect(store.get("hero")).toEqual(expect.objectContaining({
      bankroll: 20_000,
      tableStack: 0,
      countedHands: 0,
    }));
    expect(store.currentSeasonId()).not.toBe(`season-${started}`);
  });

  it("reports wind-down during the last five minutes and not after rollover", () => {
    const started = Date.parse("2026-11-04T00:00:00.000Z");
    const store = SeasonStore.open({ now: started });
    const ends = started + 14 * 24 * 60 * 60 * 1000;
    expect(store.isWindingDown(ends - 5 * 60 * 1000)).toBe(true);
    expect(store.isWindingDown(ends - 5 * 60 * 1000 - 1)).toBe(false);
    expect(store.isWindingDown(ends)).toBe(false);
  });

  it("ranks 500 hands and withholds a formal place before that", () => {
    const store = SeasonStore.open({ now: Date.parse("2026-11-04T00:00:00.000Z") });
    const ranked = { ...createSeasonEntry(store.currentSeasonId(), "ranked", "Ranked", "user"), bankroll: 30_000, countedHands: 500 };
    const provisional = { ...createSeasonEntry(store.currentSeasonId(), "new", "New", "user"), bankroll: 30_000, countedHands: 499 };
    store.recordHand("table-1", 1, [ranked]);
    store.recordHand("table-1", 2, [provisional]);

    const board = store.leaderboard();
    expect(board.ranked.map((row) => row.agentId)).toEqual(["ranked"]);
    expect(board.ranked[0].bbPer100).toBe(20);
    expect(board.provisional.map((row) => row.agentId)).toEqual(["new"]);
    expect(board.provisional[0].bbPer100).toBeNull();
  });
});
