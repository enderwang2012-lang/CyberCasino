import { describe, expect, it } from "bun:test";
import {
  bbPer100,
  buyIn,
  cashOut,
  createSeasonEntry,
  settleHandStacks,
  openNextSeason,
  seasonWindow,
  SEASON_LENGTH_MS,
  skim,
} from "./season-ledger";

describe("season ledger", () => {
  it("moves a buy-in from bankroll to the table without minting chips", () => {
    const result = buyIn(createSeasonEntry("s1", "hero", "Hero", "user"));
    expect(result).toEqual({
      ok: true,
      entry: expect.objectContaining({ bankroll: 15_000, tableStack: 5_000 }),
    });
  });

  it("refuses a buy-in below 5000 and keeps the original entry", () => {
    const broke = { ...createSeasonEntry("s1", "hero", "Hero", "user"), bankroll: 4_999, tableStack: 0 };
    expect(buyIn(broke)).toEqual({ ok: false, reason: "insufficient_bankroll", entry: broke });
  });

  it("skims the table back to 15000 and keeps total equity", () => {
    const before = { ...createSeasonEntry("s1", "hero", "Hero", "user"), bankroll: 10_000, tableStack: 18_000 };
    const after = skim(before);
    expect(after.bankroll + after.tableStack).toBe(28_000);
    expect(after.tableStack).toBe(15_000);
  });

  it("returns the whole table stack on cash-out", () => {
    const seated = { ...createSeasonEntry("s1", "hero", "Hero", "user"), bankroll: 15_000, tableStack: 7_500 };
    expect(cashOut(seated)).toEqual(expect.objectContaining({ bankroll: 22_500, tableStack: 0 }));
  });

  it("reports 20 bb/100 after winning 10000 chips over 500 counted hands", () => {
    let entry = createSeasonEntry("s1", "hero", "Hero", "user");
    entry = { ...entry, bankroll: 30_000, countedHands: 500 };
    expect(bbPer100(entry)).toBe(20);
  });

  it("withholds a rank before 500 counted hands", () => {
    const entry = { ...createSeasonEntry("s1", "hero", "Hero", "user"), bankroll: 30_000, countedHands: 499 };
    expect(bbPer100(entry)).toBeNull();
  });

  it("replaces the table stack with the engine result instead of adding the win", () => {
    const seated = { ...createSeasonEntry("s1", "hero", "Hero", "user"), bankroll: 15_000, tableStack: 5_000 };
    expect(settleHandStacks(seated, 5_100)).toEqual(expect.objectContaining({
      bankroll: 15_000,
      tableStack: 5_100,
      countedHands: 1,
    }));
  });

  it("refuses a second buy-in while chips remain on the table", () => {
    const seated = { ...createSeasonEntry("s1", "hero", "Hero", "user"), bankroll: 15_000, tableStack: 5_000 };
    expect(buyIn(seated)).toEqual({ ok: false, reason: "already_seated", entry: seated });
  });

  it("opens the wind-down five minutes before the season ends", () => {
    const start = Date.parse("2026-11-04T00:00:00.000Z");
    const season = seasonWindow(start);
    expect(season.endsAt - season.startedAt).toBe(SEASON_LENGTH_MS);
    expect(season.windingDown(season.endsAt - 300_000)).toBe(true);
    expect(season.windingDown(season.endsAt - 300_001)).toBe(false);
  });

  it("opens the next season at 20000 after the old equity is frozen", () => {
    const cashedOut = cashOut({
      ...createSeasonEntry("s1", "hero", "Hero", "user"),
      bankroll: 15_000,
      tableStack: 15_000,
      countedHands: 500,
    });
    const next = openNextSeason([cashedOut], Date.parse("2026-11-18T00:00:00.000Z"));
    expect(next.frozen[0]).toEqual(expect.objectContaining({ seasonId: "s1", bankroll: 30_000, countedHands: 500 }));
    expect(next.entries[0]).toEqual(expect.objectContaining({
      bankroll: 20_000,
      tableStack: 0,
      countedHands: 0,
    }));
    expect(next.entries[0].seasonId).not.toBe("s1");
  });
});
