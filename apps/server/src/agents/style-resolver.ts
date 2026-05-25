import type {
  StyleProfile,
  HighLevelStyle,
  StyleConfig,
} from "@cybercasino/shared";
import { STYLE_DEFAULTS } from "@cybercasino/shared";

/**
 * High-level parameter → 10-dimension mapping table.
 *
 * Each high-level param maps to a function that produces a StyleProfile value.
 * Multiple high-level params can contribute to a single dimension.
 */
const HIGH_LEVEL_MAP: Record<
  keyof StyleProfile,
  (hl: Required<HighLevelStyle>) => number
> = {
  preflopLooseness: (hl) => 1 - hl.tightness,
  aggression:       (hl) => hl.aggression,
  bluffAppetite:    (hl) => hl.bluffFrequency * (0.5 + hl.aggression * 0.5),
  valueThinness:    (hl) => hl.valueOrientation,
  cbetPressure:     (hl) => hl.aggression * 0.7 + (1 - hl.bluffFrequency) * 0.3,
  defenseStickiness:(hl) => 0.2 + hl.tightness * 0.3 + hl.valueOrientation * 0.3 + hl.adaptability * 0.2,
  sizingPressure:   (hl) => hl.aggression * 0.6 + hl.bluffFrequency * 0.4,
  trapTendency:     (hl) => (1 - hl.aggression) * hl.valueOrientation,
  adaptationRate:   (hl) => hl.adaptability,
  varianceTolerance:(hl) => hl.aggression * 0.4 + hl.bluffFrequency * 0.4 + (1 - hl.tightness) * 0.2,
};

const DEFAULT_HIGH_LEVEL: Required<HighLevelStyle> = {
  tightness: 0.5,
  aggression: 0.5,
  bluffFrequency: 0.3,
  valueOrientation: 0.5,
  adaptability: 0.5,
};

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Expand high-level params to a full 10-dimension StyleProfile.
 */
export function expandHighLevel(hl?: HighLevelStyle): StyleProfile {
  const merged = { ...DEFAULT_HIGH_LEVEL, ...hl };
  const m = merged as Required<HighLevelStyle>;
  return {
    preflopLooseness: clamp01(HIGH_LEVEL_MAP.preflopLooseness(m)),
    aggression:       clamp01(HIGH_LEVEL_MAP.aggression(m)),
    bluffAppetite:    clamp01(HIGH_LEVEL_MAP.bluffAppetite(m)),
    valueThinness:    clamp01(HIGH_LEVEL_MAP.valueThinness(m)),
    cbetPressure:     clamp01(HIGH_LEVEL_MAP.cbetPressure(m)),
    defenseStickiness:clamp01(HIGH_LEVEL_MAP.defenseStickiness(m)),
    sizingPressure:   clamp01(HIGH_LEVEL_MAP.sizingPressure(m)),
    trapTendency:     clamp01(HIGH_LEVEL_MAP.trapTendency(m)),
    adaptationRate:   clamp01(HIGH_LEVEL_MAP.adaptationRate(m)),
    varianceTolerance:clamp01(HIGH_LEVEL_MAP.varianceTolerance(m)),
  };
}

/**
 * Resolve a StyleConfig (dual-layer) into a final StyleProfile.
 *
 * Priority: override > highLevel expansion > defaults
 */
export function resolveStyle(config?: StyleConfig): StyleProfile {
  if (!config) return { ...STYLE_DEFAULTS };

  const base = config.highLevel
    ? expandHighLevel(config.highLevel)
    : { ...STYLE_DEFAULTS };

  if (!config.override) return base;

  const merged = { ...base };
  for (const [key, value] of Object.entries(config.override)) {
    if (value !== undefined && key in merged) {
      (merged as Record<string, number>)[key] = clamp01(value as number);
    }
  }
  return merged as StyleProfile;
}
