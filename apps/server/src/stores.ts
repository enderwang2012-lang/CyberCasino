import type { UserIdentity, AgentConfig, AgentConfigV2, TableInfo, ReplayData, RankedStanding, AgentActionAudit } from "@cybercasino/shared";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { sql, ensureSchema } from "./db";

// ---------------------------------------------------------------------------
// File-based helpers
// ---------------------------------------------------------------------------

const DATA_DIR = join(import.meta.dirname, "..", "data");
const USERS_FILE = join(DATA_DIR, "users.json");
const AGENTS_FILE = join(DATA_DIR, "agents.json");
const AGENTS_V2_FILE = join(DATA_DIR, "agents_v2.json");
const HISTORY_FILE = join(DATA_DIR, "game_history.json");
const AUDITS_FILE = join(DATA_DIR, "match_action_audits.json");

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadJson<T>(file: string, fallback: T): T {
  ensureDataDir();
  try { return JSON.parse(readFileSync(file, "utf-8")); } catch { return fallback; }
}

function saveJson(file: string, data: unknown) {
  ensureDataDir();
  writeFileSync(file, JSON.stringify(data, null, 2));
}

function rowToAgentV2(r: any): AgentConfigV2 {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    avatar: r.avatar,
    description: r.description ?? undefined,
    strategy: typeof r.strategy === "string" ? JSON.parse(r.strategy) : r.strategy,
    strategyPackage: r.strategy_package
      ? (typeof r.strategy_package === "string" ? JSON.parse(r.strategy_package) : r.strategy_package)
      : undefined,
    strategyVersions: r.strategy_versions
      ? (typeof r.strategy_versions === "string" ? JSON.parse(r.strategy_versions) : r.strategy_versions)
      : undefined,
    strategyVersion: r.strategy_version ? Number(r.strategy_version) : undefined,
    executionMode: r.execution_mode ?? undefined,
    soulKey: r.soul_key ?? undefined,
    webhookUrl: r.webhook_url ?? undefined,
    webhookVerified: r.webhook_verified ?? false,
    stylePrompt: r.style_prompt ?? undefined,
    styleProfile: r.style_profile
      ? (typeof r.style_profile === "string" ? JSON.parse(r.style_profile) : r.style_profile)
      : undefined,
    pendingStylePrompt: r.pending_style_prompt ?? undefined,
    pendingStyleProfile: r.pending_style_profile
      ? (typeof r.pending_style_profile === "string" ? JSON.parse(r.pending_style_profile) : r.pending_style_profile)
      : undefined,
    pendingStrategyVersion: r.pending_strategy_version ? Number(r.pending_strategy_version) : undefined,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

// ---------------------------------------------------------------------------
// Init: load from DB or file into memory
// ---------------------------------------------------------------------------

let userMap = new Map<string, UserIdentity>();
let agentMap = new Map<string, AgentConfig>();
let agentsV2Map = new Map<string, AgentConfigV2[]>();
let agentV2Counter = 0;
let historyMap = new Map<string, { info: TableInfo; events: ReplayData }>();
let auditMap = new Map<string, AgentActionAudit[]>();

export async function initStores() {
  if (sql) {
    await ensureSchema();
    const rows = await sql`SELECT * FROM users`;
    for (const r of rows) {
      userMap.set(r.user_id, {
        userId: r.user_id, name: r.name, avatar: r.avatar,
        provider: r.provider, createdAt: Number(r.created_at),
      });
    }
    const agentRows = await sql`SELECT * FROM agents_v2`;
    for (const r of agentRows) {
      const agent = rowToAgentV2(r);
      const list = agentsV2Map.get(agent.userId) ?? [];
      list.push(agent);
      agentsV2Map.set(agent.userId, list);
      const n = parseInt(agent.id.replace("agent-", ""), 10);
      if (!isNaN(n)) agentV2Counter = Math.max(agentV2Counter, n);
    }
    const historyRows = await sql`SELECT * FROM game_history ORDER BY created_at DESC`;
    for (const r of historyRows) {
      historyMap.set(r.table_id, {
        info: typeof r.table_info === "string" ? JSON.parse(r.table_info) : r.table_info,
        events: typeof r.event_history === "string" ? JSON.parse(r.event_history) : r.event_history,
      });
    }
    const auditRows = await sql`SELECT * FROM match_action_audits`;
    for (const r of auditRows) {
      auditMap.set(r.table_id, typeof r.action_audits === "string" ? JSON.parse(r.action_audits) : r.action_audits);
    }
    console.log(`[stores] loaded ${userMap.size} users, ${agentRows.length} agents, ${historyRows.length} game histories from PostgreSQL`);
  } else {
    userMap = new Map(Object.entries(loadJson<Record<string, UserIdentity>>(USERS_FILE, {})));
    const agents = loadJson<AgentConfig[]>(AGENTS_FILE, []);
    for (const a of agents) { delete (a as any).mode; agentMap.set(a.userId, a); }
    const agentsV2 = loadJson<AgentConfigV2[]>(AGENTS_V2_FILE, []);
    for (const agent of agentsV2) {
      const list = agentsV2Map.get(agent.userId) ?? [];
      list.push(agent);
      agentsV2Map.set(agent.userId, list);
      const n = parseInt(agent.id.replace("agent-", ""), 10);
      if (!isNaN(n)) agentV2Counter = Math.max(agentV2Counter, n);
    }
    const histories = loadJson<{ info: TableInfo; events: ReplayData }[]>(HISTORY_FILE, []);
    for (const h of histories) {
      historyMap.set(h.info.id, h);
    }
    auditMap = new Map(Object.entries(loadJson<Record<string, AgentActionAudit[]>>(AUDITS_FILE, {})));
    console.log(`[stores] loaded ${userMap.size} users, ${agentsV2.length} agents, ${histories.length} game histories from file`);
  }
}

// ---------------------------------------------------------------------------
// UserStore — synchronous reads, async writes
// ---------------------------------------------------------------------------

export class UserStore {
  upsert(identity: UserIdentity): UserIdentity {
    const existing = userMap.get(identity.userId);
    if (existing) return existing;
    userMap.set(identity.userId, identity);
    this.persist(identity);
    return identity;
  }

  get(userId: string): UserIdentity | undefined {
    return userMap.get(userId);
  }

  private persist(u: UserIdentity) {
    if (sql) {
      sql`INSERT INTO users (user_id, name, avatar, provider, created_at)
          VALUES (${u.userId}, ${u.name}, ${u.avatar}, ${u.provider}, ${u.createdAt})
          ON CONFLICT (user_id) DO NOTHING`.catch(console.error);
    } else {
      saveJson(USERS_FILE, Array.from(userMap.values()));
    }
  }
}

// ---------------------------------------------------------------------------
// AgentStore — synchronous reads, async writes
// ---------------------------------------------------------------------------

export class AgentStore {
  save(userId: string, partial: Omit<AgentConfig, "id" | "userId" | "webhookVerified">): AgentConfig {
    const existing = agentMap.get(userId);
    const config: AgentConfig = {
      ...partial,
      id: existing?.id ?? `agent-${agentMap.size + 1}`,
      userId,
      webhookVerified: existing?.webhookVerified ?? false,
    };
    agentMap.set(userId, config);
    return config;
  }

  getByUserId(userId: string): AgentConfig | undefined {
    return agentMap.get(userId);
  }

  markWebhookVerified(userId: string): void {
    const config = agentMap.get(userId);
    if (config) config.webhookVerified = true;
  }

  saveV2(agent: AgentConfigV2): void {
    const list = agentsV2Map.get(agent.userId) ?? [];
    const existingIndex = list.findIndex((entry) => entry.id === agent.id);
    if (existingIndex >= 0) {
      list[existingIndex] = agent;
    } else {
      list.push(agent);
    }
    agentsV2Map.set(agent.userId, list);
    this.persistV2(agent);
  }

  getV2ByUserId(userId: string): AgentConfigV2 | undefined {
    const list = agentsV2Map.get(userId);
    return list?.[list.length - 1];
  }

  getAllV2ByUserId(userId: string): AgentConfigV2[] {
    return agentsV2Map.get(userId) ?? [];
  }

  getV2ByToken(token: string): AgentConfigV2 | undefined {
    for (const [, list] of agentsV2Map) {
      const found = list.find(a => a.soulKey === token);
      if (found) return found;
    }
    return undefined;
  }

  deleteV2(userId: string, agentId: string): boolean {
    const list = agentsV2Map.get(userId);
    if (!list) return false;
    const idx = list.findIndex((a) => a.id === agentId);
    if (idx === -1) return false;
    list.splice(idx, 1);
    if (list.length === 0) agentsV2Map.delete(userId);
    this.persistAllV2();
    if (sql) {
      sql`DELETE FROM agents_v2 WHERE id = ${agentId}`;
    }
    return true;
  }

  private persistAllV2() {
    const all = Array.from(agentsV2Map.values()).flat();
    saveJson(AGENTS_V2_FILE, all);
    if (sql) {
      sql`DELETE FROM agents_v2`.then(() => {
        for (const a of all) this.persistV2(a);
      });
    }
  }

  nextV2Id(): string {
    return `agent-${++agentV2Counter}`;
  }

  private persistV2(a: AgentConfigV2) {
    if (sql) {
      sql`INSERT INTO agents_v2 (id, user_id, name, avatar, description, strategy, strategy_package, strategy_versions, strategy_version, execution_mode, soul_key, webhook_url, webhook_verified, style_prompt, style_profile, pending_style_prompt, pending_style_profile, pending_strategy_version, created_at, updated_at)
          VALUES (${a.id}, ${a.userId}, ${a.name}, ${a.avatar}, ${a.description ?? null}, ${JSON.stringify(a.strategy)}::jsonb, ${a.strategyPackage ? JSON.stringify(a.strategyPackage) : null}::jsonb, ${a.strategyVersions ? JSON.stringify(a.strategyVersions) : null}::jsonb, ${a.strategyVersion ?? a.strategyPackage?.manifest.version ?? 1}, ${a.executionMode ?? "verified_package"}, ${a.soulKey ?? null}, ${a.webhookUrl ?? null}, ${a.webhookVerified ?? false}, ${a.stylePrompt ?? ""}, ${a.styleProfile ? JSON.stringify(a.styleProfile) : null}::jsonb, ${a.pendingStylePrompt ?? null}, ${a.pendingStyleProfile ? JSON.stringify(a.pendingStyleProfile) : null}::jsonb, ${a.pendingStrategyVersion ?? null}, ${a.createdAt}, ${a.updatedAt})
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name, avatar = EXCLUDED.avatar, description = EXCLUDED.description,
            strategy = EXCLUDED.strategy, strategy_package = EXCLUDED.strategy_package, strategy_versions = EXCLUDED.strategy_versions, strategy_version = EXCLUDED.strategy_version, execution_mode = EXCLUDED.execution_mode,
            soul_key = EXCLUDED.soul_key, webhook_url = EXCLUDED.webhook_url,
            webhook_verified = EXCLUDED.webhook_verified, style_prompt = EXCLUDED.style_prompt, style_profile = EXCLUDED.style_profile,
            pending_style_prompt = EXCLUDED.pending_style_prompt, pending_style_profile = EXCLUDED.pending_style_profile, pending_strategy_version = EXCLUDED.pending_strategy_version,
            updated_at = EXCLUDED.updated_at`.catch(console.error);
    } else {
      const all = Array.from(agentsV2Map.values()).flat();
      saveJson(AGENTS_V2_FILE, all);
    }
  }

  updateStylePrompt(agentId: string, stylePrompt: string, styleProfile: AgentConfigV2["styleProfile"], status: "active" | "pending" | "activate_pending" = "active"): void {
    const now = Date.now();
    // Find agent across all users
    for (const [, list] of agentsV2Map) {
      const agent = list.find(a => a.id === agentId);
      if (agent) {
        const nextVersion = agent.pendingStrategyVersion
          ?? (agent.strategyVersion ?? agent.strategyPackage?.manifest.version ?? 1) + 1;
        if (status === "pending") {
          agent.pendingStylePrompt = stylePrompt;
          agent.pendingStyleProfile = styleProfile;
          agent.pendingStrategyVersion = nextVersion;
        } else {
          agent.stylePrompt = stylePrompt;
          agent.styleProfile = styleProfile ?? agent.pendingStyleProfile;
          agent.strategyVersion = status === "activate_pending"
            ? nextVersion
            : (agent.strategyVersion ?? agent.strategyPackage?.manifest.version ?? 1) + 1;
          agent.pendingStylePrompt = undefined;
          agent.pendingStyleProfile = undefined;
          agent.pendingStrategyVersion = undefined;
        }
        agent.updatedAt = now;
        break;
      }
    }
    // Persist
    const db = sql;
    if (db) {
      if (status === "pending") {
        db`UPDATE agents_v2 SET pending_style_prompt = ${stylePrompt}, pending_style_profile = ${styleProfile ? JSON.stringify(styleProfile) : null}::jsonb, pending_strategy_version = COALESCE(pending_strategy_version, strategy_version + 1, 2), updated_at = ${now} WHERE id = ${agentId}`.catch(console.error);
      } else if (status === "activate_pending") {
        db`UPDATE agents_v2 SET style_prompt = ${stylePrompt}, style_profile = COALESCE(pending_style_profile, ${styleProfile ? JSON.stringify(styleProfile) : null}::jsonb), strategy_version = COALESCE(pending_strategy_version, strategy_version + 1, 2), pending_style_prompt = NULL, pending_style_profile = NULL, pending_strategy_version = NULL, updated_at = ${now} WHERE id = ${agentId}`.catch(console.error);
      } else {
        db`UPDATE agents_v2 SET style_prompt = ${stylePrompt}, style_profile = ${styleProfile ? JSON.stringify(styleProfile) : null}::jsonb, strategy_version = COALESCE(strategy_version, 1) + 1, pending_style_prompt = NULL, pending_style_profile = NULL, pending_strategy_version = NULL, updated_at = ${now} WHERE id = ${agentId}`.catch(console.error);
      }
    } else {
      const all = Array.from(agentsV2Map.values()).flat();
      saveJson(AGENTS_V2_FILE, all);
    }
  }

  activatePendingStylesAfterRestart(): void {
    for (const [, list] of agentsV2Map) {
      for (const agent of list) {
        if (agent.pendingStylePrompt) {
          this.updateStylePrompt(agent.id, agent.pendingStylePrompt, agent.pendingStyleProfile, "activate_pending");
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// GameHistoryStore — persistent game history
// ---------------------------------------------------------------------------

export class GameHistoryStore {
  getAll(): { info: TableInfo; events: ReplayData }[] {
    return Array.from(historyMap.values());
  }

  get(tableId: string): { info: TableInfo; events: ReplayData } | undefined {
    return historyMap.get(tableId);
  }

  async saveCompletedMatch(info: TableInfo, events: ReplayData, audits: AgentActionAudit[]): Promise<void> {
    const recordedAt = info.finishedAt ?? Date.now();
    const nextHistory = new Map(historyMap);
    const nextAudits = new Map(auditMap);
    nextHistory.set(info.id, { info, events });
    nextAudits.set(info.id, audits);

    const db = sql;
    if (db) {
      await db.begin(async (tx) => {
        await tx`INSERT INTO game_history (table_id, table_info, event_history, created_at)
            VALUES (${info.id}, ${JSON.stringify(info)}::jsonb, ${JSON.stringify(events)}::jsonb, ${recordedAt})
            ON CONFLICT (table_id) DO UPDATE SET
              table_info = EXCLUDED.table_info,
              event_history = EXCLUDED.event_history,
              created_at = EXCLUDED.created_at`;
        await tx`INSERT INTO match_action_audits (table_id, action_audits, created_at)
            VALUES (${info.id}, ${JSON.stringify(audits)}::jsonb, ${recordedAt})
            ON CONFLICT (table_id) DO UPDATE SET
              action_audits = EXCLUDED.action_audits,
              created_at = EXCLUDED.created_at`;
      });
    } else {
      // Write audit first so a failed file write never publishes a result without audit.
      saveJson(AUDITS_FILE, Object.fromEntries(nextAudits));
      saveJson(HISTORY_FILE, Array.from(nextHistory.values()));
    }

    historyMap = nextHistory;
    auditMap = nextAudits;
  }

  getAudits(tableId: string): AgentActionAudit[] | undefined {
    return auditMap.get(tableId);
  }

  getLeaderboard(): RankedStanding[] {
    const minimumRatedGames = 3;
    const values = Array.from(historyMap.values())
      .filter((entry) => entry.events && Array.isArray(entry.events.rankings))
      .sort((a, b) => (a.info.finishedAt ?? 0) - (b.info.finishedAt ?? 0));
    const ratings = new Map<string, number>();
    const stats = new Map<string, {
      name: string;
      avatar: string;
      gamesPlayed: number;
      ratedGames: number;
      wins: number;
      totalFinish: number;
      activeStrategyVersion?: number;
      visibleInLeaderboard: boolean;
    }>();
    const k = 24;

    for (const { events: replay } of values) {
      const players = new Map(replay.players.map((player) => [player.id, player]));
      const externalResults = replay.rankings.filter((result) => players.get(result.playerId)?.type !== "builtin");
      const isRatedMatch = externalResults.length >= 2;
      for (const result of externalResults) {
        const player = players.get(result.playerId);
        if (!player) continue;
        const previous = stats.get(result.playerId);
        stats.set(result.playerId, {
          name: player.name,
          avatar: player.avatar,
          gamesPlayed: (previous?.gamesPlayed ?? 0) + 1,
          ratedGames: (previous?.ratedGames ?? 0) + (isRatedMatch ? 1 : 0),
          wins: (previous?.wins ?? 0) + (result.position === 1 ? 1 : 0),
          totalFinish: (previous?.totalFinish ?? 0) + result.position,
          activeStrategyVersion: player.strategyVersion ?? previous?.activeStrategyVersion,
          visibleInLeaderboard: player.type !== "builtin",
        });
        if (!ratings.has(result.playerId)) ratings.set(result.playerId, 1000);
      }

      const results = isRatedMatch ? externalResults : [];
      const deltas = new Map<string, number>();
      for (const result of results) {
        for (const opponent of results) {
          if (result.playerId === opponent.playerId) continue;
          const own = ratings.get(result.playerId) ?? 1000;
          const other = ratings.get(opponent.playerId) ?? 1000;
          const expected = 1 / (1 + Math.pow(10, (other - own) / 400));
          const actual = result.position < opponent.position ? 1 : result.position === opponent.position ? 0.5 : 0;
          const adjustment = results.length > 1 ? (k * (actual - expected)) / (results.length - 1) : 0;
          deltas.set(result.playerId, (deltas.get(result.playerId) ?? 0) + adjustment);
        }
      }
      for (const [agentId, delta] of deltas) {
        ratings.set(agentId, (ratings.get(agentId) ?? 1000) + delta);
      }
    }

    return Array.from(stats.entries())
      .filter(([, entry]) => entry.visibleInLeaderboard)
      .map(([agentId, entry]) => ({
        agentId,
        name: entry.name,
        avatar: entry.avatar,
        rating: Math.round(ratings.get(agentId) ?? 1000),
        gamesPlayed: entry.gamesPlayed,
        ratedGames: entry.ratedGames,
        wins: entry.wins,
        averageFinish: Number((entry.totalFinish / entry.gamesPlayed).toFixed(2)),
        activeStrategyVersion: entry.activeStrategyVersion,
        provisional: entry.ratedGames < minimumRatedGames,
      }))
      .sort((a, b) => Number(a.provisional) - Number(b.provisional) || b.rating - a.rating || b.wins - a.wins);
  }
}
