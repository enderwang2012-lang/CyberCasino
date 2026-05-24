import type { UserIdentity, AgentConfig, AgentConfigV2 } from "@cybercasino/shared";
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
    soulKey: r.soul_key ?? undefined,
    webhookUrl: r.webhook_url ?? undefined,
    webhookVerified: r.webhook_verified ?? false,
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
    console.log(`[stores] loaded ${userMap.size} users, ${agentRows.length} agents from PostgreSQL`);
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
    console.log(`[stores] loaded ${userMap.size} users, ${agentsV2.length} agents from file`);
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
    list.push(agent);
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
      sql`INSERT INTO agents_v2 (id, user_id, name, avatar, description, strategy, soul_key, webhook_url, webhook_verified, created_at, updated_at)
          VALUES (${a.id}, ${a.userId}, ${a.name}, ${a.avatar}, ${a.description ?? null}, ${JSON.stringify(a.strategy)}::jsonb, ${a.soulKey ?? null}, ${a.webhookUrl ?? null}, ${a.webhookVerified ?? false}, ${a.createdAt}, ${a.updatedAt})
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name, avatar = EXCLUDED.avatar, description = EXCLUDED.description,
            strategy = EXCLUDED.strategy, soul_key = EXCLUDED.soul_key, webhook_url = EXCLUDED.webhook_url,
            webhook_verified = EXCLUDED.webhook_verified, updated_at = EXCLUDED.updated_at`.catch(console.error);
    } else {
      const all = Array.from(agentsV2Map.values()).flat();
      saveJson(AGENTS_V2_FILE, all);
    }
  }
}
