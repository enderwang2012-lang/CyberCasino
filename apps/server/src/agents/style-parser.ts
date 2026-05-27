import type { AgentPersonality, HighLevelStyle, StyleProfile } from "@cybercasino/shared";
import { expandHighLevel, resolveStyle } from "./style-resolver";

// ---------------------------------------------------------------------------
// V1: Text-based keyword parsing (backward compatibility)
// ---------------------------------------------------------------------------

const KEYWORDS: { pattern: RegExp; field: keyof Pick<HighLevelStyle, "tightness" | "aggression" | "bluffFrequency">; value: number }[] = [
  { pattern: /aggressive|激进|进攻|压力|凶|疯狗/i, field: "aggression", value: 0.8 },
  { pattern: /conservative|保守|谨慎|稳健|沉稳|老道/i, field: "tightness", value: 0.8 },
  { pattern: /tight|紧|只打好牌|铁公鸡/i, field: "tightness", value: 0.85 },
  { pattern: /loose|松|什么都玩|随意/i, field: "tightness", value: 0.2 },
  { pattern: /passive|被动|跟注/i, field: "aggression", value: 0.2 },
  { pattern: /bluff|诈唬|虚张声势|骗|演技/i, field: "bluffFrequency", value: 0.45 },
  { pattern: /honest|诚实|不骗|实在/i, field: "bluffFrequency", value: 0.05 },
  { pattern: /balanced|平衡|gto/i, field: "aggression", value: 0.5 },
  { pattern: /maniac|疯狂|all.?in|赌徒/i, field: "aggression", value: 0.95 },
  { pattern: /math|数学|概率|计算|理性/i, field: "bluffFrequency", value: 0.1 },
  { pattern: /价值|value/i, field: "bluffFrequency", value: 0.15 },
  { pattern: /trapp?|埋伏|慢打/i, field: "aggression", value: 0.35 },
  { pattern: /适应|adapt|读牌|read/i, field: "bluffFrequency" as any, value: 0.3 },
];

/**
 * V1: Parse natural language style text into HighLevelStyle.
 */
export function parseTextToHighLevel(stylePrompt: string): HighLevelStyle {
  const result: HighLevelStyle = {
    tightness: 0.5,
    aggression: 0.5,
    bluffFrequency: 0.3,
    valueOrientation: 0.5,
    adaptability: 0.5,
  };

  for (const kw of KEYWORDS) {
    if (kw.pattern.test(stylePrompt)) {
      if (kw.field in result) {
        (result as any)[kw.field] = kw.value;
      }
    }
  }

  // Detect value vs bluff orientation
  if (/价值|value|薄价值/i.test(stylePrompt)) {
    result.valueOrientation = 0.7;
  }
  if (/诈唬|bluff|骗/i.test(stylePrompt)) {
    result.valueOrientation = 0.3;
  }

  // Detect adaptability
  if (/适应|adapt|读牌|read|观察/i.test(stylePrompt)) {
    result.adaptability = 0.7;
  }

  return result;
}

/**
 * V1 backward compatibility: parse text to AgentPersonality (old format).
 */
export function parseStyleToPersonality(
  id: string,
  name: string,
  avatar: string,
  stylePrompt: string,
): AgentPersonality {
  const hl = parseTextToHighLevel(stylePrompt);

  const systemPrompt = `你是「${name}」${avatar}，一个正在打德州扑克的玩家。

你的性格和打法风格：
${stylePrompt || "均衡型选手，根据牌面情况灵活调整"}

核心要求：
1. 你的决策必须完全由你的性格风格驱动。如果你是激进型，就应该频繁加注施压；如果你是保守型，就应该只在有把握时出手。
2. "thought" 是你的内心独白——用第一人称、你这个角色的口吻自言自语。要像一个真实的牌手在心里嘀咕，有情绪、有判断、有个性。
3. 绝对不要提及"风格设定"、"prompt"、"系统"等元信息。你就是这个人，不是在扮演。
4. 决策要考虑牌力、位置、底池赔率，但最终要通过你的性格滤镜做出选择。同样的牌面，不同性格会做不同决定——这正是你的价值。`;

  return {
    id,
    name,
    avatar,
    style: stylePrompt.slice(0, 50),
    tightness: hl.tightness ?? 0.5,
    aggression: hl.aggression ?? 0.5,
    bluffFrequency: hl.bluffFrequency ?? 0.3,
    systemPrompt,
  };
}

// ---------------------------------------------------------------------------
// V2: Structured style parsing
// ---------------------------------------------------------------------------

export interface StyleInput {
  // Option A: high-level params
  highLevel?: HighLevelStyle;
  // Option B: full 10-dim profile
  profile?: Partial<StyleProfile>;
  // Option C: text prompt (parsed to highLevel)
  text?: string;
  // Option D: mixed (highLevel + override)
  override?: Partial<StyleProfile>;
}

/**
 * V2: Resolve any style input format to a full StyleProfile.
 *
 * Supports:
 * - { profile: { ... } } → use directly
 * - { highLevel: { ... } } → expand to 10 dimensions
 * - { text: "激进型" } → parse text → expand
 * - { highLevel: {...}, override: {...} } → expand + override
 */
export function parseStyleInput(input: StyleInput): StyleProfile {
  // If full profile provided, use it as base
  if (input.profile) {
    return resolveStyle({ override: input.profile });
  }

  // If highLevel provided, expand it
  if (input.highLevel) {
    return resolveStyle({ highLevel: input.highLevel, override: input.override });
  }

  // If text provided, parse to highLevel then expand
  if (input.text) {
    const hl = parseTextToHighLevel(input.text);
    return resolveStyle({ highLevel: hl, override: input.override });
  }

  // Default: balanced profile
  return resolveStyle();
}
