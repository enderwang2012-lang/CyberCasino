import type {
  AgentGameView,
  AgentDecision,
  ActionType,
  ActionRecord,
} from "@cybercasino/shared";

export interface IPokerAgent {
  readonly id: string;
  readonly name: string;
  readonly avatar: string;
  readonly agentType: "builtin" | "external";
  decide(
    view: AgentGameView,
    validActions: ActionType[],
    callAmount: number,
    minRaise: number,
    language?: "zh" | "en"
  ): Promise<AgentDecision>;
  recordAction(record: ActionRecord): void;
  clearHistory(): void;
}
