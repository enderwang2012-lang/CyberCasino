export const SEASON_STARTING_BANKROLL = 20_000;
export const CASH_BUY_IN = 5_000;
export const CASH_TABLE_CAP = 15_000;
export const CASH_BIG_BLIND = 100;
export const CASH_SMALL_BLIND = 50;
export const SEASON_MIN_HANDS = 500;
export const SEASON_LENGTH_MS = 14 * 24 * 60 * 60 * 1000;
export const SEASON_WIND_DOWN_MS = 300_000;

export interface SeasonEntry {
  seasonId: string;
  agentId: string;
  displayName: string;
  kind: "user" | "preset";
  bankroll: number;
  tableStack: number;
  countedHands: number;
}

export type BuyInResult =
  | { ok: true; entry: SeasonEntry }
  | { ok: false; reason: "insufficient_bankroll" | "already_seated"; entry: SeasonEntry };

export function createSeasonEntry(
  seasonId: string,
  agentId: string,
  displayName: string,
  kind: SeasonEntry["kind"],
): SeasonEntry {
  return {
    seasonId,
    agentId,
    displayName,
    kind,
    bankroll: SEASON_STARTING_BANKROLL,
    tableStack: 0,
    countedHands: 0,
  };
}

export function buyIn(entry: SeasonEntry): BuyInResult {
  if (entry.tableStack > 0) return { ok: false, reason: "already_seated", entry };
  if (entry.bankroll < CASH_BUY_IN) return { ok: false, reason: "insufficient_bankroll", entry };
  return {
    ok: true,
    entry: {
      ...entry,
      bankroll: entry.bankroll - CASH_BUY_IN,
      tableStack: entry.tableStack + CASH_BUY_IN,
    },
  };
}

export function skim(entry: SeasonEntry): SeasonEntry {
  if (entry.tableStack <= CASH_TABLE_CAP) return { ...entry };
  const excess = entry.tableStack - CASH_TABLE_CAP;
  return {
    ...entry,
    bankroll: entry.bankroll + excess,
    tableStack: CASH_TABLE_CAP,
  };
}

export function cashOut(entry: SeasonEntry): SeasonEntry {
  return {
    ...entry,
    bankroll: entry.bankroll + entry.tableStack,
    tableStack: 0,
  };
}

export function settleHandStacks(entry: SeasonEntry, tableStackAfterHand: number): SeasonEntry {
  return {
    ...entry,
    tableStack: tableStackAfterHand,
    countedHands: entry.countedHands + 1,
  };
}

export function bbPer100(entry: SeasonEntry): number | null {
  if (entry.countedHands < SEASON_MIN_HANDS) return null;
  const net = entry.bankroll + entry.tableStack - SEASON_STARTING_BANKROLL;
  return (net / CASH_BIG_BLIND / entry.countedHands) * 100;
}

export function seasonWindow(startedAt: number): {
  startedAt: number;
  endsAt: number;
  windingDown: (now: number) => boolean;
} {
  const endsAt = startedAt + SEASON_LENGTH_MS;
  return {
    startedAt,
    endsAt,
    windingDown(now: number) {
      return now >= endsAt - SEASON_WIND_DOWN_MS;
    },
  };
}

export function openNextSeason(settledEntries: SeasonEntry[], startedAt: number): {
  frozen: SeasonEntry[];
  entries: SeasonEntry[];
} {
  if (settledEntries.some((entry) => entry.tableStack !== 0)) {
    throw new Error("next season requires every stack to be cashed out");
  }
  const seasonId = `season-${startedAt}`;
  return {
    frozen: settledEntries.map((entry) => ({ ...entry })),
    entries: settledEntries.map((entry) => createSeasonEntry(
      seasonId,
      entry.agentId,
      entry.displayName,
      entry.kind,
    )),
  };
}
