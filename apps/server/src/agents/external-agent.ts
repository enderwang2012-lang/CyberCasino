import type {
  AgentConfig,
  AgentGameView,
  AgentDecision,
  ActionType,
  ActionRecord,
} from "@cybercasino/shared";
import type { IPokerAgent } from "./agent-interface";
import { ruleDecide, ruleFallback } from "./rule-engine";
import { parseStyleToPersonality } from "./style-parser";
import { callWebhook } from "./webhook-caller";

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
    this.webhookUrl = config.webhookUrl ?? "";
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
    minRaise: number,
    language: "zh" | "en" = "zh"
  ): Promise<AgentDecision> {
    const result = await callWebhook(
      this.webhookUrl,
      view, validActions, callAmount, minRaise, this.stylePrompt,
    );

    if (result.success && result.response) {
      const resp = result.response;
      return {
        action: {
          type: resp.action,
          amount: resp.action === "raise"
            ? Math.max(resp.amount ?? (view.currentBet + minRaise), view.currentBet + minRaise)
            : undefined,
        },
        thought: {
          message: resp.thought ?? "...",
          confidence: resp.confidence ?? 0.5,
          isBluffing: resp.isBluffing ?? false,
          thinkingSource: "llm",
        },
      };
    }

    console.warn(`[ExternalAgent:${this.id}] webhook failed: ${result.error}, falling back to rules`);
    return this.fallbackDecide(view, validActions, callAmount, minRaise, language);
  }

  private fallbackDecide(
    view: AgentGameView,
    validActions: ActionType[],
    callAmount: number,
    minRaise: number,
    language: "zh" | "en" = "zh"
  ): AgentDecision {
    const personality = parseStyleToPersonality(
      this.id,
      this.name,
      this.avatar,
      this.stylePrompt
    );

    const ruleResult = ruleDecide(view, personality, validActions, callAmount, minRaise, language);
    const decision = ruleResult.decision ?? ruleFallback(view, personality, validActions, callAmount, language);

    return {
      action: decision.action,
      thought: {
        message: `[Auto-pilot] ${decision.thought.message}`,
        confidence: decision.thought.confidence,
        isBluffing: decision.thought.isBluffing,
        thinkingSource: decision.thought.thinkingSource,
      },
    };
  }
}
