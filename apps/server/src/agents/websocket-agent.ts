import type {
  AgentGameView,
  AgentDecision,
  ActionType,
  ActionRecord,
  StyleProfile,
  StrategyConfig,
} from "@cybercasino/shared";
import type { IPokerAgent } from "./agent-interface";
import { wsAgentManager } from "./websocket-agent-manager";
import { StrategyAgent } from "./strategy-agent";
import { parseStyleToPersonality } from "./style-parser";
import { ruleDecide, ruleFallback } from "./rule-engine";

const DECISION_TIMEOUT_MS = 15_000;

/**
 * WebSocketAgent: an external agent that connects via WebSocket.
 *
 * When decide() is called, it pushes a your_turn message to the connected agent
 * and waits for an action response. If the agent is disconnected or times out,
 * falls back to StrategyAgent using the stored strategy config.
 */
export class WebSocketAgent implements IPokerAgent {
  readonly id: string;
  readonly name: string;
  readonly avatar: string;
  readonly agentType = "external" as const;

  private readonly stylePrompt: string;
  private readonly styleProfile?: StyleProfile;
  private readonly strategy?: StrategyConfig;
  private readonly tableId: string;

  constructor(
    id: string,
    name: string,
    avatar: string,
    stylePrompt = "",
    tableId = "",
    styleProfile?: StyleProfile,
    strategy?: StrategyConfig,
  ) {
    this.id = id;
    this.name = name;
    this.avatar = avatar;
    this.stylePrompt = stylePrompt;
    this.tableId = tableId;
    this.styleProfile = styleProfile;
    this.strategy = strategy;
  }

  async decide(
    view: AgentGameView,
    validActions: ActionType[],
    callAmount: number,
    minRaise: number,
    language: "zh" | "en" = "zh",
  ): Promise<AgentDecision> {
    // Try WebSocket decision if connected
    if (wsAgentManager.isConnected(this.id)) {
      try {
        const decision = await wsAgentManager.requestDecision(
          this.id,
          view,
          validActions,
          callAmount,
          minRaise,
          this.stylePrompt,
          this.tableId,
          DECISION_TIMEOUT_MS,
          this.strategy,
        );
        return decision;
      } catch (err) {
        console.warn(
          `[WebSocketAgent:${this.id}] WebSocket decision failed: ${(err as Error).message}, falling back to StrategyAgent`
        );
      }
    }

    // Fallback to StrategyAgent (same strategy the remote AI would have used)
    return this.fallbackDecide(view, validActions, callAmount, minRaise, language);
  }

  recordAction(record: ActionRecord): void {
    // No internal state to track for external agents
  }

  clearHistory(): void {
    // No internal state to clear for external agents
  }

  private async fallbackDecide(
    view: AgentGameView,
    validActions: ActionType[],
    callAmount: number,
    minRaise: number,
    language: "zh" | "en" = "zh",
  ): Promise<AgentDecision> {
    // If we have a StrategyConfig, delegate to StrategyAgent
    if (this.strategy) {
      try {
        const agent = new StrategyAgent(
          {
            id: this.id,
            userId: "external",
            name: this.name,
            avatar: this.avatar,
            strategy: this.strategy,
            executionMode: "remote_agent",
            createdAt: 0,
            updatedAt: 0,
          },
          "external",
          "ranked",
        );
        const decision = await agent.decide(view, validActions, callAmount, minRaise, language);
        return {
          ...decision,
          thought: {
            ...decision.thought,
            message: `[Auto-pilot] ${decision.thought.message}`,
          },
        };
      } catch (err) {
        console.warn(
          `[WebSocketAgent:${this.id}] StrategyAgent fallback failed: ${(err as Error).message}, falling back to rule engine`
        );
      }
    }

    // Final fallback: rule engine
    const personality = parseStyleToPersonality(
      this.id,
      this.name,
      this.avatar,
      this.stylePrompt,
    );

    const ruleResult = ruleDecide(view, personality, validActions, callAmount, minRaise, language, this.styleProfile);
    const decision = ruleResult.decision ?? ruleFallback(view, personality, validActions, callAmount, language);

    return {
      action: decision.action,
      thought: {
        message: `[Auto-pilot] ${decision.thought.message}`,
        confidence: decision.thought.confidence,
        isBluffing: decision.thought.isBluffing,
        thinkingSource: "rule",
      },
    };
  }
}
