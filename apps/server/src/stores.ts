import type { UserIdentity, AgentConfig } from "@cybercasino/shared";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(import.meta.dirname, "..", "data");
const USERS_FILE = join(DATA_DIR, "users.json");

let agentCounter = 0;

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

  getOrReload(userId: string): UserIdentity | undefined {
    const cached = this.users.get(userId);
    if (cached) return cached;

    this.users = loadUsers();
    return this.users.get(userId);
  }
}

export class AgentStore {
  private agents = new Map<string, AgentConfig>();

  save(userId: string, partial: Omit<AgentConfig, "id" | "userId" | "webhookVerified">): AgentConfig {
    const existing = this.getByUserId(userId);
    const config: AgentConfig = {
      ...partial,
      id: existing?.id ?? `agent-${++agentCounter}`,
      userId,
      webhookVerified: false,
    };
    this.agents.set(userId, config);
    return config;
  }

  getByUserId(userId: string): AgentConfig | undefined {
    return this.agents.get(userId);
  }

  markWebhookVerified(userId: string): void {
    const config = this.agents.get(userId);
    if (config) config.webhookVerified = true;
  }
}