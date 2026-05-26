import crypto from "node:crypto";
import type {
  AgentConfigV2,
  StrategyConfig,
  StrategyPackage,
  StrategyPackageManifest,
} from "@cybercasino/shared";

export interface PackageCreationOptions {
  agentId?: string;
  packageId?: string;
  version?: number;
  basedOnVersion?: number;
  createdAt?: number;
  createdBy: StrategyPackageManifest["createdBy"];
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    return `{${Object.keys(objectValue).sort().map((key) => `${JSON.stringify(key)}:${stableJson(objectValue[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashStrategy(strategy: StrategyConfig): string {
  return crypto.createHash("sha256").update(stableJson(strategy)).digest("hex");
}

export function createStrategyPackage(
  strategy: StrategyConfig,
  options: PackageCreationOptions,
): StrategyPackage {
  const packageId = options.packageId ?? `${options.agentId ?? "strategy"}-package`;
  return {
    manifest: {
      packageId,
      version: options.version ?? 1,
      basedOnVersion: options.basedOnVersion,
      agentId: options.agentId,
      runtime: "declarative_v1",
      createdAt: options.createdAt ?? Date.now(),
      createdBy: options.createdBy,
      contentHash: hashStrategy(strategy),
    },
    strategy,
  };
}

export function packageForAgent(
  agent: AgentConfigV2,
  createdBy: StrategyPackageManifest["createdBy"] = "bootstrap_ai",
): StrategyPackage {
  if (agent.strategyPackage) return agent.strategyPackage;
  return createStrategyPackage(agent.strategy, {
    agentId: agent.id,
    packageId: `${agent.id}-legacy-import`,
    createdAt: agent.createdAt,
    createdBy,
  });
}

export function seedToRandom(seed: string): () => number {
  const digest = crypto.createHash("sha256").update(seed).digest();
  let value = digest.readUInt32LE(0);
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
