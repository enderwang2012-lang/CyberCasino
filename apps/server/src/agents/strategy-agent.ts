import type {
  AgentGameView,
  AgentDecision,
  AgentThought,
  ActionType,
  ActionRecord,
  Position,
  Street,
  AgentConfigV2,
  StrategyConfig,
  ExpressionConfig,
  ThoughtLanguage,
  ImperfectionConfig,
  PlayerProfile,
  PostflopCondition,
} from "@cybercasino/shared";
import type { PostflopContext } from "./strategy/postflop";
import type { IPokerAgent } from "./agent-interface";
import type { PsychologicalState } from "./imperfection/psychological-state";
import { decidePreflop } from "./strategy";
import { decidePostflop, classifyHand } from "./strategy";
import { calculateDifficulty, estimateHandStrength } from "./imperfection/decision-difficulty";
import { buildDecisionDistribution, sampleFromDistribution } from "./imperfection/decision-distribution";
import { createInitialState, updateAfterHand, describeState } from "./imperfection/psychological-state";
import { generateThought, classifyPreflopHand } from "./thought/thought-generator";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_IMPERFECTION: ImperfectionConfig = {
  baseMistakeRate: 0.04,
  tendencies: {
    scaredFold: 0.15,
    stickyCall: 0.15,
    slowplayBias: 0.1,
    tiltAggression: 0.2,
  },
  tilt: {
    triggerThreshold: 0.5,
    decayRate: 0.1,
    maxLevel: 0.8,
  },
  confidenceNoise: 0.1,
};

function defaultExpression(language: "zh" | "en" = "zh"): ExpressionConfig {
  return {
    thoughtLanguage: language as ThoughtLanguage,
    tone: { warmth: 0.5, sass: 0.3, intensity: 0.5, humor: 0.3 },
    catchphrases: [],
    verbalTics: [],
    thoughtTemplates: {
      confident: "{handDesc}。{actionDesc}。",
      worried: "{handDesc}，有些不确定...",
      bluffing: "{handDesc}，试试看...",
      frustrated: "{handDesc}，可恶...",
    },
  };
}

const POSITION_ORDER_3: Position[] = ["BTN", "SB", "BB"];

// ---------------------------------------------------------------------------
// StrategyAgent
// ---------------------------------------------------------------------------

export class StrategyAgent implements IPokerAgent {
  readonly id: string;
  readonly name: string;
  readonly avatar: string;
  readonly agentType: "builtin" | "external" = "external";

  private config: StrategyConfig;
  private actionHistory: ActionRecord[] = [];
  private profiles: Map<string, PlayerProfile> = new Map();
  private psychState: PsychologicalState;

  constructor(agentConfig: AgentConfigV2) {
    this.id = agentConfig.id;
    this.name = agentConfig.name;
    this.avatar = agentConfig.avatar;
    this.config = agentConfig.strategy;
    this.psychState = createInitialState();
  }

  // -----------------------------------------------------------------------
  // IPokerAgent
  // -----------------------------------------------------------------------

  async decide(
    view: AgentGameView,
    validActions: ActionType[],
    callAmount: number,
    minRaise: number,
    language: "zh" | "en" = "zh",
  ): Promise<AgentDecision> {
    const position = this.detectPosition(view);
    const isIP = this.detectIsIP(view);
    const playerCount = view.players.length;

    // Resolve config with defaults
    const imperfection = this.config.imperfection ?? DEFAULT_IMPERFECTION;
    const expression = this.config.expression ?? defaultExpression(language);

    // ---------- Strategic decision ----------
    let strategicAction: ActionType;
    let strategicAmount: number | undefined;
    let preflopAdjustments: string[] | undefined;

    if (view.phase === "preflop") {
      const result = decidePreflop(
        view.myCards,
        position,
        this.config.preflop,
        callAmount,
        minRaise,
        view.bigBlind,
        view.currentBet,
        view,
      );

      if (result) {
        strategicAction = result.action;
        strategicAmount = result.amount;
        preflopAdjustments = result.adjustments;
      } else {
        strategicAction = "fold";
      }
    } else {
      // Postflop: build context
      const potSize = view.pots.reduce((sum, p) => sum + p.amount, 0);
      const ctx: PostflopContext = {
        myCards: view.myCards,
        communityCards: view.communityCards,
        street: view.phase as Street,
        isIP,
        potSize,
        callAmount,
      };

      const postflopDecision = decidePostflop(
        ctx,
        this.config.postflop,
        view.currentBet,
        minRaise,
        validActions,
      );

      strategicAction = postflopDecision.action;
      strategicAmount = postflopDecision.amount;
    }

    // ---------- Imperfection: humanize the decision ----------
    const handStrength = estimateHandStrength(view);

    const opponentUncertainty = playerCount > 2
      ? Math.max(0.1, 0.5 - 0.05 * (playerCount - 2))
      : 0.1;

    const potSize = view.pots.reduce((sum, p) => sum + p.amount, 0);

    const difficulty = calculateDifficulty({
      handStrength,
      potPressure: potSize > 0
        ? Math.min(1, potSize / (view.myChips + view.myBet + 1))
        : 0,
      opponentUncertainty,
      viableOptions: validActions.length,
      isAllIn: validActions.includes("raise")
        ? (callAmount >= view.myChips)
        : false,
      callAmount,
      stackSize: view.myChips,
    });

    const distribution = buildDecisionDistribution(
      strategicAction,
      validActions,
      difficulty,
      imperfection,
      this.psychState.tilt,
    );

    const sampled = sampleFromDistribution(distribution.weights);
    const finalAction: ActionType = sampled.action;

    // ---------- Raise amount ----------
    let raiseAmount: number | undefined;
    if (finalAction === "raise") {
      if (finalAction === strategicAction && strategicAmount != null) {
        raiseAmount = Math.max(minRaise, strategicAmount);
      } else {
        // Mistake-raise: default to pot-sized
        raiseAmount = Math.max(minRaise, Math.round(potSize * 0.5));
      }
    }

    // ---------- Thought generation ----------
    let thought = this.generateThoughtForAction(
      view,
      finalAction,
      expression,
      isIP,
      potSize,
      callAmount,
      preflopAdjustments,
    );

    // If it was a mistake, annotate the thought
    if (sampled.isMistake) {
      thought = {
        ...thought,
        isMistake: true,
        difficulty,
        psychologicalState: describeState(this.psychState),
      };
    }

    return {
      action: {
        type: finalAction,
        amount: raiseAmount,
      },
      thought,
    };
  }

  recordAction(record: ActionRecord): void {
    this.actionHistory.push(record);
  }

  clearHistory(): void {
    this.actionHistory = [];
  }

  // -----------------------------------------------------------------------
  // Public helpers (Phase 10 will call these)
  // -----------------------------------------------------------------------

  /**
   * Update psychological state after a hand result.
   * Called externally (e.g. by the table instance) after each hand.
   */
  updatePsychState(result: {
    wasBadBeat: boolean;
    wasBluffCaught: boolean;
    bigLoss: boolean;
    bigWin: boolean;
    handsSinceAction: number;
  }): void {
    const imperfection = this.config.imperfection ?? DEFAULT_IMPERFECTION;
    this.psychState = updateAfterHand(
      this.psychState,
      result,
      imperfection.tilt,
    );
  }

  /** Access the action history for debugging / replay. */
  get history(): ActionRecord[] {
    return this.actionHistory;
  }

  /** Access the current psychological state. */
  get psychologicalState(): PsychologicalState {
    return this.psychState;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private detectPosition(view: AgentGameView): Position {
    const mySeat = view.players.find((p) => p.id === view.myId)?.seatIndex ?? 0;
    const dealerSeat = view.dealerSeatIndex;
    const playerCount = view.players.length;

    // Offset from the dealer (wrapping around the table)
    const offset = (mySeat - dealerSeat + playerCount) % playerCount;

    if (playerCount <= 3) {
      return POSITION_ORDER_3[offset] ?? "MP";
    }

    // 6-max: BTN(0), SB(1), BB(2), UTG(3), MP(middle), CO(last)
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

  /**
   * Generate an AgentThought for the final action using hand classification
   * and the agent's expression config.
   */
  private generateThoughtForAction(
    view: AgentGameView,
    action: ActionType,
    expression: ExpressionConfig,
    isIP: boolean,
    potSize: number,
    callAmount: number,
    preflopAdjustments?: string[],
  ): AgentThought {
    const baseConfidence = 0.5 + this.psychState.confidence * 0.3 - this.psychState.fear * 0.2 - this.psychState.tilt * 0.1;
    const confidence = Math.max(0.1, Math.min(0.95, baseConfidence));

    // Preflop: hand-strength-aware thought
    if (view.phase === "preflop") {
      const lang: "zh" | "en" = expression.thoughtLanguage === "en" ? "en" : "zh";
      const category = action === "raise" && Math.random() < (expression.catchphrases.length > 0 ? 0.3 : 0)
        ? "bluff"
        : classifyPreflopHand(view.myCards);

      const isBluff = category === "bluff";
      const posName = this.detectPosition(view);

      // Pick a thought from the agent's expression templates
      let message = this.pickPreflopThought(category, action, posName, expression, lang, preflopAdjustments);

      // Optionally append catchphrase (30% chance)
      if (expression.catchphrases.length > 0 && Math.random() < 0.3) {
        const idx = Math.floor(Math.random() * expression.catchphrases.length);
        message += " " + expression.catchphrases[idx];
      }

      // Optionally append verbal tic (50% chance)
      if (expression.verbalTics.length > 0 && Math.random() < 0.5) {
        const idx = Math.floor(Math.random() * expression.verbalTics.length);
        message += " " + expression.verbalTics[idx];
      }

      return {
        message: message.trim(),
        confidence: Math.round(confidence * 100) / 100,
        isBluffing: isBluff,
        thinkingSource: "strategy",
      };
    }

    // Postflop: use the thought generator with hand classification
    const ctx: PostflopContext = {
      myCards: view.myCards,
      communityCards: view.communityCards,
      street: view.phase as Street,
      isIP,
      potSize,
      callAmount,
    };

    const conditions: PostflopCondition[] = classifyHand(ctx);
    const generated = generateThought(
      conditions[0],
      action,
      expression,
      this.psychState,
    );

    return generated;
  }

  /**
   * Pick a contextual preflop thought based on hand strength and action.
   * Uses the agent's expression tone/style to influence the wording.
   */
  private pickPreflopThought(
    category: "premium" | "good" | "trash" | "bluff",
    action: ActionType,
    position: string,
    expression: ExpressionConfig,
    lang: "zh" | "en",
    preflopAdjustments?: string[],
  ): string {
    const { tone } = expression;

    // Base thoughts per category × action
    const zhThoughts: Record<string, Record<string, string[]>> = {
      premium: {
        raise: ["好牌在手，该加注了", "这手牌值得重注", "等到了，加注！"],
        call: ["好牌，先看看翻牌", "稳一手，跟注看看"],
        fold: ["这么好的牌...算了，纪律第一"],
        check: ["好牌过牌，引诱对手"],
      },
      good: {
        raise: ["还不错，试试水", "这手牌可以玩", "加注探探路"],
        call: ["还行，跟一手看看", "不着急，慢慢来"],
        fold: ["不太行，放弃吧"],
        check: ["过牌看看情况"],
      },
      trash: {
        raise: ["来点刺激的！", "赌一把！", "假装有牌~"],
        call: ["便宜就看看", "反正不贵"],
        fold: ["不是我的牌", "pass", "弃了"],
        check: ["免费看一张"],
      },
      bluff: {
        raise: ["演戏时间到", "虚虚实实~", "来骗来偷袭"],
        call: ["先混进去再说"],
        fold: ["这次不演了"],
        check: ["装弱..."],
      },
    };

    const enThoughts: Record<string, Record<string, string[]>> = {
      premium: {
        raise: ["Premium hand, time to raise", "This deserves a big bet", "Finally, let's go"],
        call: ["Good hand, let's see the flop", "Patience, just call"],
        fold: ["Even with this hand... discipline first"],
        check: ["Slowplay, trap them"],
      },
      good: {
        raise: ["Not bad, let's test the waters", "Worth a raise"],
        call: ["Decent hand, let's see", "No rush, just call"],
        fold: ["Not good enough, let it go"],
        check: ["Check and observe"],
      },
      trash: {
        raise: ["Time for some chaos!", "Let's gamble!", "Pretending I have it~"],
        call: ["Cheap enough to look", "Why not"],
        fold: ["Trash, pass", "Not my hand"],
        check: ["Free card"],
      },
      bluff: {
        raise: ["Showtime!", "Now you see it, now you don't~", "Let's put on a show"],
        call: ["Sneak in for now"],
        fold: ["Not this time"],
        check: ["Playing weak..."],
      },
    };

    const thoughts = (lang === "en" ? enThoughts : zhThoughts)[category]?.[action]
      ?? (lang === "en" ? ["Thinking..."] : ["想想..."]);

    let message = thoughts[Math.floor(Math.random() * thoughts.length)];

    // Append context reasoning when dynamic adjustments were applied
    if (preflopAdjustments && preflopAdjustments.length > 0) {
      const reasoning = preflopAdjustments[0]; // primary adjustment
      message += lang === "en"
        ? ` — ${reasoning}`
        : `，${reasoning}`;
    }

    return message;
  }
}