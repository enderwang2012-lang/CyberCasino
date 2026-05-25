import type {
  AgentGameView,
  AgentDecision,
  AgentThought,
  ActionType,
  StyleProfile,
  DecisionResult,
  Position,
  Street,
} from "@cybercasino/shared";
import { STYLE_DEFAULTS } from "@cybercasino/shared";
import { buildDecisionState, baselinePolicy } from "./baseline-policy";
import { applyStyleModifier } from "./style-modifier";
import { safetyClamp } from "./safety-clamp";
import { selectAction } from "./action-selector";
import { resolveStyle } from "./style-resolver";

// ---------------------------------------------------------------------------
// Decision pipeline: the full decision path
// ---------------------------------------------------------------------------

export interface PipelineResult {
  decision: AgentDecision;
  result: DecisionResult;
}

/**
 * Run the full decision pipeline:
 *   Game State → DecisionState → Baseline Policy → Style Modifier → Safety Clamp → Action Selection
 */
export function runDecisionPipeline(
  view: AgentGameView,
  validActions: ActionType[],
  callAmount: number,
  minRaise: number,
  styleProfile: StyleProfile,
  position: Position,
  handId: string,
  language: "zh" | "en" = "zh",
): PipelineResult {
  // 1. Build decision state
  const state = buildDecisionState(view as any, validActions, callAmount, position, handId);

  // 2. Baseline policy
  const baseline = baselinePolicy(state);

  // 3. Style modifier
  const { adjustedActions, shifts } = applyStyleModifier(baseline, state, styleProfile);

  // 4. Safety clamp
  const { clampedActions, clampsApplied } = safetyClamp(adjustedActions, state);

  // 5. Select action
  const selected = selectAction(clampedActions, state, validActions);

  // 6. Build result
  const thought = buildThought(selected, state, language);
  const probabilities: Record<string, number> = {};
  for (const [k, v] of Object.entries(clampedActions)) {
    probabilities[k] = Math.round(v * 1000) / 1000;
  }

  const result: DecisionResult = {
    chosenAction: {
      type: selected.type,
      amountBb: selected.amountBb,
    },
    probabilities,
    context: {
      street: state.street,
      position: state.hero.position,
      handCategory: state.derived.handCategory,
      boardTexture: state.board.texture,
      potOdds: state.derived.potOdds,
      spr: state.derived.spr,
      multiway: state.derived.multiway,
    },
    influences: {
      baselineTopAction: Object.entries(baseline.actions)
        .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0] ?? "unknown",
      styleShifts: shifts,
      opponentShifts: [],
      clampsApplied,
    },
    audit: {
      baselineVersion: "v2.0",
      styleProfileVersion: "v2.0",
      policySeed: "",
      hiddenInformationIsolationPassed: true,
    },
  };

  return {
    decision: {
      action: {
        type: selected.type === "all_in" ? "raise" : selected.type,
        amount: selected.amountBb
          ? selected.amountBb * view.bigBlind
          : undefined,
      },
      thought,
    },
    result,
  };
}

// ---------------------------------------------------------------------------
// Thought generation (persona-based)
// ---------------------------------------------------------------------------

function buildThought(
  selected: { type: string; amountBb?: number },
  state: { street: Street; derived: { handCategory?: string; handStrength?: number; potOdds?: number } },
  language: "zh" | "en",
): AgentThought {
  const cat = state.derived.handCategory ?? "pure_air";
  const strength = state.derived.handStrength ?? 0.5;
  const isBluff = cat === "pure_air" || cat === "air_with_blocker";

  const messages: Record<string, Record<string, string[]>> = {
    zh: {
      nuts: ["坚果牌，必须榨取最大价值", "完美手牌，稳步推进", "这手牌无人能敌"],
      very_strong_value: ["强价值牌，下注施压", "好牌，值得大注", "对手很难弃掉这些牌"],
      medium_value: ["中等牌力，控制底池", "有摊牌价值，小心行事", "不错的牌，但别过度投入"],
      thin_value: ["薄价值，谨慎下注", " marginal spot，小心为上", "可下可过，看情况"],
      showdown_value: ["摊牌价值，过牌控池", "不值得投入太多", "能赢但别冒险"],
      strong_draw: ["强听牌，半诈唬机会", "听牌不错，值得继续", "outs 够多，值得追"],
      weak_draw: ["弱听牌，谨慎行事", "听牌不够强，倾向放弃", "赔率不合适"],
      air_with_blocker: ["空气牌但有 blocker", "可以尝试诈唬", "没什么牌力"],
      pure_air: ["空气牌，寻找诈唬机会", "什么都没有", "这手牌很难打"],
    },
    en: {
      nuts: ["The nuts, max value extraction", "Unbeatable hand, let's go", "Monster time"],
      very_strong_value: ["Strong value, bet for pressure", "Great hand, worth a big bet", "Hard for opponents to fold"],
      medium_value: ["Medium strength, pot control", "Showdown value, play carefully", "Decent but don't overcommit"],
      thin_value: ["Thin value, bet cautiously", "Marginal spot, tread carefully", "Could go either way"],
      showdown_value: ["Showdown value, check to control", "Not worth committing more", "Can win but don't risk it"],
      strong_draw: ["Strong draw, semi-bluff opportunity", "Good draws, worth continuing", "Enough outs to chase"],
      weak_draw: ["Weak draw, play cautiously", "Draws not strong enough", "Odds aren't there"],
      air_with_blocker: ["Air with blocker, possible bluff", "Can try a bluff", "Not much hand strength"],
      pure_air: ["Pure air, look for bluff spots", "Nothing here", "Tough spot with this hand"],
    },
  };

  const lines = messages[language]?.[cat] ?? messages.zh.pure_air;
  const message = lines[Math.floor(Math.random() * lines.length)];

  return {
    message,
    confidence: strength,
    isBluffing: isBluff,
    thinkingSource: "rule",
  };
}

// ---------------------------------------------------------------------------
// Convenience: resolve style from config and run pipeline
// ---------------------------------------------------------------------------

/**
 * Run pipeline with StyleConfig (dual-layer: highLevel + override).
 */
export function runPipelineWithConfig(
  view: AgentGameView,
  validActions: ActionType[],
  callAmount: number,
  minRaise: number,
  styleConfig: { highLevel?: any; override?: Partial<StyleProfile> },
  position: Position,
  handId: string,
  language: "zh" | "en" = "zh",
): PipelineResult {
  const profile = resolveStyle(styleConfig);
  return runDecisionPipeline(view, validActions, callAmount, minRaise, profile, position, handId, language);
}
