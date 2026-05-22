// Phase 4 stub: psychological state model for agent imperfection simulation.
// Full implementation will be completed in Phase 4.

export interface PsychologicalState {
  tilt: number;
  confidence: number;
  boredom: number;
  fear: number;
  euphoria: number;
}

export function describeState(state: PsychologicalState): string {
  if (state.tilt > 0.6) return "tilting";
  if (state.fear > 0.6) return "fearful";
  if (state.euphoria > 0.6) return "euphoric";
  if (state.confidence > 0.7) return "confident";
  if (state.boredom > 0.7) return "bored";
  return "normal";
}