import type {
  PlayerProfile,
  PlayerStats,
  PlayerTendencies,
  HandSnapshot,
  ActionRecord,
} from "@cybercasino/shared";

// ---- Helper: Running Average ----

export function updateRunningAvg(
  current: number,
  newValue: number,
  count: number
): number {
  if (count <= 0) return current;
  return current + (newValue - current) / count;
}

// ---- Helper: Update Tendencies (simplified) ----

export function updateTendencies(
  tendencies: PlayerTendencies,
  history: ActionRecord[],
  n: number
): PlayerTendencies {
  const playersInHand = new Set(history.map((a) => a.playerId));
  // Find the first playerId to use as context (will be overridden per-check)
  const allPhases = new Set(history.map((a) => a.phase));

  const result: PlayerTendencies = {
    foldToThreeBet: tendencies.foldToThreeBet,
    foldToCBet: tendencies.foldToCBet,
    riverBluffFreq: tendencies.riverBluffFreq,
    raiseWithMonster: tendencies.raiseWithMonster,
    positionAware: tendencies.positionAware,
  };

  // --- foldToThreeBet: any preflop fold when facing a 3-bet (2+ raises preflop) ---
  const preflopActions = history.filter((a) => a.phase === "preflop");
  const preflopRaiseCount = preflopActions.filter(
    (a) => a.action.type === "raise"
  ).length;
  if (preflopRaiseCount >= 2) {
    // There was a 3-bet scenario
    const didFold = preflopActions.some((a) => a.action.type === "fold");
    result.foldToThreeBet = updateRunningAvg(
      tendencies.foldToThreeBet,
      didFold ? 1 : 0,
      n
    );
  }

  // --- foldToCBet: folded on flop when facing a bet ---
  const flopActions = history.filter((a) => a.phase === "flop");
  const flopHasBet = flopActions.some(
    (a) => a.action.type === "raise" && a.action.amount != null
  );
  if (flopHasBet) {
    const didFoldFlop = flopActions.some((a) => a.action.type === "fold");
    result.foldToCBet = updateRunningAvg(
      tendencies.foldToCBet,
      didFoldFlop ? 1 : 0,
      n
    );
  }

  // --- riverBluffFreq: simplified — raised on river counts as potential bluff ---
  if (allPhases.has("river")) {
    const riverActions = history.filter((a) => a.phase === "river");
    const raisedRiver = riverActions.some((a) => a.action.type === "raise");
    result.riverBluffFreq = updateRunningAvg(
      tendencies.riverBluffFreq,
      raisedRiver ? 0.5 : 0,
      n
    );
  }

  // --- raiseWithMonster & positionAware: simplified defaults ---
  // Cannot reliably detect without hole card info; keep current values
  result.raiseWithMonster = tendencies.raiseWithMonster;
  result.positionAware = false;

  return result;
}

// ---- Auto-Tag: infer tags from stats and tendencies ----

export function autoTag(profile: PlayerProfile): string[] {
  const { stats, tendencies } = profile;
  const tags: string[] = [];

  if (stats.handsPlayed === 0) return tags;

  // Preflop style
  if (stats.vpip < 0.18) {
    tags.push("tight");
  } else if (stats.vpip > 0.35) {
    tags.push("loose");
  }

  // Aggression ratio
  if (stats.vpip > 0 && stats.pfr / stats.vpip > 0.75) {
    tags.push("aggressive");
  } else if (stats.vpip > 0 && stats.pfr / stats.vpip < 0.4) {
    tags.push("passive");
  }

  // Tendency-based tags
  if (tendencies.foldToThreeBet > 0.7) {
    tags.push("folds-to-3bet");
  }

  if (tendencies.riverBluffFreq > 0.3) {
    tags.push("river-bluffer");
  }

  if (tendencies.raiseWithMonster < 0.3) {
    tags.push("trappy");
  }

  if (stats.showdownRate > 0.4) {
    tags.push("calling-station");
  }

  return tags;
}

// ---- Create Profile ----

export function createProfile(playerId: string): PlayerProfile {
  return {
    playerId,
    stats: {
      handsPlayed: 0,
      vpip: 0,
      pfr: 0,
      showdownRate: 0,
      winRate: 0,
    },
    tendencies: {
      foldToThreeBet: 0,
      foldToCBet: 0,
      riverBluffFreq: 0,
      raiseWithMonster: 0.5,
      positionAware: false,
    },
    tags: [],
    notableHands: [],
  };
}

// ---- Update Profile ----

export interface HandResult {
  handNumber: number;
  holeCards: string[];
  result: "won" | "lost" | "folded";
  profit: number;
}

export function updateProfile(
  profile: PlayerProfile,
  handHistory: ActionRecord[],
  result: HandResult
): PlayerProfile {
  const myActions = handHistory.filter(
    (a) => a.playerId === profile.playerId
  );
  const n = profile.stats.handsPlayed + 1;

  // --- Per-hand stat indicators ---

  // VPIP: voluntarily put money in preflop (raise or call, excluding pure blinds)
  const vpipThisHand = myActions.some(
    (a) =>
      a.phase === "preflop" &&
      (a.action.type === "raise" || a.action.type === "call")
  )
    ? 1
    : 0;

  // PFR: preflop raise
  const pfrThisHand = myActions.some(
    (a) => a.phase === "preflop" && a.action.type === "raise"
  )
    ? 1
    : 0;

  // Showdown rate: had river-phase action (saw the river)
  const showdownThisHand = myActions.some((a) => a.phase === "river")
    ? 1
    : 0;

  // Win rate
  const winThisHand = result.result === "won" ? 1 : 0;

  // --- Update stats via running average ---
  const newStats: PlayerStats = {
    handsPlayed: n,
    vpip: updateRunningAvg(profile.stats.vpip, vpipThisHand, n),
    pfr: updateRunningAvg(profile.stats.pfr, pfrThisHand, n),
    showdownRate: updateRunningAvg(
      profile.stats.showdownRate,
      showdownThisHand,
      n
    ),
    winRate: updateRunningAvg(profile.stats.winRate, winThisHand, n),
  };

  // --- Update tendencies ---
  const newTendencies = updateTendencies(profile.tendencies, handHistory, n);

  // --- Record notable hand (keep last 10) ---
  const snapshot: HandSnapshot = {
    handNumber: result.handNumber,
    holeCards: result.holeCards,
    actions: myActions.map((a) => a.action.type),
    result: result.result,
    profit: result.profit,
  };

  const notableHands = [snapshot, ...profile.notableHands].slice(0, 10);

  // --- Assemble and tag ---
  const updatedProfile: PlayerProfile = {
    ...profile,
    stats: newStats,
    tendencies: newTendencies,
    notableHands,
  };

  updatedProfile.tags = autoTag(updatedProfile);

  return updatedProfile;
}