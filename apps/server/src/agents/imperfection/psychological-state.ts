import type { TiltConfig } from "@cybercasino/shared";

export interface PsychologicalState {
  tilt: number;
  confidence: number;
  boredom: number;
  fear: number;
  euphoria: number;
}

export function createInitialState(): PsychologicalState {
  return { tilt: 0, confidence: 0.5, boredom: 0, fear: 0, euphoria: 0 };
}

export function updateAfterHand(
  state: PsychologicalState,
  result: {
    wasBadBeat: boolean;
    wasBluffCaught: boolean;
    bigLoss: boolean;
    bigWin: boolean;
    handsSinceAction: number;
  },
  config: TiltConfig,
): PsychologicalState {
  const next = { ...state };

  if (result.wasBadBeat) {
    next.tilt = Math.min(next.tilt + 0.3, config.maxLevel);
  }
  if (result.wasBluffCaught) {
    next.tilt = Math.min(next.tilt + 0.2, config.maxLevel);
  }
  if (result.bigLoss) {
    next.fear = Math.min(next.fear + 0.3, 1);
    next.tilt = Math.min(next.tilt + 0.15, config.maxLevel);
  }

  if (result.bigWin) {
    next.euphoria = Math.min(next.euphoria + 0.3, 1);
    next.confidence = Math.min(next.confidence + 0.2, 1);
    next.fear = Math.max(next.fear - 0.2, 0);
  }

  next.tilt = Math.max(next.tilt - config.decayRate, 0);
  next.fear = Math.max(next.fear - 0.05, 0);
  next.euphoria = Math.max(next.euphoria - 0.08, 0);
  next.boredom = Math.min(next.boredom + 0.02, 1);

  if (result.wasBadBeat || result.bigWin || result.bigLoss) {
    next.boredom = 0;
  }

  return next;
}

export function describeState(state: PsychologicalState): string {
  if (state.tilt > 0.6) return "tilting";
  if (state.fear > 0.6) return "fearful";
  if (state.euphoria > 0.6) return "euphoric";
  if (state.confidence > 0.7) return "confident";
  if (state.boredom > 0.7) return "bored";
  return "normal";
}

export function getTimingMultiplier(state: PsychologicalState): number {
  let multiplier = 1;
  if (state.tilt > 0.5) multiplier *= 0.6;
  if (state.fear > 0.5) multiplier *= 1.5;
  if (state.boredom > 0.7) multiplier *= 0.8;
  return multiplier;
}
