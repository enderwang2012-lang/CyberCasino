import type {
  AgentConfigV2,
  MatchmakingError,
  MatchmakingState,
} from "@cybercasino/shared";
import {
  MatchmakingService,
  type MatchBatch,
  type MatchEntry,
} from "./matchmaking-service";

export interface MatchmakingTable {
  id: string;
}

export interface MatchmakingControllerDependencies {
  service: MatchmakingService;
  getAgent: (userId: string, agentId?: string) => AgentConfigV2 | undefined;
  isAgentPlaying: (agentId: string) => boolean;
  createTable: (entries: MatchEntry[]) => MatchmakingTable;
  removeTable: (tableId: string) => void;
  startTable: (table: MatchmakingTable, entries: MatchEntry[]) => void;
  getFillEntries?: () => MatchEntry[];
  emitState: (userId: string, state: MatchmakingState) => void;
  emitMatched: (userId: string, tableId: string, agentId: string) => void;
  emitError: (userId: string, error: MatchmakingError) => void;
}

const ERROR_MESSAGES: Record<MatchmakingError["code"], string> = {
  not_registered: "请先登录后再进入匹配",
  agent_not_found: "请先配置一个 Agent",
  already_queued: "这个 Agent 已经在匹配队列中",
  already_playing: "这个 Agent 已经在进行中的牌桌中",
  queue_not_found: "当前没有可用的匹配队列",
  invalid_agent: "Agent 配置无效，请重新配置后重试",
  match_start_failed: "匹配成功但牌桌启动失败，请稍后重试",
};

export class MatchmakingController {
  private readonly deps: MatchmakingControllerDependencies;

  constructor(deps: MatchmakingControllerDependencies) {
    this.deps = deps;
  }

  join(userId: string | undefined, agentId?: string): void {
    if (!userId) {
      this.emitError("", "not_registered");
      return;
    }

    const agent = this.deps.getAgent(userId, agentId);
    if (!agent) {
      this.emitError(userId, "agent_not_found");
      return;
    }
    if (this.deps.isAgentPlaying(agent.id)) {
      this.emitError(userId, "already_playing");
      return;
    }

    const result = this.deps.service.join({
      userId,
      agent: cloneAgent(agent),
      enteredAt: Date.now(),
      autoRequeue: true,
    });
    if (!result.accepted) {
      this.emitError(userId, result.code);
      this.deps.emitState(userId, result.state);
      return;
    }

    this.emitTrackedStates([userId]);
    if (result.batch) {
      this.activateBatch(result.batch);
    } else {
      this.fillQueue();
    }
  }

  leave(userId: string | undefined): void {
    if (!userId) {
      this.emitError("", "not_registered");
      return;
    }

    this.deps.service.leave(userId);
    this.clearPresetOnlyQueue();
    this.deps.emitState(userId, this.deps.service.getState(userId));
    this.emitTrackedStates();
  }

  status(userId: string | undefined): void {
    if (!userId) {
      this.emitError("", "not_registered");
      return;
    }
    this.deps.emitState(userId, this.deps.service.getState(userId));
  }

  completeTable(tableId: string): void {
    const result = this.deps.service.completeTable(tableId);
    for (const entry of result.completed) {
      this.deps.emitState(entry.userId, this.deps.service.getState(entry.userId));
    }
    this.emitTrackedStates();
    if (result.batch) {
      this.activateBatch(result.batch);
    } else {
      this.fillQueue();
    }
  }

  failTable(tableId: string): void {
    const entries = this.deps.service.abortTable(tableId);
    for (const entry of entries) {
      this.deps.emitState(entry.userId, this.deps.service.getState(entry.userId));
    }
    this.emitTrackedStates();
  }

  private activateBatch(batch: MatchBatch): void {
    let table: MatchmakingTable | undefined;
    try {
      const refreshedBatch = this.deps.service.refreshBatch(
        batch.batchId,
        (entry) => this.deps.getAgent(entry.userId, entry.agent.id),
      ) ?? batch;
      table = this.deps.createTable(refreshedBatch.entries);
      const activeEntries = this.deps.service.startBatch(refreshedBatch.batchId, table.id);
      for (const entry of activeEntries) {
        this.deps.emitMatched(entry.userId, table.id, entry.agent.id);
      }
      this.emitTrackedStates();
      this.deps.startTable(table, activeEntries);
    } catch (error) {
      const abortedEntries = table ? this.deps.service.abortTable(table.id) : [];
      const discardedEntries = this.deps.service.discardBatch(batch.batchId);
      if (table) {
        this.deps.removeTable(table.id);
      }
      const affectedEntries = abortedEntries.length > 0
        ? abortedEntries
        : discardedEntries.length > 0
          ? discardedEntries
          : batch.entries;
      for (const entry of affectedEntries) {
        this.deps.emitState(entry.userId, this.deps.service.getState(entry.userId));
      }
      for (const entry of affectedEntries.filter((item) => !item.userId.startsWith("builtin:"))) {
        this.emitError(entry.userId, "match_start_failed");
      }
      this.emitTrackedStates();
      console.error("[matchmaking] failed to start matched table:", error);
    }
  }

  private fillQueue(): void {
    this.clearPresetOnlyQueue();
    const queue = this.deps.service.getQueueSnapshot();
    if (!queue.some((entry) => !entry.userId.startsWith("builtin:"))) return;

    const getFillEntries = this.deps.getFillEntries;
    if (!getFillEntries) return;

    const requiredPlayers = this.deps.service.getRequiredPlayers();
    const queuedAgentIds = new Set(
      queue.map((entry) => entry.agent.id),
    );

    for (const entry of getFillEntries()) {
      if (this.deps.service.getQueueSnapshot().length >= requiredPlayers) break;
      if (queuedAgentIds.has(entry.agent.id)) continue;

      const result = this.deps.service.join({
        ...entry,
        agent: cloneAgent(entry.agent),
        enteredAt: entry.enteredAt || Date.now(),
        autoRequeue: false,
      });
      if (!result.accepted) continue;
      queuedAgentIds.add(entry.agent.id);
      if (result.batch) {
        this.activateBatch(result.batch);
        return;
      }
    }

    this.emitTrackedStates();
  }

  private clearPresetOnlyQueue(): void {
    const queue = this.deps.service.getQueueSnapshot();
    if (queue.some((entry) => !entry.userId.startsWith("builtin:"))) return;

    for (const entry of queue) {
      this.deps.service.leave(entry.userId);
    }
    for (const entry of queue) {
      this.deps.emitState(entry.userId, this.deps.service.getState(entry.userId));
    }
  }

  private emitTrackedStates(extraUsers: string[] = []): void {
    const users = new Set([...this.deps.service.getTrackedUserIds(), ...extraUsers]);
    for (const userId of users) {
      this.deps.emitState(userId, this.deps.service.getState(userId));
    }
  }

  private emitError(userId: string, code: MatchmakingError["code"]): void {
    this.deps.emitError(userId, {
      code,
      message: ERROR_MESSAGES[code],
    });
  }
}

function cloneAgent(agent: AgentConfigV2): AgentConfigV2 {
  return JSON.parse(JSON.stringify(agent)) as AgentConfigV2;
}
