import type {
  AgentGameView,
  AgentDecision,
  ActionType,
  AgentPersonality,
  ActionRecord,
} from "@cybercasino/shared";
import type { IPokerAgent } from "./agent-interface";
import { ruleDecide, ruleFallback } from "./rule-engine";
import { claudeDecide } from "./claude-agent";
import { getPersonality } from "./personalities";

export class PokerAgent implements IPokerAgent {
  readonly personality: AgentPersonality;
  readonly agentType = "builtin" as const;
  private actionHistory: ActionRecord[] = [];

  constructor(personalityId: string) {
    this.personality = getPersonality(personalityId);
  }

  get id(): string {
    return this.personality.id;
  }

  get name(): string {
    return this.personality.name;
  }

  get avatar(): string {
    return this.personality.avatar;
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
