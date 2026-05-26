import type { StrategyConfig, StrategyPackage, AgentPreview, AgentConfigV2, ArenaExecutionMode, Position } from "@cybercasino/shared";
import { createStrategyPackage, hashStrategy } from "../agents/strategy-package";

const POSITIONS: Position[] = ["UTG", "MP", "CO", "BTN", "SB", "BB"];

export interface CreateAgentRequest {
  config?: StrategyConfig;
  strategyPackage?: StrategyPackage;
  executionMode?: ArenaExecutionMode;
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

export function validateStrategyPackage(strategyPackage: StrategyPackage): ValidationResult {
  const errors: string[] = [];
  if (!strategyPackage?.manifest || strategyPackage.manifest.runtime !== "declarative_v1") {
    errors.push("strategyPackage.manifest.runtime 必须为 declarative_v1");
  }
  if (!Number.isInteger(strategyPackage?.manifest?.version) || strategyPackage.manifest.version < 1) {
    errors.push("strategyPackage.manifest.version 必须为正整数");
  }
  if (!strategyPackage?.manifest?.packageId || typeof strategyPackage.manifest.packageId !== "string") {
    errors.push("strategyPackage.manifest.packageId 缺失");
  }
  if (!strategyPackage?.strategy) {
    errors.push("strategyPackage.strategy 缺失");
  } else {
    errors.push(...validateStrategyConfig(strategyPackage.strategy).errors);
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
  existingAgent?: AgentConfigV2,
): AgentConfigV2 {
  const now = Date.now();
  const id = existingAgent?.id ?? nextId();
  const strategy = request.strategyPackage?.strategy ?? request.config;
  if (!strategy) throw new Error("Strategy config or strategy package is required");
  const incomingPackage = request.strategyPackage;
  const previousVersion = existingAgent?.strategyPackage?.manifest.version;
  const version = previousVersion
    ? previousVersion + 1
    : Math.max(1, incomingPackage?.manifest.version ?? 1);
  const contentHash = hashStrategy(strategy);
  const strategyPackage = incomingPackage
    ? {
        ...incomingPackage,
        manifest: {
          ...incomingPackage.manifest,
          packageId: existingAgent ? `${id}-v${version}` : incomingPackage.manifest.packageId,
          version,
          agentId: id,
          createdAt: now,
          basedOnVersion: previousVersion,
          contentHash,
        },
        strategy,
      }
    : createStrategyPackage(strategy, {
        agentId: id,
        packageId: `${id}-v${version}`,
        version,
        basedOnVersion: previousVersion,
        createdBy: "bootstrap_ai",
        createdAt: now,
      });
  const strategyVersions = [
    ...(existingAgent?.strategyVersions ?? (existingAgent?.strategyPackage
      ? [{
          version: existingAgent.strategyPackage.manifest.version,
          packageId: existingAgent.strategyPackage.manifest.packageId,
          contentHash: existingAgent.strategyPackage.manifest.contentHash,
          basedOnVersion: existingAgent.strategyPackage.manifest.basedOnVersion,
          createdAt: existingAgent.strategyPackage.manifest.createdAt,
        }]
      : [])),
    {
      version: strategyPackage.manifest.version,
      packageId: strategyPackage.manifest.packageId,
      contentHash: strategyPackage.manifest.contentHash,
      basedOnVersion: strategyPackage.manifest.basedOnVersion,
      createdAt: strategyPackage.manifest.createdAt,
    },
  ].filter((entry, index, entries) => entries.findIndex((item) => item.version === entry.version) === index);
  return {
    ...existingAgent,
    id,
    userId,
    name: request.preview.name,
    avatar: request.preview.avatar ?? "🤖",
    description: request.preview.description,
    strategy,
    strategyPackage,
    strategyVersions,
    strategyVersion: strategyPackage.manifest.version,
    executionMode: request.executionMode ?? existingAgent?.executionMode ?? "remote_agent",
    soulKey: soulKey ?? existingAgent?.soulKey,
    skillId: skillId ?? existingAgent?.skillId,
    createdAt: existingAgent?.createdAt ?? now,
    updatedAt: now,
  };
}
