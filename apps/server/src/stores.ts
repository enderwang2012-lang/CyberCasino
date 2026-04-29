import type { UserIdentity, AgentConfig } from "@cybercasino/shared";

let agentCounter = 0;

export class UserStore {
  private users = new Map<string, UserIdentity>();

  register(existingUserId?: string): UserIdentity {
    if (existingUserId) {
      const existing = this.users.get(existingUserId);
      if (existing) return existing;
    }

    const userId = existingUserId ?? `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const identity: UserIdentity = { userId, createdAt: Date.now() };
    this.users.set(userId, identity);
    return identity;
  }

  get(userId: string): UserIdentity | undefined {
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
