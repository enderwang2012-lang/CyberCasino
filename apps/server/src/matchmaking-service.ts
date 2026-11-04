import type {
  AgentConfigV2,
  MatchmakingErrorCode,
  MatchmakingState,
} from "@cybercasino/shared";

export interface MatchEntry {
  userId: string;
  agent: AgentConfigV2;
  enteredAt: number;
  autoRequeue: boolean;
  tableId?: string;
}

export interface MatchBatch {
  batchId: string;
  entries: MatchEntry[];
}

export type MatchmakingJoinResult =
  | {
      accepted: true;
      state: MatchmakingState;
      batch?: MatchBatch;
    }
  | {
      accepted: false;
      code: MatchmakingErrorCode;
      state: MatchmakingState;
    };

interface MatchmakingOptions {
  requiredPlayers?: number;
  now?: () => number;
}

const DEFAULT_REQUIRED_PLAYERS = 6;

export class MatchmakingService {
  private readonly requiredPlayers: number;
  private readonly now: () => number;
  private queue: MatchEntry[] = [];
  private readonly pendingBatches = new Map<string, MatchEntry[]>();
  private readonly activeTables = new Map<string, MatchEntry[]>();
  private readonly activeByUser = new Map<string, MatchEntry>();
  private nextBatchId = 1;

  constructor(options: MatchmakingOptions = {}) {
    this.requiredPlayers = options.requiredPlayers ?? DEFAULT_REQUIRED_PLAYERS;
    if (!Number.isSafeInteger(this.requiredPlayers) || this.requiredPlayers < 2) {
      throw new Error("requiredPlayers must be an integer greater than one");
    }
    this.now = options.now ?? Date.now;
  }

  join(entry: MatchEntry): MatchmakingJoinResult {
    if (!entry.userId || !entry.agent?.id || entry.agent.userId !== entry.userId) {
      return {
        accepted: false,
        code: "invalid_agent",
        state: this.getState(entry.userId),
      };
    }

    if (this.queue.some((queued) => queued.userId === entry.userId || queued.agent.id === entry.agent.id)) {
      return {
        accepted: false,
        code: "already_queued",
        state: this.getState(entry.userId),
      };
    }

    if ([...this.activeByUser.values()].some((active) =>
      active.userId === entry.userId || active.agent.id === entry.agent.id)
      || [...this.pendingBatches.values()].some((batch) =>
        batch.some((item) => item.userId === entry.userId || item.agent.id === entry.agent.id))) {
      return {
        accepted: false,
        code: "already_playing",
        state: this.getState(entry.userId),
      };
    }

    const queuedEntry = cloneEntry({
      ...entry,
      enteredAt: entry.enteredAt || this.now(),
      autoRequeue: entry.autoRequeue !== false,
      tableId: undefined,
    });
    this.queue.push(queuedEntry);
    const batch = this.claimBatch();

    return {
      accepted: true,
      state: this.stateForEntry(queuedEntry),
      batch,
    };
  }

  leave(userId: string): { state: MatchmakingState; removed: boolean } {
    const queueIndex = this.queue.findIndex((entry) => entry.userId === userId);
    if (queueIndex >= 0) {
      this.queue.splice(queueIndex, 1);
      return {
        removed: true,
        state: this.getState(userId),
      };
    }

    const active = this.activeByUser.get(userId);
    if (active) {
      active.autoRequeue = false;
      return {
        removed: false,
        state: this.stateForEntry(active),
      };
    }

    for (const batch of this.pendingBatches.values()) {
      const entry = batch.find((item) => item.userId === userId);
      if (entry) {
        entry.autoRequeue = false;
        return {
          removed: false,
          state: this.stateForEntry(entry, "matched"),
        };
      }
    }

    return {
      removed: false,
      state: this.getState(userId),
    };
  }

  setAutoRequeue(userId: string, enabled: boolean): MatchEntry | undefined {
    const entry = this.activeByUser.get(userId)
      ?? [...this.pendingBatches.values()].flat().find((item) => item.userId === userId);
    if (!entry) return undefined;
    entry.autoRequeue = enabled;
    return cloneEntry(entry);
  }

  startBatch(batchId: string, tableId: string): MatchEntry[] {
    const pending = this.pendingBatches.get(batchId);
    if (!pending) throw new Error(`Unknown matchmaking batch: ${batchId}`);
    if (this.activeTables.has(tableId)) throw new Error(`Table already tracked: ${tableId}`);

    this.pendingBatches.delete(batchId);
    const entries = pending.map((entry) => {
      const activeEntry = cloneEntry({ ...entry, tableId });
      this.activeByUser.set(activeEntry.userId, activeEntry);
      return activeEntry;
    });
    this.activeTables.set(tableId, entries);
    return entries.map(cloneEntry);
  }

  refreshBatch(
    batchId: string,
    resolveAgent: (entry: MatchEntry) => AgentConfigV2 | undefined,
  ): MatchBatch | undefined {
    const pending = this.pendingBatches.get(batchId);
    if (!pending) return undefined;
    for (const entry of pending) {
      const current = resolveAgent(entry);
      if (current) entry.agent = cloneAgent(current);
    }
    return {
      batchId,
      entries: pending.map(cloneEntry),
    };
  }

  cancelBatch(batchId: string): MatchEntry[] {
    const pending = this.pendingBatches.get(batchId);
    if (!pending) return [];
    this.pendingBatches.delete(batchId);
    this.queue = [
      ...pending.map((entry) => cloneEntry({ ...entry, tableId: undefined })),
      ...this.queue,
    ];
    return pending.map((entry) => cloneEntry({ ...entry, tableId: undefined }));
  }

  discardBatch(batchId: string): MatchEntry[] {
    const pending = this.pendingBatches.get(batchId);
    if (!pending) return [];
    this.pendingBatches.delete(batchId);
    return pending.map((entry) => cloneEntry({ ...entry, tableId: undefined }));
  }

  completeTable(tableId: string): {
    completed: MatchEntry[];
    requeued: MatchEntry[];
    batch?: MatchBatch;
  } {
    const active = this.activeTables.get(tableId);
    if (!active) return { completed: [], requeued: [] };

    this.activeTables.delete(tableId);
    for (const entry of active) {
      this.activeByUser.delete(entry.userId);
    }

    const requeued = active
      .filter((entry) => entry.autoRequeue)
      .map((entry) => cloneEntry({ ...entry, tableId: undefined }));
    this.queue.push(...requeued);

    return {
      completed: active.map(cloneEntry),
      requeued: requeued.map(cloneEntry),
      batch: this.claimBatch(),
    };
  }

  abortTable(tableId: string): MatchEntry[] {
    const active = this.activeTables.get(tableId);
    if (!active) return [];
    this.activeTables.delete(tableId);
    for (const entry of active) {
      this.activeByUser.delete(entry.userId);
    }
    return active.map(cloneEntry);
  }

  getState(userId: string): MatchmakingState {
    const queued = this.queue.find((entry) => entry.userId === userId);
    if (queued) return this.stateForEntry(queued);

    const pending = [...this.pendingBatches.values()]
      .flat()
      .find((entry) => entry.userId === userId);
    if (pending) return this.stateForEntry(pending, "matched");

    const active = this.activeByUser.get(userId);
    if (active) return this.stateForEntry(active, "playing");

    return {
      queue: "ranked-default",
      status: "idle",
      queueSize: this.queue.length,
      requiredPlayers: this.requiredPlayers,
      autoRequeue: false,
    };
  }

  getQueueSnapshot(): MatchEntry[] {
    return this.queue.map(cloneEntry);
  }

  getRequiredPlayers(): number {
    return this.requiredPlayers;
  }

  getTrackedUserIds(): string[] {
    const ids = new Set<string>(this.queue.map((entry) => entry.userId));
    for (const entry of this.activeByUser.values()) ids.add(entry.userId);
    for (const batch of this.pendingBatches.values()) {
      for (const entry of batch) ids.add(entry.userId);
    }
    return [...ids];
  }

  private stateForEntry(
    entry: MatchEntry,
    forcedStatus?: MatchmakingState["status"],
  ): MatchmakingState {
    const position = this.queue.findIndex((item) => item.userId === entry.userId);
    return {
      queue: "ranked-default",
      status: forcedStatus ?? (position >= 0 ? "queued" : entry.tableId ? "playing" : "matched"),
      agentId: entry.agent.id,
      ...(position >= 0 ? { position: position + 1 } : {}),
      queueSize: this.queue.length,
      requiredPlayers: this.requiredPlayers,
      ...(entry.tableId ? { tableId: entry.tableId } : {}),
      enteredAt: entry.enteredAt,
      autoRequeue: entry.autoRequeue,
    };
  }

  private claimBatch(): MatchBatch | undefined {
    if (this.queue.length < this.requiredPlayers) return undefined;

    const entries = this.queue.splice(0, this.requiredPlayers);
    const batchId = `match-${this.nextBatchId++}`;
    this.pendingBatches.set(batchId, entries);
    return {
      batchId,
      entries: entries.map(cloneEntry),
    };
  }
}

function cloneEntry(entry: MatchEntry): MatchEntry {
  return {
    ...entry,
    agent: cloneAgent(entry.agent),
  };
}

function cloneAgent(agent: AgentConfigV2): AgentConfigV2 {
  return JSON.parse(JSON.stringify(agent)) as AgentConfigV2;
}
