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
    const ruleResult = ruleDecide(view, this.personality, validActions, callAmount, minRaise);

    if (ruleResult.decision && ruleResult.confidence >= this.personality.claudeThreshold) {
      return ruleResult.decision;
    }

    try {
      return await claudeDecide(view, this.personality, validActions, callAmount, minRaise);
    } catch {
      if (ruleResult.decision) return ruleResult.decision;
      return ruleFallback(view, this.personality, validActions, callAmount);
    }
  }
}
