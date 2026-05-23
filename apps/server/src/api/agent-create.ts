import type { StrategyConfig, AgentPreview, AgentConfigV2, Position } from "@cybercasino/shared";

const POSITIONS: Position[] = ["UTG", "MP", "CO", "BTN", "SB", "BB"];

export interface CreateAgentRequest {
  config: StrategyConfig;
  preview: AgentPreview;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateStrategyConfig(config: StrategyConfig): ValidationResult {
  const errors: string[] = [];

  // 检查 preflop 存在且 6 个位置都有 ranges
  if (!config.preflop) {
    errors.push("preflop 配置缺失");
  } else if (!config.preflop.ranges) {
    errors.push("preflop.ranges 配置缺失");
  } else {
    for (const pos of POSITIONS) {
      const range = config.preflop.ranges[pos];
      if (!range) {
        errors.push(`preflop.ranges 缺少位置: ${pos}`);
      } else {
        const hasRanges = (range.raise && range.raise.length > 0) ||
          (range.call && range.call.length > 0) ||
          (range.fold && range.fold.length > 0);
        if (!hasRanges) {
          errors.push(`preflop.ranges.${pos} 至少需要一个非空 range（raise/call/fold）`);
        }
      }
    }
  }

  // 检查 preflop.sizing.openRaise 存在
  if (!config.preflop?.sizing || !config.preflop.sizing.openRaise) {
    errors.push("preflop.sizing.openRaise 缺失");
  }

  // 检查 postflop 至少 3 条规则
  if (!config.postflop || !Array.isArray(config.postflop) || config.postflop.length < 3) {
    errors.push("postflop 规则至少需要 3 条");
  }

  // 检查 imperfection.baseMistakeRate 在 0-0.15
  if (config.imperfection) {
    const rate = config.imperfection.baseMistakeRate;
    if (typeof rate !== "number" || rate < 0 || rate > 0.15) {
      errors.push("imperfection.baseMistakeRate 必须在 0 到 0.15 之间");
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validatePreview(preview: AgentPreview): ValidationResult {
  const errors: string[] = [];

  // name 1-20 字符
  if (!preview.name || typeof preview.name !== "string") {
    errors.push("牌手名称不能为空");
  } else if (preview.name.length < 1 || preview.name.length > 20) {
    errors.push("牌手名称长度必须在 1-20 字符之间");
  }

  // sampleThoughts 至少 1 条
  if (!preview.sampleThoughts || !Array.isArray(preview.sampleThoughts) || preview.sampleThoughts.length < 1) {
    errors.push("sampleThoughts 至少需要 1 条");
  }

  return { valid: errors.length === 0, errors };
}

export function createAgentFromAI(
  userId: string,
  request: CreateAgentRequest,
  nextId: () => string,
  soulKey?: string,
  skillId?: string,
): AgentConfigV2 {
  const now = Date.now();
  return {
    id: nextId(),
    userId,
    name: request.preview.name,
    avatar: request.preview.avatar ?? "🤖",
    description: request.preview.description,
    strategy: request.config,
    soulKey,
    skillId,
    createdAt: now,
    updatedAt: now,
  };
}