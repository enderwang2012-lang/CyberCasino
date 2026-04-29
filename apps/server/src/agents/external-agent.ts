import type {
  AgentConfig,
  AgentGameView,
  AgentDecision,
  ActionType,
  ActionRecord,
  WebhookRequest,
} from "@cybercasino/shared";
import type { IPokerAgent } from "./agent-interface";
import { ruleDecide, ruleFallback } from "./rule-engine";
import { parseStyleToPersonality } from "./style-parser";

const WEBHOOK_TIMEOUT_MS = 15_000;

export class ExternalAgent implements IPokerAgent {
  readonly id: string;
  readonly name: string;
  readonly avatar: string;
  readonly agentType = "external" as const;
  private readonly webhookUrl: string;
  private readonly stylePrompt: string;
  private readonly config: AgentConfig;
  private actionHistory: ActionRecord[] = [];

  constructor(config: AgentConfig) {
    this.id = config.id;
    this.name = config.name;
    this.avatar = config.avatar;
    this.webhookUrl = config.webhookUrl!;
    this.stylePrompt = config.stylePrompt;
    this.config = config;
  }

  recordAction(record: ActionRecord): void {
    this.actionHistory.push(record);
  }

  clearHistory(): void {
    this.actionHistory = [];
  }

  async decide(
    view: AgentGameView,
    validActions: ActionType[],
    callAmount: number,
    minRaise: number
  ): Promise<AgentDecision> {
    try {
      return await this.callWebhook(view, validActions, callAmount, minRaise);
    } catch (err) {
      console.warn(`[ExternalAgent:${this.id}] webhook failed, falling back to rules:`, err);
      return this.fallbackDecide(view, validActions, callAmount, minRaise);
    }
  }

  private async callWebhook(
    view: AgentGameView,
    validActions: ActionType[],
    callAmount: number,
    minRaise: number
  ): Promise<AgentDecision> {
    const payload: WebhookRequest = {
      type: "decision",
      gameView: view,
      validActions,
      callAmount,
      minRaise,
      stylePrompt: this.stylePrompt,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

    const res = await fetch(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Webhook returned HTTP ${res.status}`);
    }

    const body = await res.json();

    if (!validActions.includes(body.action)) {
      throw new Error(`Invalid action from webhook: ${body.action}`);
    }

    const action: AgentDecision["action"] = {
      type: body.action,
      amount: body.action === "raise"
        ? Math.max(body.amount ?? (view.currentBet + minRaise), view.currentBet + minRaise)
        : undefined,
    };

    return {
      action,
      thought: {
        message: body.thought ?? "...",
        confidence: 0.5,
        isBluffing: false,
      },
    };
  }

  private fallbackDecide(
    view: AgentGameView,
    validActions: ActionType[],
    callAmount: number,
    minRaise: number
  ): AgentDecision {
    const personality = parseStyleToPersonality(
      this.id,
      this.name,
      this.avatar,
      this.stylePrompt
    );

    const ruleResult = ruleDecide(view, personality, validActions, callAmount, minRaise);
    const decision = ruleResult.decision ?? ruleFallback(view, personality, validActions, callAmount);

    return {
      action: decision.action,
      thought: {
        message: `[Auto-pilot] ${decision.thought.message}`,
        confidence: decision.thought.confidence,
        isBluffing: decision.thought.isBluffing,
      },
    };
  }
}
