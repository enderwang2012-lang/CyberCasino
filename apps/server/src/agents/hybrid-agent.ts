import type {
  AgentGameView,
  AgentDecision,
  AgentThought,
  ActionType,
  ActionRecord,
  SkillConfig,
} from "@cybercasino/shared";
import type { IPokerAgent } from "./agent-interface";
import type { PostflopContext } from "./strategy/postflop";
import { decidePreflop, decidePostflop, classifyHand } from "./strategy";
import { estimateHandStrength } from "./imperfection/decision-difficulty";
import { generateThought, classifyPreflopHand } from "./thought/thought-generator";
import { createInitialState } from "./imperfection/psychological-state";
import { callWebhook } from "./webhook-caller";
import type { PsychologicalState } from "./imperfection/psychological-state";

const POSITION_ORDER_3 = ["BTN", "SB", "BB"] as const;

interface HybridAgentConfig {
  id: string;
  name: string;
  avatar: string;
  webhookUrl?: string;
  skill: SkillConfig;
  preflop: any;
  postflop: any[];
  expression?: any;
}

export class HybridAgent implements IPokerAgent {
  readonly id: string;
  readonly name: string;
  readonly avatar: string;
  readonly agentType: "builtin" | "external" = "builtin";

  private config: HybridAgentConfig;
  private skill: SkillConfig;
  private actionHistory: ActionRecord[] = [];
  private psychState: PsychologicalState;

  constructor(config: HybridAgentConfig) {
    this.id = config.id;
    this.name = config.name;
    this.avatar = config.avatar;
    this.config = config;
    this.skill = config.skill;
    this.psychState = createInitialState();
  }

  async decide(
    view: AgentGameView,
    validActions: ActionType[],
    callAmount: number,
    minRaise: number,
    language: "zh" | "en" = "zh",
  ): Promise<AgentDecision> {
    const position = this.detectPosition(view);
    const isIP = this.detectIsIP(view);
    const potSize = view.pots.reduce((s, p) => s + p.amount, 0);

    // Step 1: 策略引擎快速评估
    const strategyResult = this.strategyEvaluate(view, position, isIP, validActions, callAmount, minRaise, potSize);

    // Step 2: 尝试 LLM webhook
    if (this.config.webhookUrl) {
      const strategyHint = {
        suggestedAction: strategyResult.action,
        confidence: strategyResult.confidence,
        handStrength: strategyResult.handStrength,
      };

      const webhookResult = await callWebhook(
        this.config.webhookUrl,
        view, validActions, callAmount, minRaise,
        this.skill.systemPrompt,
        this.skill,
        strategyHint,
      );

      if (webhookResult.success && webhookResult.response) {
        const resp = webhookResult.response;
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
    }

    // Step 3: 降级到策略引擎
    return {
      action: {
        type: strategyResult.action,
        amount: strategyResult.amount,
      },
      thought: this.generateStrategyThought(view, strategyResult.action, strategyResult.handStrength, isIP, potSize, callAmount, language),
    };
  }

  recordAction(record: ActionRecord): void {
    this.actionHistory.push(record);
  }

  clearHistory(): void {
    this.actionHistory = [];
  }

  private strategyEvaluate(
    view: AgentGameView,
    position: string,
    isIP: boolean,
    validActions: ActionType[],
    callAmount: number,
    minRaise: number,
    potSize: number,
  ): { action: ActionType; amount?: number; confidence: number; handStrength: number } {
    let strategicAction: ActionType;
    let strategicAmount: number | undefined;

    if (view.phase === "preflop") {
      const result = decidePreflop(
        view.myCards, position as any, this.config.preflop,
        callAmount, minRaise, view.bigBlind, view.currentBet, view,
      );
      strategicAction = result?.action ?? "fold";
      strategicAmount = result?.amount;
    } else {
      const ctx: PostflopContext = {
        myCards: view.myCards,
        communityCards: view.communityCards,
        street: view.phase as any,
        isIP,
        potSize,
        callAmount,
      };
      const postflopDecision = decidePostflop(ctx, this.config.postflop, view.currentBet, minRaise, validActions);
      strategicAction = postflopDecision.action;
      strategicAmount = postflopDecision.amount;
    }

    const handStrength = estimateHandStrength(view);

    return {
      action: strategicAction,
      amount: strategicAmount,
      confidence: 0.5 + handStrength * 0.3,
      handStrength,
    };
  }

  private generateStrategyThought(
    view: AgentGameView,
    action: ActionType,
    handStrength: number,
    isIP: boolean,
    potSize: number,
    callAmount: number,
    language: "zh" | "en",
  ): AgentThought {
    const baseConfidence = 0.5 + this.psychState.confidence * 0.3 - this.psychState.fear * 0.2;
    const confidence = Math.max(0.1, Math.min(0.95, baseConfidence));

    let message: string;
    if (view.phase === "preflop") {
      const category = classifyPreflopHand(view.myCards);
      const isZh = language === "zh";
      const thoughts: Record<string, string[]> = {
        premium: isZh ? ["好牌在手，该出手了", "这手牌值得玩"] : ["Premium hand, let's go"],
        good: isZh ? ["还不错，看看翻牌"] : ["Decent, let's see"],
        trash: isZh ? ["算了，这牌不行"] : ["Not worth it"],
        bluff: isZh ? ["来点刺激的！"] : ["Time for some action!"],
      };
      message = thoughts[category]?.[0] ?? (isZh ? "想想..." : "Thinking...");
    } else {
      const ctx: PostflopContext = {
        myCards: view.myCards,
        communityCards: view.communityCards,
        street: view.phase as any,
        isIP,
        potSize,
        callAmount,
      };
      const conditions = classifyHand(ctx);
      const defaultExpression = language === "zh" ? {
        thoughtLanguage: "zh" as const,
        tone: { warmth: 0.5, sass: 0.3, intensity: 0.5, humor: 0.3 },
        catchphrases: [] as string[],
        verbalTics: [] as string[],
        thoughtTemplates: { confident: "{handDesc}。{actionDesc}。", worried: "{handDesc}...", bluffing: "{handDesc}...", frustrated: "{handDesc}..." },
      } : {
        thoughtLanguage: "en" as const,
        tone: { warmth: 0.5, sass: 0.3, intensity: 0.5, humor: 0.3 },
        catchphrases: [] as string[],
        verbalTics: [] as string[],
        thoughtTemplates: { confident: "{handDesc}. {actionDesc}.", worried: "{handDesc}...", bluffing: "{handDesc}...", frustrated: "{handDesc}..." },
      };
      const generated = generateThought(conditions[0], action, this.config.expression ?? defaultExpression, this.psychState);
      message = generated.message;
    }

    return {
      message,
      confidence,
      isBluffing: action === "raise" && handStrength < 0.3 && Math.random() < this.skill.strategyParams.bluffFrequency,
      thinkingSource: "strategy",
    };
  }

  private detectPosition(view: AgentGameView): string {
    const mySeat = view.players.find((p) => p.id === view.myId)?.seatIndex ?? 0;
    const dealerSeat = view.dealerSeatIndex;
    const playerCount = view.players.length;
    const offset = (mySeat - dealerSeat + playerCount) % playerCount;

    if (playerCount <= 3) {
      return (POSITION_ORDER_3 as readonly string[])[offset] ?? "MP";
    }
    if (offset === 0) return "BTN";
    if (offset === 1) return "SB";
    if (offset === 2) return "BB";
    if (offset === 3) return "UTG";
    if (offset === playerCount - 1) return "CO";
    return "MP";
  }

  private detectIsIP(view: AgentGameView): boolean {
    const position = this.detectPosition(view);
    return position === "BTN" || position === "CO";
  }
}
