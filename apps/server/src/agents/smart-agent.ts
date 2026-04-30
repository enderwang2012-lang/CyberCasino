import type {
  AgentConfig,
  AgentGameView,
  AgentDecision,
  ActionType,
  AgentPersonality,
  ActionRecord,
} from "@cybercasino/shared";
import type { IPokerAgent } from "./agent-interface";
import { ruleFallback } from "./rule-engine";
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
    // A) LLM-first: stylePrompt drives decision, rule engine is only fallback
    try {
      return await claudeDecide(view, this.personality, validActions, callAmount, minRaise);
    } catch {
      return ruleFallback(view, this.personality, validActions, callAmount);
    }
  }
}
