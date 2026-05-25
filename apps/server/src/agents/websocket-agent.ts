import type {
  AgentGameView,
  AgentDecision,
  ActionType,
  ActionRecord,
} from "@cybercasino/shared";
import type { IPokerAgent } from "./agent-interface";
import { wsAgentManager } from "./websocket-agent-manager";
import { parseStyleToPersonality } from "./style-parser";
import { ruleDecide, ruleFallback } from "./rule-engine";

const DECISION_TIMEOUT_MS = 15_000;

/**
 * WebSocketAgent: an external agent that connects via WebSocket.
 *
 * When decide() is called, it pushes a your_turn message to the connected agent
 * and waits for an action response. If the agent is disconnected or times out,
 * falls back to the rule engine using the stored stylePrompt.
 */
export class WebSocketAgent implements IPokerAgent {
  readonly id: string;
  readonly name: string;
  readonly avatar: string;
  readonly agentType = "external" as const;

  private stylePrompt: string;
  private tableId: string;

  constructor(id: string, name: string, avatar: string, stylePrompt = "", tableId = "") {
    this.id = id;
    this.name = name;
    this.avatar = avatar;
    this.stylePrompt = stylePrompt;
    this.tableId = tableId;
  }

  setStylePrompt(prompt: string) {
    this.stylePrompt = prompt;
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
        );
        return decision;
      } catch (err) {
        console.warn(
          `[WebSocketAgent:${this.id}] WebSocket decision failed: ${(err as Error).message}, falling back to rules`
        );
      }
    }

    // Fallback to rule engine
    return this.fallbackDecide(view, validActions, callAmount, minRaise, language);
  }

  recordAction(record: ActionRecord): void {
    // No internal state to track for external agents
  }

  clearHistory(): void {
    // No internal state to clear for external agents
  }

  private fallbackDecide(
    view: AgentGameView,
    validActions: ActionType[],
    callAmount: number,
    minRaise: number,
    language: "zh" | "en" = "zh",
  ): AgentDecision {
    const personality = parseStyleToPersonality(
      this.id,
      this.name,
      this.avatar,
      this.stylePrompt,
    );

    const ruleResult = ruleDecide(view, personality, validActions, callAmount, minRaise, language);
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
