import type {
  AgentGameView,
  AgentDecision,
  AgentThought,
  ActionType,
  ActionRecord,
  SkillConfig,
  Card,
} from "@cybercasino/shared";
import type { IPokerAgent } from "./agent-interface";
import type { PostflopContext } from "./strategy/postflop";
import { decidePreflop, decidePostflop, classifyHand } from "./strategy";
import { estimateHandStrength } from "./imperfection/decision-difficulty";
import { generateThought, classifyPreflopHand } from "./thought/thought-generator";
import { createInitialState } from "./imperfection/psychological-state";
import { callWebhook } from "./webhook-caller";
import { getClient, getModel } from "./llm-client";
import type { PsychologicalState } from "./imperfection/psychological-state";

const POSITION_ORDER_3 = ["BTN", "SB", "BB"] as const;

interface HybridAgentConfig {
  id: string;
  name: string;
  avatar: string;
  webhookUrl?: string;
  usePlatformLlm?: boolean;
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

    // Step 2: LLM thinking — platform LLM or webhook
    const strategyHint = {
      suggestedAction: strategyResult.action,
      confidence: strategyResult.confidence,
      handStrength: strategyResult.handStrength,
    };

    if (this.config.usePlatformLlm) {
      const llmResult = await this.callPlatformLlm(view, validActions, callAmount, minRaise, strategyHint);
      if (llmResult) return llmResult;
    } else if (this.config.webhookUrl) {
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

  // -----------------------------------------------------------------------
  // Platform LLM direct call
  // -----------------------------------------------------------------------

  private async callPlatformLlm(
    view: AgentGameView,
    validActions: ActionType[],
    callAmount: number,
    minRaise: number,
    strategyHint: { suggestedAction: ActionType; confidence: number; handStrength: number },
  ): Promise<AgentDecision | null> {
    try {
      const prompt = this.buildLlmPrompt(view, validActions, callAmount, minRaise, strategyHint);

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("LLM API timeout (30s)")), 30000)
      );

      const response = await Promise.race([
        getClient().chat.completions.create({
          model: getModel(),
          max_tokens: 300,
          temperature: 0.7,
          messages: [
            { role: "system", content: this.skill.systemPrompt },
            { role: "user", content: prompt },
          ],
        }),
        timeoutPromise,
      ]);

      const text = response.choices[0]?.message?.content ?? "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]);
      const action = parsed.action as string;
      if (!validActions.includes(action as ActionType)) return null;

      return {
        action: {
          type: action as ActionType,
          amount: action === "raise"
            ? Math.max(parsed.amount ?? (view.currentBet + minRaise), view.currentBet + minRaise)
            : undefined,
        },
        thought: {
          message: parsed.thought ?? "...",
          confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.5)),
          isBluffing: parsed.isBluffing ?? false,
          thinkingSource: "llm",
        },
      };
    } catch (error) {
      console.warn(`[HybridAgent:${this.id}] platform LLM failed:`, (error as Error).message);
      return null;
    }
  }

  private buildLlmPrompt(
    view: AgentGameView,
    validActions: ActionType[],
    callAmount: number,
    minRaise: number,
    strategyHint: { suggestedAction: ActionType; confidence: number; handStrength: number },
  ): string {
    const suitSymbols: Record<string, string> = { h: "♥", d: "♦", c: "♣", s: "♠" };
    const rankNames: Record<number, string> = { 2:"2",3:"3",4:"4",5:"5",6:"6",7:"7",8:"8",9:"9",10:"10",11:"J",12:"Q",13:"K",14:"A" };
    const cardStr = (c: Card) => `${rankNames[c.rank]}${suitSymbols[c.suit]}`;

    const myCards = view.myCards.map(cardStr).join(" ");
    const community = view.communityCards.length > 0 ? view.communityCards.map(cardStr).join(" ") : "(无)";
    const potSize = view.pots.reduce((s, p) => s + p.amount, 0);

    const opponents = view.players
      .filter((p) => p.id !== view.myId && !p.folded)
      .map((p) => `  ${p.name}: ${p.chips} 筹码, bet ${p.bet}${p.allIn ? " [ALL-IN]" : ""}`)
      .join("\n");

    const recentActions = view.actionHistory
      .slice(-10)
      .map((a) => `  ${a.playerId}: ${a.action.type}${a.action.amount ? ` ${a.action.amount}` : ""}`)
      .join("\n");

    const hint = `\n策略引擎建议: ${strategyHint.suggestedAction} (置信度 ${Math.round(strategyHint.confidence * 100)}%, 手牌强度 ${Math.round(strategyHint.handStrength * 100)}%)\n`;

    return `你是德州扑克牌手，请分析当前局面并做出决策。

你的手牌: ${myCards}
公共牌: ${community}
阶段: ${view.phase}
你的筹码: ${view.myChips}
当前底池: ${potSize}
需要跟注: ${callAmount}
最小加注到: ${view.currentBet + minRaise}

对手:
${opponents}

最近行动:
${recentActions || "  (无)"}

合法动作: ${validActions.join(", ")}
${hint}
请返回 JSON（不要 markdown 包裹）:
{ "action": "fold"|"check"|"call"|"raise", "amount": 数字(加注时), "thought": "你的内心独白1-2句", "isBluffing": true/false, "confidence": 0-1 }`;
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
