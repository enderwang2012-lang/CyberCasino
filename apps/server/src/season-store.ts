import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ReplayData } from "@cybercasino/shared";
import {
  bbPer100,
  cashOut,
  createSeasonEntry,
  openNextSeason,
  seasonWindow,
  type SeasonEntry,
} from "./season-ledger";

export interface StoredSeasonEntry extends SeasonEntry {
  tableId?: string;
}

export interface SeasonHandRecord {
  seasonId: string;
  tableId: string;
  handNumber: number;
  stacks: Record<string, number>;
}

export interface SeasonStanding {
  agentId: string;
  displayName: string;
  kind: SeasonEntry["kind"];
  countedHands: number;
  equity: number;
  bbPer100: number | null;
}

export interface CashSittingRecord {
  agentId: string;
  tableId: string;
  endedAt: number;
  countedHands: number;
  netChips: number;
  replayId?: string;
}

interface SeasonFile {
  startedAt: number;
  endsAt: number;
  entries: StoredSeasonEntry[];
  hands: SeasonHandRecord[];
  frozen: StoredSeasonEntry[];
  sittings?: CashSittingRecord[];
  baselines?: Array<{ agentId: string; equity: number; hands: number; tableId?: string }>;
}

export class SeasonStore {
  private startedAt = 0;
  private endsAt = 0;
  private entries = new Map<string, StoredSeasonEntry>();
  private hands = new Map<string, Record<string, number>>();
  private frozen: StoredSeasonEntry[] = [];
  private sittings: CashSittingRecord[] = [];
  private baselines = new Map<string, { equity: number; hands: number; tableId?: string }>();
  private replays = new Map<string, ReplayData>();
  private readonly replayFile?: string;

  constructor(private readonly file?: string) {
    this.replayFile = file ? join(dirname(file), "cash-replays.json") : undefined;
    if (this.replayFile && existsSync(this.replayFile)) {
      const stored = JSON.parse(readFileSync(this.replayFile, "utf-8")) as Record<string, ReplayData>;
      for (const [id, replay] of Object.entries(stored)) this.replays.set(id, replay);
    }
    if (!file || !existsSync(file)) return;
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as SeasonFile;
    this.startedAt = parsed.startedAt;
    this.endsAt = parsed.endsAt;
    this.frozen = parsed.frozen ?? [];
    this.sittings = parsed.sittings ?? [];
    for (const baseline of parsed.baselines ?? []) this.baselines.set(baseline.agentId, baseline);
    for (const entry of parsed.entries ?? []) this.entries.set(entry.agentId, entry);
    for (const hand of parsed.hands ?? []) {
      this.hands.set(this.handKey(hand.seasonId, hand.tableId, hand.handNumber), hand.stacks);
    }
  }

  static open(options: { file?: string; now?: number } = {}): SeasonStore {
    const store = new SeasonStore(options.file);
    store.restoreAfterRestart(options.now ?? Date.now());
    return store;
  }

  currentSeasonId(): string {
    return `season-${this.startedAt}`;
  }

  isWindingDown(now = Date.now()): boolean {
    if (this.startedAt === 0 || this.endsAt === 0) return false;
    return now >= this.endsAt - 5 * 60 * 1000 && now < this.endsAt;
  }

  refresh(now = Date.now()): void {
    this.ensureSeason(now);
  }

  getReplay(replayId: string): ReplayData | undefined {
    const replay = this.replays.get(replayId);
    return replay ? structuredClone(replay) : undefined;
  }

  save(entry: SeasonEntry, replay?: ReplayData): void {
    const previous = this.entries.get(entry.agentId);
    const tableId = entry.tableStack > 0
      ? previous?.tableId
      : undefined;
    if (entry.tableStack > 0 && (!previous || previous.tableStack === 0)) {
      this.baselines.set(entry.agentId, {
        equity: entry.bankroll + entry.tableStack,
        hands: entry.countedHands,
        tableId,
      });
    }
    if (previous && previous.tableStack > 0 && entry.tableStack === 0) {
      const baseline = this.baselines.get(entry.agentId);
      const equity = entry.bankroll + entry.tableStack;
      const endedAt = Date.now();
      const tableId = previous.tableId ?? baseline?.tableId ?? "cash";
      const replayId = replay ? `${tableId}:${entry.agentId}:${endedAt}` : undefined;
      if (replay && replayId) this.rememberReplay(replayId, { ...replay, tableId: replayId });
      this.sittings.unshift({
        agentId: entry.agentId,
        tableId,
        endedAt,
        countedHands: Math.max(0, entry.countedHands - (baseline?.hands ?? entry.countedHands)),
        netChips: baseline ? equity - baseline.equity : 0,
        replayId,
      });
      this.sittings = this.sittings.slice(0, 20);
      this.baselines.delete(entry.agentId);
    }
    this.entries.set(entry.agentId, { ...entry, tableId });
    this.persist();
  }

  recentSittings(agentId: string): CashSittingRecord[] {
    return this.sittings.filter((sitting) => sitting.agentId === agentId);
  }

  get(agentId: string): StoredSeasonEntry | undefined {
    const entry = this.entries.get(agentId);
    return entry ? { ...entry } : undefined;
  }

  getOrCreate(agentId: string, displayName: string, kind: SeasonEntry["kind"], now = Date.now()): StoredSeasonEntry {
    this.ensureSeason(now);
    const existing = this.entries.get(agentId);
    if (existing && existing.seasonId === this.currentSeasonId()) return { ...existing };
    const created = createSeasonEntry(this.currentSeasonId(), agentId, displayName, kind);
    this.entries.set(agentId, created);
    this.persist();
    return { ...created };
  }

  recordHand(tableId: string, handNumber: number, entries: SeasonEntry[]): void {
    if (entries.length === 0) return;
    const seasonId = entries[0].seasonId;
    const key = this.handKey(seasonId, tableId, handNumber);
    const stacks = Object.fromEntries(entries.map((entry) => [entry.agentId, entry.tableStack]));
    const previous = this.hands.get(key);
    if (previous) {
      if (JSON.stringify(previous) !== JSON.stringify(stacks)) {
        throw new Error(`Conflicting season hand ${key}`);
      }
      return;
    }
    for (const entry of entries) {
      const current = this.entries.get(entry.agentId);
      if (current && current.tableStack > 0 && current.tableId && current.tableId !== tableId) {
        throw new Error(`Agent ${entry.agentId} already has chips at ${current.tableId}`);
      }
    }
    for (const entry of entries) {
      this.entries.set(entry.agentId, { ...entry, tableId: entry.tableStack > 0 ? tableId : undefined });
    }
    this.hands.set(key, stacks);
    this.persist();
  }

  cashOutAllSeats(): void {
    for (const [agentId, entry] of this.entries) {
      if (entry.tableStack > 0) this.entries.set(agentId, { ...cashOut(entry), tableId: undefined });
    }
    this.persist();
  }

  restoreAfterRestart(now = Date.now()): void {
    this.cashOutAllSeats();
    this.ensureSeason(now);
  }

  leaderboard(): { seasonId: string; ranked: SeasonStanding[]; provisional: SeasonStanding[] } {
    const ranked: SeasonStanding[] = [];
    const provisional: SeasonStanding[] = [];
    for (const entry of this.entries.values()) {
      if (entry.seasonId !== this.currentSeasonId()) continue;
      const row = this.toStanding(entry);
      if (row.bbPer100 === null) provisional.push(row);
      else ranked.push(row);
    }
    ranked.sort((a, b) => (b.bbPer100 ?? 0) - (a.bbPer100 ?? 0) || b.countedHands - a.countedHands);
    provisional.sort((a, b) => b.countedHands - a.countedHands);
    return { seasonId: this.currentSeasonId(), ranked, provisional };
  }

  private ensureSeason(now: number): void {
    if (this.startedAt !== 0 && now < this.endsAt) return;
    const cashed = [...this.entries.values()].map((entry) => cashOut(entry));
    if (this.startedAt !== 0) {
      const next = openNextSeason(cashed, now);
      this.frozen.push(...next.frozen);
      this.entries = new Map(next.entries.map((entry) => [entry.agentId, entry]));
    }
    const window = seasonWindow(now);
    this.startedAt = window.startedAt;
    this.endsAt = window.endsAt;
    this.persist();
  }

  private toStanding(entry: StoredSeasonEntry): SeasonStanding {
    return {
      agentId: entry.agentId,
      displayName: entry.displayName,
      kind: entry.kind,
      countedHands: entry.countedHands,
      equity: entry.bankroll + entry.tableStack,
      bbPer100: bbPer100(entry),
    };
  }

  private handKey(seasonId: string, tableId: string, handNumber: number): string {
    return `${seasonId}:${tableId}:${handNumber}`;
  }

  private rememberReplay(replayId: string, replay: ReplayData): void {
    this.replays.set(replayId, replay);
    while (this.replays.size > 40) {
      const oldest = this.replays.keys().next().value as string | undefined;
      if (!oldest) break;
      this.replays.delete(oldest);
    }
    this.persistReplays();
  }

  private persistReplays(): void {
    if (!this.replayFile) return;
    mkdirSync(dirname(this.replayFile), { recursive: true });
    writeFileSync(this.replayFile, JSON.stringify(Object.fromEntries(this.replays)));
  }

  private persist(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const hands: SeasonHandRecord[] = [];
    for (const [key, stacks] of this.hands) {
      const [seasonId, tableId, handNumber] = key.split(":");
      hands.push({ seasonId, tableId, handNumber: Number(handNumber), stacks });
    }
    const body: SeasonFile = {
      startedAt: this.startedAt,
      endsAt: this.endsAt,
      entries: [...this.entries.values()],
      hands,
      frozen: this.frozen,
      sittings: this.sittings,
      baselines: [...this.baselines.entries()].map(([agentId, baseline]) => ({ agentId, ...baseline })),
    };
    writeFileSync(this.file, JSON.stringify(body));
  }
}
