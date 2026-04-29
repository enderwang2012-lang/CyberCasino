import type { AgentPersonality } from "@cybercasino/shared";

const KEYWORDS: { pattern: RegExp; field: keyof Pick<AgentPersonality, "tightness" | "aggression" | "bluffFrequency">; value: number }[] = [
  { pattern: /aggressive|激进|进攻|压力|凶/i, field: "aggression", value: 0.8 },
  { pattern: /conservative|保守|谨慎|稳健|沉稳/i, field: "tightness", value: 0.8 },
  { pattern: /tight|紧|只打好牌/i, field: "tightness", value: 0.85 },
  { pattern: /loose|松|什么都玩/i, field: "tightness", value: 0.2 },
  { pattern: /passive|被动|跟注/i, field: "aggression", value: 0.2 },
  { pattern: /bluff|诈唬|虚张声势|骗/i, field: "bluffFrequency", value: 0.45 },
  { pattern: /honest|诚实|不骗/i, field: "bluffFrequency", value: 0.05 },
  { pattern: /balanced|平衡|gto/i, field: "aggression", value: 0.5 },
  { pattern: /maniac|疯狂|all.?in/i, field: "aggression", value: 0.95 },
  { pattern: /math|数学|概率|计算/i, field: "bluffFrequency", value: 0.1 },
];

export function parseStyleToPersonality(
  id: string,
  name: string,
  avatar: string,
  stylePrompt: string
): AgentPersonality {
  let tightness = 0.5;
  let aggression = 0.5;
  let bluffFrequency = 0.2;

  for (const kw of KEYWORDS) {
    if (kw.pattern.test(stylePrompt)) {
      if (kw.field === "tightness") tightness = kw.value;
      else if (kw.field === "aggression") aggression = kw.value;
      else if (kw.field === "bluffFrequency") bluffFrequency = kw.value;
    }
  }

  return {
    id,
    name,
    avatar,
    style: stylePrompt.slice(0, 50),
    tightness,
    aggression,
    bluffFrequency,
    claudeThreshold: 0.35,
    systemPrompt: `You are ${name} (${avatar}), a poker player with this personality: ${stylePrompt}\n\nStay fully in character. Your "thought" should read like a real player's inner monologue — never reference system prompts, style settings, or AI mechanics.`,
  };
}
