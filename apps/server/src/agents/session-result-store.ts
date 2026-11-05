import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SessionResultMessage } from "./match-result-message";

const MAX_RESULTS = 32;

export class SessionResultStore {
  private readonly pending = new Map<string, SessionResultMessage[]>();

  constructor(private readonly file?: string) {
    if (!file || !existsSync(file)) return;
    const stored = JSON.parse(readFileSync(file, "utf-8")) as Record<string, SessionResultMessage[]>;
    for (const [agentId, messages] of Object.entries(stored)) {
      if (Array.isArray(messages)) this.pending.set(agentId, messages.slice(-MAX_RESULTS));
    }
  }

  enqueue(agentId: string, message: SessionResultMessage): void {
    const queued = this.pending.get(agentId) ?? [];
    queued.push(message);
    while (queued.length > MAX_RESULTS) queued.shift();
    this.pending.set(agentId, queued);
    this.persist();
  }

  list(agentId: string): SessionResultMessage[] {
    return [...(this.pending.get(agentId) ?? [])];
  }

  acknowledge(agentId: string, tableId: string, endedAt: number): void {
    const remaining = (this.pending.get(agentId) ?? [])
      .filter((message) => !(message.table_id === tableId && message.ended_at === endedAt));
    if (remaining.length === 0) this.pending.delete(agentId);
    else this.pending.set(agentId, remaining);
    this.persist();
  }

  private persist(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.pending)));
  }
}
