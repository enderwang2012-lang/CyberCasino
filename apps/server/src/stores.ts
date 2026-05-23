import type { UserIdentity, AgentConfig, AgentConfigV2 } from "@cybercasino/shared";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(import.meta.dirname, "..", "data");
const USERS_FILE = join(DATA_DIR, "users.json");
const AGENTS_FILE = join(DATA_DIR, "agents.json");
const AGENTS_V2_FILE = join(DATA_DIR, "agents_v2.json");

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadUsers(): Map<string, UserIdentity> {
  ensureDataDir();
  try {
    const raw = readFileSync(USERS_FILE, "utf-8");
    const arr: UserIdentity[] = JSON.parse(raw);
    return new Map(arr.map((u) => [u.userId, u]));
  } catch {
    return new Map();
  }
}

function saveUsers(users: Map<string, UserIdentity>) {
  ensureDataDir();
  const arr = Array.from(users.values());
  writeFileSync(USERS_FILE, JSON.stringify(arr, null, 2));
}

function loadAgents(): Map<string, AgentConfig> {
  ensureDataDir();
  try {
    const raw = readFileSync(AGENTS_FILE, "utf-8");
    const arr: AgentConfig[] = JSON.parse(raw);
    for (const a of arr) {
      delete (a as any).mode;
    }
    return new Map(arr.map((a) => [a.userId, a]));
  } catch {
    return new Map();
  }
}

function saveAgents(agents: Map<string, AgentConfig>) {
  ensureDataDir();
  const arr = Array.from(agents.values());
  writeFileSync(AGENTS_FILE, JSON.stringify(arr, null, 2));
}

function loadAgentsV2(): Map<string, AgentConfigV2> {
  ensureDataDir();
  try {
    const raw = readFileSync(AGENTS_V2_FILE, "utf-8");
    const arr: AgentConfigV2[] = JSON.parse(raw);
    return new Map(arr.map((a) => [a.userId, a]));
  } catch {
    return new Map();
  }
}

function saveAgentsV2(agents: Map<string, AgentConfigV2>) {
  ensureDataDir();
  const arr = Array.from(agents.values());
  writeFileSync(AGENTS_V2_FILE, JSON.stringify(arr, null, 2));
}

const initialAgents = loadAgents();
let agentCounter = Array.from(initialAgents.values()).reduce((max, a) => {
  const n = parseInt(a.id.replace("agent-", ""), 10);
  return isNaN(n) ? max : Math.max(max, n);
}, 0);

const initialAgentsV2 = loadAgentsV2();
let agentV2Counter = Array.from(initialAgentsV2.values()).reduce((max, a) => {
  const n = parseInt(a.id.replace("agent-", ""), 10);
  return isNaN(n) ? max : Math.max(max, n);
}, 0);

export class UserStore {
  private users = loadUsers();

  upsert(identity: UserIdentity): UserIdentity {
    const existing = this.users.get(identity.userId);
    if (existing) return existing;

    this.users.set(identity.userId, identity);
    saveUsers(this.users);
    return identity;
  }

  get(userId: string): UserIdentity | undefined {
    return this.users.get(userId);
  }

}

export class AgentStore {
  private agents = new Map(initialAgents);
  private agentsV2 = new Map<string, AgentConfigV2[]>();

  constructor() {
    // Group flat array by userId
    for (const [, agent] of initialAgentsV2) {
      const existing = this.agentsV2.get(agent.userId) ?? [];
      existing.push(agent);
      this.agentsV2.set(agent.userId, existing);
    }
  }

  save(userId: string, partial: Omit<AgentConfig, "id" | "userId" | "webhookVerified">): AgentConfig {
    const existing = this.getByUserId(userId);
    const config: AgentConfig = {
      ...partial,
      id: existing?.id ?? `agent-${++agentCounter}`,
      userId,
      webhookVerified: existing?.webhookVerified ?? false,
    };
    this.agents.set(userId, config);
    saveAgents(this.agents);
    return config;
  }

  getByUserId(userId: string): AgentConfig | undefined {
    return this.agents.get(userId);
  }

  markWebhookVerified(userId: string): void {
    const config = this.agents.get(userId);
    if (config) {
      config.webhookVerified = true;
      saveAgents(this.agents);
    }
  }

  saveV2(agent: AgentConfigV2): void {
    // 清除该用户旧的 v1 agent
    this.agents.delete(agent.userId);
    // Append to v2 list
    const list = this.agentsV2.get(agent.userId) ?? [];
    list.push(agent);
    this.agentsV2.set(agent.userId, list);
    // Flatten and persist
    const all = Array.from(this.agentsV2.values()).flat();
    saveAgentsV2(new Map(all.map((a) => [a.userId, a])));
  }

  getV2ByUserId(userId: string): AgentConfigV2 | undefined {
    const list = this.agentsV2.get(userId);
    return list?.[list.length - 1]; // most recent
  }

  getAllV2ByUserId(userId: string): AgentConfigV2[] {
    return this.agentsV2.get(userId) ?? [];
  }

  nextV2Id(): string {
    return `agent-${++agentV2Counter}`;
  }
}