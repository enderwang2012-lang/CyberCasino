import type {
  AgentConfig,
  AgentGameView,
  AgentDecision,
  ActionType,
  AgentPersonality,
  ActionRecord,
} from "@cybercasino/shared";
import type { IPokerAgent } from "./agent-interface";
import { ruleDecide, ruleFallback } from "./rule-engine";
import { claudeDecide } from "./claude-agent";
import { parseStyleToPersonality } from "./style-parser";

export class SmartAgent implements IPokerAgent {
  readonly id: string;
  readonly name: string;
  readonly avatar: string;
  readonly agentType = "smart" as const;
  readonly personality: AgentPersonality;
  private actionHistory: ActionRecord[] = [];

  constructor(config: AgentConfig) {
    this.id = config.id;
    this.name = config.name;
    this.avatar = config.avatar;
    this.personality = parseStyleToPersonality(
      config.id,
      config.name,
      config.avatar,
      config.stylePrompt
    );
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
    // Hybrid: LLM decides with stylePrompt influence, rule engine provides sanity check
    const ruleResult = ruleDecide(view, this.personality, validActions, callAmount, minRaise);

    try {
      const llmDecision = await claudeDecide(view, this.personality, validActions, callAmount, minRaise);

      // Sanity check: if rule engine has very high confidence (>= 0.85) and
      // LLM contradicts it, override the action but keep LLM's thought
      if (ruleResult.decision && ruleResult.confidence >= 0.85) {
        const ruleAction = ruleResult.decision.action.type;
        const llmAction = llmDecision.action.type;

        // Prevent catastrophic mistakes (fold premium, raise trash)
        if (ruleAction !== llmAction) {
          return {
            action: ruleResult.decision.action,
            thought: llmDecision.thought,
          };
        }
      }

      return llmDecision;
    } catch {
      if (ruleResult.decision) {
        ruleResult.decision.thought.message = ruleResult.decision.thought.message === "..."
          ? "[AI 思考中断，自动决策]"
          : ruleResult.decision.thought.message;
        return ruleResult.decision;
      }
      return ruleFallback(view, this.personality, validActions, callAmount);
    }
  }
}
