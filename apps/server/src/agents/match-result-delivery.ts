import type { ExternalAgentMatchResult } from "@cybercasino/shared";

interface PendingMatchResult {
  message: ExternalAgentMatchResult;
  expiresAt: number;
}

interface MatchResultDeliveryQueueOptions {
  maxResultsPerAgent?: number;
  retentionMs?: number;
  now?: () => number;
}

const DEFAULT_MAX_RESULTS_PER_AGENT = 32;
const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Holds completed match results until the Agent's next authenticated connection.
 * The queue is intentionally process-local; durable result history lives in the
 * existing replay store.
 */
export class MatchResultDeliveryQueue {
  private readonly maxResultsPerAgent: number;
  private readonly retentionMs: number;
  private readonly now: () => number;
  private readonly pending = new Map<string, Map<string, PendingMatchResult>>();

  constructor(options: MatchResultDeliveryQueueOptions = {}) {
    this.maxResultsPerAgent = options.maxResultsPerAgent ?? DEFAULT_MAX_RESULTS_PER_AGENT;
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
    this.now = options.now ?? Date.now;

    if (!Number.isSafeInteger(this.maxResultsPerAgent) || this.maxResultsPerAgent < 1) {
      throw new Error("maxResultsPerAgent must be a positive integer");
    }
    if (!Number.isFinite(this.retentionMs) || this.retentionMs <= 0) {
      throw new Error("retentionMs must be positive");
    }
  }

  enqueue(agentIds: string[], message: ExternalAgentMatchResult): void {
    this.prune();
    const expiresAt = this.now() + this.retentionMs;

    for (const agentId of new Set(agentIds)) {
      if (!agentId) continue;
      const results = this.pending.get(agentId) ?? new Map<string, PendingMatchResult>();
      results.delete(message.table_id);
      results.set(message.table_id, { message, expiresAt });
      while (results.size > this.maxResultsPerAgent) {
        const oldestTableId = results.keys().next().value as string | undefined;
        if (!oldestTableId) break;
        results.delete(oldestTableId);
      }
      this.pending.set(agentId, results);
    }
  }

  drain(agentId: string): ExternalAgentMatchResult[] {
    this.prune();
    const results = this.pending.get(agentId);
    if (!results) return [];
    this.pending.delete(agentId);
    return [...results.values()].map((entry) => entry.message);
  }

  private prune(): void {
    const now = this.now();
    for (const [agentId, results] of this.pending) {
      for (const [tableId, entry] of results) {
        if (entry.expiresAt <= now) results.delete(tableId);
      }
      if (results.size === 0) this.pending.delete(agentId);
    }
  }
}
