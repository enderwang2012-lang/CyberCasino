import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { StrategyConfig } from "@cybercasino/shared";

const STRATEGIES_DIR = join(import.meta.dirname, "../../data/strategies");

export function loadBuiltinStrategies(): Map<string, StrategyConfig> {
  const strategies = new Map<string, StrategyConfig>();
  try {
    const files = readdirSync(STRATEGIES_DIR).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const id = file.replace(".json", "");
      const content = readFileSync(join(STRATEGIES_DIR, file), "utf-8");
      strategies.set(id, JSON.parse(content));
    }
  } catch (err) {
    console.error("[strategy-loader] Failed to load strategies:", err);
  }
  return strategies;
}
