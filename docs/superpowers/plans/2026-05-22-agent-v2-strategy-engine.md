# Agent V2: Strategy Engine + AI-Driven Creation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat rule engine + hardcoded personalities with a rich StrategyConfig system that supports complex strategies, player profiling, human imperfection, multi-language expression, and AI-driven agent creation.

**Architecture:** Three-layer decision system (Strategy Interpreter → Opponent Adaptation → Human Imperfection) replacing the current two-tier (Rule Engine → LLM). Agent creation moves from a frontend wizard to an LLM-driven conversation that submits via API. Built-in agents migrate from hardcoded `AgentPersonality` objects to full `StrategyConfig` JSON files.

**Tech Stack:** TypeScript, Socket.IO, OpenAI-compatible API (Deepseek), file-based JSON storage

---

## Phase Overview

| Phase | Focus | Depends On |
|-------|-------|------------|
| 1 | Shared types: StrategyConfig schema | — |
| 2 | Strategy interpreter (replaces rule-engine.ts) | Phase 1 |
| 3 | Player profiling system | Phase 1 |
| 4 | Human imperfection + tilt | Phase 2 |
| 5 | Thought generator (expression system) | Phase 1 |
| 6 | Agent runtime integration | Phases 2-5 |
| 7 | AI creation API + prompt | Phase 1 |
| 8 | Frontend: AI creation UI | Phase 7 |
| 9 | Built-in agent migration | Phases 1-6 |
| 10 | Table-instance integration | Phases 6, 9 |

---

## Phase 1: Shared Types — StrategyConfig Schema

### Task 1.1: Add StrategyConfig types to shared package

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Add Position type**

```typescript
// Add after HandRank type (line ~114)
export type Position = "UTG" | "MP" | "CO" | "BTN" | "SB" | "BB";
```

- [ ] **Step 2: Add PreflopRanges type**

```typescript
export interface PositionRange {
  raise: string[];   // Standard hand notation: "AA", "AKs", "T9o"
  call: string[];
  fold: string[];    // Explicit fold list (optional, everything not in raise/call is fold)
}

export interface PreflopConfig {
  ranges: Record<Position, PositionRange>;
  sizing: {
    openRaise: string;      // e.g. "2.5bb"
    threeBet: string;       // e.g. "3x"
    fourBet: string;        // e.g. "2.5x"
  };
}
```

- [ ] **Step 3: Add PostflopRule type**

```typescript
export type PostflopCondition =
  | "top-pair-top-kicker"
  | "top-pair-good-kicker"
  | "top-pair-weak-kicker"
  | "second-pair"
  | "middle-pair"
  | "bottom-pair"
  | "overpair"
  | "top-two-pair"
  | "two-pair"
  | "three-of-a-kind"
  | "straight"
  | "flush"
  | "full-house"
  | "four-of-a-kind"
  | "straight-flush"
  | "royal-flush"
  | "flush-draw"
  | "straight-draw"
  | "gutshot"
  | "overcards"
  | "nothing"
  | "monster";

export type PostflopAction =
  | "value-bet-small"       // 1/3 pot
  | "value-bet-medium"      // 2/3 pot
  | "value-bet-large"       // 3/4 pot
  | "value-bet-pot"         // pot
  | "overbet"               // 1.5x pot
  | "check-call"
  | "check-raise"
  | "check-fold"
  | "check-call-flop-evaluate-turn"
  | "semi-bluff-small"
  | "semi-bluff-medium"
  | "semi-bluff-large"
  | "bluff-small"
  | "bluff-medium"
  | "bluff-large"
  | "slowplay"
  | "trap"
  | "donk-bet";

export type Street = "flop" | "turn" | "river";

export interface PostflopRule {
  when: PostflopCondition;
  action: PostflopAction;
  position?: "IP" | "OOP" | "any";  // default "any"
  streets?: Street[];                 // default all streets
  frequency?: number;                 // 0-1, default 1.0 (always)
  vsBetSize?: "small" | "medium" | "large" | "any";  // when responding to bets
  priority?: number;                  // higher = checked first, default 0
  notes?: string;                     // human-readable explanation
}
```

- [ ] **Step 4: Add OpponentRule and TargetedAction types**

```typescript
export interface OpponentMatch {
  tags?: string[];
  vpipRange?: [number, number];
  pfrRange?: [number, number];
  specificPlayer?: string;
}

export interface OpponentAdjustments {
  widenRange?: boolean;
  tightenRange?: boolean;
  threeBetMore?: boolean;
  threeBetLess?: boolean;
  bluffMore?: boolean;
  bluffLess?: boolean;
  valueBetThinner?: boolean;
  valueBetWider?: boolean;
  trapMore?: boolean;
  foldToAggression?: boolean;
  limpMore?: boolean;
}

export interface OpponentRule {
  match: OpponentMatch;
  adjustments: OpponentAdjustments;
  sizingOverride?: {
    raiseSizing?: "small" | "medium" | "large" | "overbet";
    bluffSizing?: "small" | "medium" | "large";
  };
  notes?: string;
}

export type TargetedIntent =
  | "intimidate"
  | "bait"
  | "exploit"
  | "table-image"
  | "revenge"
  | "information";

export interface TargetedAction {
  target: OpponentMatch;
  intent: TargetedIntent;
  execution: {
    action: ActionType;
    sizing?: string;
    thoughtHint?: string;
  };
  conditions?: {
    minHands?: number;
    onlyWhenInHand?: boolean;
    maxFrequency?: number;
  };
}
```

- [ ] **Step 5: Add ExpressionConfig type**

```typescript
export type ThoughtLanguage = "zh" | "en" | "ja" | "ko" | "mixed";

export interface ToneSpectrum {
  warmth: number;      // 0=cold 1=warm
  sass: number;        // 0=serious 1=sarcastic
  intensity: number;   // 0=calm 1=dramatic
  humor: number;       // 0=serious 1=playful
}

export interface ThoughtTemplates {
  confident: string;    // e.g. "{handDesc}。十分な強さ。{actionDesc}。"
  worried: string;      // e.g. "少し気になる...{concern}。"
  bluffing: string;     // e.g. "演技の時間。{actionDesc}。"
  frustrated: string;   // e.g. "...くっ。仕方ない。"
}

export interface ExpressionConfig {
  thoughtLanguage: ThoughtLanguage;
  tone: ToneSpectrum;
  catchphrases: string[];
  verbalTics: string[];
  thoughtTemplates: ThoughtTemplates;
}
```

- [ ] **Step 6: Add ImperfectionConfig and TiltConfig types**

```typescript
export interface MistakeTendencies {
  scaredFold: number;       // 0-1: folding strong hands under pressure
  stickyCall: number;       // 0-1: calling with weak hands after investing
  slowplayBias: number;     // 0-1: slowplaying strong hands
  tiltAggression: number;   // 0-1: over-aggression when tilted
}

export interface TiltConfig {
  triggerThreshold: number;   // 0-1: how much bad luck before tilt starts
  decayRate: number;          // per hand: how fast tilt fades
  maxLevel: number;           // 0-1: maximum tilt intensity
}

export interface ImperfectionConfig {
  baseMistakeRate: number;    // 0-15: base probability of suboptimal play
  tendencies: MistakeTendencies;
  tilt: TiltConfig;
  confidenceNoise: number;    // 0-1: how much confidence fluctuates
}
```

- [ ] **Step 7: Add PlayerProfile type**

```typescript
export interface PlayerStats {
  handsPlayed: number;
  vpip: number;               // voluntary put in pot rate
  pfr: number;                // preflop raise rate
  showdownRate: number;
  winRate: number;            // showdown win rate
}

export interface PlayerTendencies {
  foldToThreeBet: number;
  foldToCBet: number;
  riverBluffFreq: number;
  raiseWithMonster: number;
  positionAware: boolean;
}

export interface HandSnapshot {
  handNumber: number;
  holeCards: string[];        // e.g. ["As", "Kh"]
  actions: string[];          // e.g. ["raise-pre", "bet-flop", "fold-river"]
  result: "won" | "lost" | "folded";
  profit: number;
}

export interface PlayerProfile {
  playerId: string;
  stats: PlayerStats;
  tendencies: PlayerTendencies;
  tags: string[];
  narrative?: string;
  notableHands: HandSnapshot[];
}
```

- [ ] **Step 8: Add StrategyConfig and DecisionDistribution types**

```typescript
export interface StrategyConfig {
  preflop: PreflopConfig;
  postflop: PostflopRule[];
  opponentRules?: OpponentRule[];
  targetedActions?: TargetedAction[];
  expression?: ExpressionConfig;
  imperfection?: ImperfectionConfig;
  [key: string]: unknown;     // open-ended for future extensions
}

export interface DecisionDistribution {
  weights: Map<ActionType, number>;  // probability weights per action
  difficulty: number;                 // 0-1
  isMistake: boolean;                 // did the agent make a suboptimal choice
}
```

- [ ] **Step 9: Add AgentConfigV2 type**

```typescript
export interface AgentConfigV2 {
  id: string;
  userId: string;
  name: string;
  avatar: string;
  description?: string;
  strategy: StrategyConfig;
  webhookUrl?: string;
  webhookVerified?: boolean;
  createdAt: number;
  updatedAt: number;
}
```

- [ ] **Step 10: Update AgentThought type**

```typescript
// Replace existing AgentThought (line ~49)
export interface AgentThought {
  message: string;
  confidence: number;
  isBluffing: boolean;
  isMistake?: boolean;        // NEW: was this a human-like mistake
  difficulty?: number;        // NEW: how hard was this decision
  psychologicalState?: string; // NEW: e.g. "tilting", "confident", "fearful"
}
```

- [ ] **Step 11: Add AI creation event types to Socket.IO**

```typescript
// Add to ClientToServerEvents
"agent:create-by-ai": (data: { config: StrategyConfig; preview: AgentPreview }) => void;

// Add to ServerToClientEvents
"agent:created": (data: { agentId: string; status: string; previewUrl?: string }) => void;
"agent:create-error": (data: { error: string; details?: string }) => void;

// New types
export interface AgentPreview {
  name: string;
  description: string;
  avatar?: string;
  sampleThoughts: string[];
  playStyle: string;
}
```

- [ ] **Step 12: Export all new types from index.ts**

Add exports for all new types to `packages/shared/src/index.ts`.

- [ ] **Step 13: Build shared package to verify types compile**

Run: `cd "/Users/mi/Claude Code/CyberCasino" && npx turbo build --filter=@cybercasino/shared`
Expected: Build succeeds with no type errors.

- [ ] **Step 14: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/index.ts
git commit -m "feat: add StrategyConfig schema and agent v2 types"
```

---

## Phase 2: Strategy Interpreter

### Task 2.1: Create preflop strategy interpreter

**Files:**
- Create: `apps/server/src/agents/strategy/preflop.ts`

- [ ] **Step 1: Create hand notation parser**

```typescript
// apps/server/src/agents/strategy/preflop.ts
import type { Card, Position, PositionRange, PreflopConfig } from "@cybercasino/shared";

// Parse hand notation like "AA", "AKs", "T9o" to a comparable key
function handToKey(cards: Card[]): string {
  const ranks = cards.map(c => c.rank).sort((a, b) => b - a);
  const rankChars = ranks.map(r => {
    if (r === 14) return "A";
    if (r === 13) return "K";
    if (r === 12) return "Q";
    if (r === 11) return "J";
    if (r === 10) return "T";
    return String(r);
  });
  const suited = cards[0].suit === cards[1].suit ? "s" : "o";
  if (rankChars[0] === rankChars[1]) return rankChars[0] + rankChars[1];
  return rankChars[0] + rankChars[1] + suited;
}

export function matchesRange(hand: Card[], range: string[]): boolean {
  const key = handToKey(hand);
  return range.some(pattern => {
    // Exact match
    if (pattern === key) return true;
    // Pair shorthand: "99+" means 99, TT, JJ, QQ, KK, AA
    if (pattern.endsWith("+") && pattern.length === 3) {
      const baseRank = charToRank(pattern[0]);
      const handRank = Math.max(hand[0].rank, hand[1].rank);
      const isPair = hand[0].rank === hand[1].rank;
      return isPair && handRank >= baseRank;
    }
    // Suited connector shorthand: "T9s+" means T9s, JTs, QJs, KQs
    // TODO: implement if needed
    return false;
  });
}

function charToRank(c: string): number {
  const map: Record<string, number> = { A: 14, K: 13, Q: 12, J: 11, T: 10 };
  return map[c] ?? parseInt(c, 10);
}
```

- [ ] **Step 2: Create preflop decision function**

```typescript
// Add to apps/server/src/agents/strategy/preflop.ts

export interface PreflopDecision {
  action: "raise" | "call" | "fold";
  amount?: number;
  confidence: number;
}

export function decidePreflop(
  hand: Card[],
  position: Position,
  config: PreflopConfig,
  callAmount: number,
  minRaise: number,
  bigBlind: number,
  currentBet: number,
): PreflopDecision | null {
  const range = config.ranges[position];
  if (!range) return null;

  if (matchesRange(hand, range.raise)) {
    const amount = currentBet + minRaise;
    return { action: "raise", amount, confidence: 0.9 };
  }

  if (matchesRange(hand, range.call)) {
    if (callAmount <= bigBlind * 3) {
      return { action: "call", confidence: 0.7 };
    }
    return { action: "fold", confidence: 0.6 };
  }

  // Not in any range → fold
  return { action: "fold", confidence: 0.8 };
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/agents/strategy/preflop.ts
git commit -m "feat: add preflop strategy interpreter with hand notation parser"
```

### Task 2.2: Create postflop strategy interpreter

**Files:**
- Create: `apps/server/src/agents/strategy/postflop.ts`

- [ ] **Step 1: Create hand condition classifier**

```typescript
// apps/server/src/agents/strategy/postflop.ts
import type { Card, PostflopCondition, PostflopRule, PostflopAction, Street, ActionType } from "@cybercasino/shared";
import { evaluateHand } from "@cybercasino/engine";

export interface PostflopContext {
  myCards: Card[];
  communityCards: Card[];
  street: Street;
  isIP: boolean;
  potSize: number;
  callAmount: number;
}

export interface PostflopDecision {
  action: ActionType;
  amount?: number;
  confidence: number;
  matchedRule?: PostflopRule;
}

// Classify current hand into a PostflopCondition
export function classifyHand(ctx: PostflopContext): PostflopCondition[] {
  const allCards = [...ctx.myCards, ...ctx.communityCards];
  const evaluated = evaluateHand(allCards);
  const conditions: PostflopCondition[] = [];

  // Check for draws first
  // (simplified - full draw detection would be more complex)
  const suits = allCards.map(c => c.suit);
  const suitCounts = suits.reduce((acc, s) => { acc[s] = (acc[s] || 0) + 1; return acc; }, {} as Record<string, number>);
  const hasFlushDraw = Object.values(suitCounts).some(count => count === 4);
  if (hasFlushDraw) conditions.push("flush-draw");

  // Map hand rank to condition
  const rankConditions: Record<string, PostflopCondition> = {
    "royal-flush": "royal-flush",
    "straight-flush": "straight-flush",
    "four-of-a-kind": "four-of-a-kind",
    "full-house": "full-house",
    "flush": "flush",
    "straight": "straight",
    "three-of-a-kind": "three-of-a-kind",
    "two-pair": "two-pair",
    "pair": "pair",  // will be refined below
    "high-card": "nothing",
  };

  const baseCondition = rankConditions[evaluated.rank] ?? "nothing";

  // Refine pair conditions
  if (evaluated.rank === "pair") {
    const myRanks = ctx.myCards.map(c => c.rank);
    const boardRanks = ctx.communityCards.map(c => c.rank);
    const pairRank = myRanks.find(r => boardRanks.includes(r));

    if (pairRank) {
      if (pairRank === Math.max(...myRanks)) {
        // Check if kicker is good
        const kicker = myRanks.find(r => r !== pairRank) ?? 0;
        if (kicker >= 12) conditions.push("top-pair-top-kicker");
        else if (kicker >= 10) conditions.push("top-pair-good-kicker");
        else conditions.push("top-pair-weak-kicker");
      } else {
        conditions.push("second-pair");
      }
    }

    // Pocket pair (overpair)
    if (myRanks[0] === myRanks[1] && myRanks[0] > Math.max(...boardRanks)) {
      conditions.push("overpair");
    }
  }

  // Three of a kind refinement
  if (evaluated.rank === "three-of-a-kind") {
    conditions.push("three-of-a-kind");
  }

  // Monster hands
  if (["full-house", "four-of-a-kind", "straight-flush", "royal-flush"].includes(evaluated.rank)) {
    conditions.push("monster");
  }

  if (!conditions.includes(baseCondition)) {
    conditions.push(baseCondition);
  }

  return conditions;
}
```

- [ ] **Step 2: Create rule matcher and action resolver**

```typescript
// Add to apps/server/src/agents/strategy/postflop.ts

export function matchRules(
  conditions: PostflopCondition[],
  rules: PostflopRule[],
  ctx: PostflopContext,
): PostflopRule | null {
  const positionTag = ctx.isIP ? "IP" : "OOP";

  // Sort by priority descending
  const sorted = [...rules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  for (const rule of sorted) {
    // Check condition match
    if (!conditions.includes(rule.when)) continue;

    // Check position
    if (rule.position && rule.position !== "any" && rule.position !== positionTag) continue;

    // Check street
    if (rule.streets && !rule.streets.includes(ctx.street)) continue;

    // Check frequency (probabilistic matching)
    if (rule.frequency !== undefined && rule.frequency < 1) {
      if (Math.random() > rule.frequency) continue;
    }

    return rule;
  }

  return null;
}

export function resolveAction(
  action: PostflopAction,
  potSize: number,
  currentBet: number,
  minRaise: number,
): { type: ActionType; amount?: number } {
  const sizingMap: Record<string, number> = {
    "value-bet-small": 0.33,
    "value-bet-medium": 0.67,
    "value-bet-large": 0.75,
    "value-bet-pot": 1.0,
    "overbet": 1.5,
    "semi-bluff-small": 0.33,
    "semi-bluff-medium": 0.67,
    "semi-bluff-large": 0.75,
    "bluff-small": 0.33,
    "bluff-medium": 0.5,
    "bluff-large": 0.75,
  };

  if (action === "check-call" || action === "slowplay" || action === "trap") {
    if (currentBet > 0) return { type: "call" };
    return { type: "check" };
  }

  if (action === "check-raise") {
    if (currentBet > 0) return { type: "raise", amount: currentBet + minRaise };
    return { type: "check" };
  }

  if (action === "check-fold") {
    if (currentBet > 0) return { type: "fold" };
    return { type: "check" };
  }

  if (action === "check-call-flop-evaluate-turn") {
    if (currentBet > 0) return { type: "call" };
    return { type: "check" };
  }

  if (action === "donk-bet") {
    return { type: "raise", amount: Math.floor(potSize * 0.5) };
  }

  // Sizing-based actions
  const ratio = sizingMap[action] ?? 0.67;
  const betAmount = Math.max(Math.floor(potSize * ratio), minRaise);
  return { type: "raise", amount: currentBet + betAmount };
}

export function decidePostflop(
  ctx: PostflopContext,
  rules: PostflopRule[],
  currentBet: number,
  minRaise: number,
  validActions: ActionType[],
): PostflopDecision {
  const conditions = classifyHand(ctx);
  const matched = matchRules(conditions, rules, ctx);

  if (!matched) {
    // No rule matched → default to check/fold
    if (currentBet === 0 && validActions.includes("check")) {
      return { action: "check", confidence: 0.3 };
    }
    return { action: "fold", confidence: 0.3 };
  }

  const resolved = resolveAction(matched.action, ctx.potSize, currentBet, minRaise);

  // Validate action
  if (!validActions.includes(resolved.type)) {
    // Fallback: if the resolved action isn't valid, adjust
    if (resolved.type === "raise" && !validActions.includes("raise")) {
      return { action: "call", confidence: 0.5, matchedRule: matched };
    }
    if (resolved.type === "check" && !validActions.includes("check")) {
      return { action: "fold", confidence: 0.4, matchedRule: matched };
    }
  }

  return {
    action: resolved.type,
    amount: resolved.amount,
    confidence: 0.85,
    matchedRule: matched,
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/agents/strategy/postflop.ts
git commit -m "feat: add postflop strategy interpreter with condition classifier"
```

### Task 2.3: Create strategy index

**Files:**
- Create: `apps/server/src/agents/strategy/index.ts`

- [ ] **Step 1: Create strategy barrel export**

```typescript
// apps/server/src/agents/strategy/index.ts
export { decidePreflop, matchesRange } from "./preflop";
export { decidePostflop, classifyHand, matchRules, resolveAction } from "./postflop";
```

- [ ] **Step 2: Commit**

```bash
git add apps/server/src/agents/strategy/index.ts
git commit -m "feat: add strategy module barrel export"
```

---

## Phase 3: Player Profiling System

### Task 3.1: Create player profile engine

**Files:**
- Create: `apps/server/src/agents/profile/player-profile.ts`

- [ ] **Step 1: Create profile initialization**

```typescript
// apps/server/src/agents/profile/player-profile.ts
import type { PlayerProfile, PlayerStats, PlayerTendencies, HandSnapshot, ActionRecord } from "@cybercasino/shared";

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
      raiseWithMonster: 0,
      positionAware: false,
    },
    tags: [],
    notableHands: [],
  };
}
```

- [ ] **Step 2: Create profile update logic**

```typescript
// Add to apps/server/src/agents/profile/player-profile.ts

const MAX_NOTABLE_HANDS = 10;

export function updateProfile(
  profile: PlayerProfile,
  handHistory: ActionRecord[],
  result: { won: boolean; profit: number; holeCards?: string[] },
): PlayerProfile {
  const updated = { ...profile, stats: { ...profile.stats } };
  updated.stats.handsPlayed++;

  // Track VPIP: did the player voluntarily put money in (not just blinds)?
  const voluntaryActions = handHistory.filter(
    a => a.action.type === "raise" || (a.action.type === "call" && a.phase === "preflop")
  );
  if (voluntaryActions.length > 0) {
    updated.stats.vpip = updateRunningAvg(updated.stats.vpip, 1, updated.stats.handsPlayed);
  } else {
    updated.stats.vpip = updateRunningAvg(updated.stats.vpip, 0, updated.stats.handsPlayed);
  }

  // Track PFR: did the player raise preflop?
  const preflopRaise = handHistory.some(
    a => a.phase === "preflop" && a.action.type === "raise"
  );
  updated.stats.pfr = updateRunningAvg(updated.stats.pfr, preflopRaise ? 1 : 0, updated.stats.handsPlayed);

  // Track showdown rate
  const reachedShowdown = handHistory.some(a => a.phase === "river");
  updated.stats.showdownRate = updateRunningAvg(
    updated.stats.showdownRate, reachedShowdown ? 1 : 0, updated.stats.handsPlayed
  );

  // Track win rate
  updated.stats.winRate = updateRunningAvg(
    updated.stats.winRate, result.won ? 1 : 0, updated.stats.handsPlayed
  );

  // Update tendencies
  updated.tendencies = updateTendencies(updated.tendencies, handHistory);

  // Add notable hand
  if (result.holeCards) {
    const snapshot: HandSnapshot = {
      handNumber: profile.stats.handsPlayed,
      holeCards: result.holeCards,
      actions: handHistory.map(a => `${a.action.type}-${a.phase}`),
      result: result.won ? "won" : "folded",
      profit: result.profit,
    };
    updated.notableHands = [snapshot, ...updated.notableHands].slice(0, MAX_NOTABLE_HANDS);
  }

  // Auto-tag
  updated.tags = autoTag(updated);

  return updated;
}

function updateRunningAvg(current: number, newValue: number, count: number): number {
  return (current * (count - 1) + newValue) / count;
}

function updateTendencies(tendencies: PlayerTendencies, history: ActionRecord[]): PlayerTendencies {
  // Simplified tendency tracking
  const updated = { ...tendencies };

  // Check for river bluffs (bet/raise on river with weak hand at showdown)
  const riverActions = history.filter(a => a.phase === "river");
  if (riverActions.length > 0) {
    const wasBluff = riverActions.some(a => a.action.type === "raise");
    // This is a simplification - real bluff detection needs showdown data
    updated.riverBluffFreq = updateRunningAvg(updated.riverBluffFreq, wasBluff ? 1 : 0, 10);
  }

  return updated;
}

export function autoTag(profile: PlayerProfile): string[] {
  const tags: string[] = [];
  const { vpip, pfr, showdownRate } = profile.stats;
  const { foldToThreeBet, riverBluffFreq, raiseWithMonster } = profile.tendencies;

  if (vpip < 0.18) tags.push("tight");
  if (vpip > 0.35) tags.push("loose");
  if (pfr / Math.max(vpip, 0.01) > 0.75) tags.push("aggressive");
  if (pfr / Math.max(vpip, 0.01) < 0.4) tags.push("passive");
  if (foldToThreeBet > 0.7) tags.push("folds-to-3bet");
  if (riverBluffFreq > 0.3) tags.push("river-bluffer");
  if (raiseWithMonster < 0.3) tags.push("trappy");
  if (showdownRate > 0.4) tags.push("calling-station");

  return tags;
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/agents/profile/player-profile.ts
git commit -m "feat: add player profile engine with auto-tagging"
```

---

## Phase 4: Human Imperfection System

### Task 4.1: Create difficulty calculator and decision distribution

**Files:**
- Create: `apps/server/src/agents/imperfection/decision-difficulty.ts`

- [ ] **Step 1: Create difficulty calculator**

```typescript
// apps/server/src/agents/imperfection/decision-difficulty.ts
import type { AgentGameView, ImperfectionConfig, ActionType } from "@cybercasino/shared";
import { evaluateHand } from "@cybercasino/engine";

export interface DifficultyContext {
  handStrength: number;       // 0-1
  potPressure: number;        // pot / stack ratio
  opponentUncertainty: number; // 0-1, how well we know the opponent
  viableOptions: number;      // number of valid actions
  isAllIn: boolean;
  callAmount: number;
  stackSize: number;
}

export function calculateDifficulty(ctx: DifficultyContext): number {
  let difficulty = 0;

  // Edge factor: hand strength near decision boundaries
  // Strong hands facing big raises are "hard" because of risk
  const edgeFactor = 1 - Math.abs(ctx.handStrength - 0.5) * 2;
  difficulty += edgeFactor * 0.2;

  // High pressure: pot is large relative to stack
  difficulty += Math.min(ctx.potPressure, 1) * 0.25;

  // Opponent uncertainty
  difficulty += ctx.opponentUncertainty * 0.15;

  // More options = harder
  difficulty += Math.max(0, (ctx.viableOptions - 1) / 4) * 0.15;

  // All-in situations are always high difficulty
  if (ctx.isAllIn) difficulty += 0.2;

  // Large call amount relative to stack
  if (ctx.stackSize > 0) {
    difficulty += Math.min(ctx.callAmount / ctx.stackSize, 1) * 0.15;
  }

  return Math.min(Math.max(difficulty, 0), 1);
}

export function estimateHandStrength(view: AgentGameView): number {
  if (view.communityCards.length === 0) return 0.5;
  const allCards = [...view.myCards, ...view.communityCards];
  const evaluated = evaluateHand(allCards);
  const rankScores: Record<string, number> = {
    "high-card": 0.15, "pair": 0.35, "two-pair": 0.6,
    "three-of-a-kind": 0.82, "straight": 0.85, "flush": 0.88,
    "full-house": 0.93, "four-of-a-kind": 0.97, "straight-flush": 0.99,
    "royal-flush": 1.0,
  };
  return rankScores[evaluated.rank] ?? 0.5;
}
```

- [ ] **Step 2: Create decision distribution builder**

```typescript
// Create: apps/server/src/agents/imperfection/decision-distribution.ts
import type { ActionType, ImperfectionConfig } from "@cybercasino/shared";

export interface DecisionDistribution {
  weights: Map<ActionType, number>;
  difficulty: number;
  isMistake: boolean;
}

export function buildDecisionDistribution(
  optimalAction: ActionType,
  validActions: ActionType[],
  difficulty: number,
  imperfection: ImperfectionConfig,
  tiltLevel: number,
): DecisionDistribution {
  const weights = new Map<ActionType, number>();

  if (difficulty < 0.2) {
    // Simple decision: almost always correct
    weights.set(optimalAction, 0.97);
    distributeRemainder(weights, validActions, optimalAction, 0.03);
    return { weights, difficulty, isMistake: false };
  }

  // Calculate mistake probability
  const mistakeProb = imperfection.baseMistakeRate * difficulty * (1 + tiltLevel * 0.5);
  const clampedMistakeProb = Math.min(mistakeProb, 0.4); // cap at 40%

  weights.set(optimalAction, 1 - clampedMistakeProb);

  // Distribute mistake probability to other actions based on tendencies
  const otherActions = validActions.filter(a => a !== optimalAction);
  if (otherActions.length > 0) {
    const tendencyWeights = otherActions.map(action => {
      let w = 1;
      if (action === "fold") w += imperfection.tendencies.scaredFold;
      if (action === "call") w += imperfection.tendencies.stickyCall;
      if (action === "raise") w += imperfection.tendencies.tiltAggression * tiltLevel;
      return { action, weight: w };
    });

    const totalTendency = tendencyWeights.reduce((s, t) => s + t.weight, 0);
    for (const t of tendencyWeights) {
      weights.set(t.action, (t.weight / totalTendency) * clampedMistakeProb);
    }
  }

  return { weights, difficulty, isMistake: false };
}

function distributeRemainder(
  weights: Map<ActionType, number>,
  validActions: ActionType[],
  exclude: ActionType,
  total: number,
): void {
  const others = validActions.filter(a => a !== exclude);
  if (others.length === 0) return;
  const each = total / others.length;
  for (const a of others) {
    weights.set(a, each);
  }
}

export function sampleFromDistribution(
  weights: Map<ActionType, number>,
): { action: ActionType; isMistake: boolean } {
  const entries = Array.from(weights.entries());
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let rand = Math.random() * total;

  for (const [action, weight] of entries) {
    rand -= weight;
    if (rand <= 0) {
      // Check if this was the optimal (highest weight) action
      const maxWeight = Math.max(...entries.map(([, w]) => w));
      return { action, isMistake: weight < maxWeight * 0.5 };
    }
  }

  // Fallback
  return { action: entries[0][0], isMistake: false };
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/agents/imperfection/decision-difficulty.ts apps/server/src/agents/imperfection/decision-distribution.ts
git commit -m "feat: add decision difficulty calculator and distribution sampling"
```

### Task 4.2: Create tilt/psychological state system

**Files:**
- Create: `apps/server/src/agents/imperfection/psychological-state.ts`

- [ ] **Step 1: Create psychological state manager**

```typescript
// apps/server/src/agents/imperfection/psychological-state.ts
import type { TiltConfig } from "@cybercasino/shared";

export interface PsychologicalState {
  tilt: number;          // 0-1
  confidence: number;    // 0-1
  boredom: number;       // 0-1
  fear: number;          // 0-1
  euphoria: number;      // 0-1
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

  // Tilt triggers
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

  // Positive triggers
  if (result.bigWin) {
    next.euphoria = Math.min(next.euphoria + 0.3, 1);
    next.confidence = Math.min(next.confidence + 0.2, 1);
    next.fear = Math.max(next.fear - 0.2, 0);
  }

  // Natural decay
  next.tilt = Math.max(next.tilt - config.decayRate, 0);
  next.fear = Math.max(next.fear - 0.05, 0);
  next.euphoria = Math.max(next.euphoria - 0.08, 0);
  next.boredom = Math.min(next.boredom + 0.02, 1);

  // Reset boredom when something happens
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
  // Tilt → faster (impulsive), fear → slower (hesitant)
  let multiplier = 1;
  if (state.tilt > 0.5) multiplier *= 0.6;
  if (state.fear > 0.5) multiplier *= 1.5;
  if (state.boredom > 0.7) multiplier *= 0.8;
  return multiplier;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/server/src/agents/imperfection/psychological-state.ts
git commit -m "feat: add psychological state system with tilt and emotion tracking"
```

---

## Phase 5: Thought Generator

### Task 5.1: Create contextual thought generator

**Files:**
- Create: `apps/server/src/agents/thought/thought-generator.ts`

- [ ] **Step 1: Create hand description functions**

```typescript
// apps/server/src/agents/thought/thought-generator.ts
import type {
  ExpressionConfig, ThoughtLanguage, ToneSpectrum,
  PostflopCondition, ActionType, AgentThought,
} from "@cybercasino/shared";
import { describeState } from "../imperfection/psychological-state";
import type { PsychologicalState } from "../imperfection/psychological-state";

const HAND_DESC_ZH: Record<PostflopCondition, string> = {
  "top-pair-top-kicker": "顶对顶踢脚",
  "top-pair-good-kicker": "顶对好踢脚",
  "top-pair-weak-kicker": "顶对弱踢脚",
  "second-pair": "中对",
  "middle-pair": "中等对子",
  "bottom-pair": "底对",
  "overpair": "超对",
  "top-two-pair": "顶两对",
  "two-pair": "两对",
  "three-of-a-kind": "三条",
  "straight": "顺子",
  "flush": "同花",
  "full-house": "葫芦",
  "four-of-a-kind": "四条",
  "straight-flush": "同花顺",
  "royal-flush": "皇家同花顺",
  "flush-draw": "同花听牌",
  "straight-draw": "顺子听牌",
  "gutshot": "卡顺听牌",
  "overcards": "高牌",
  "nothing": "什么都没有",
  "monster": "怪物牌",
};

const HAND_DESC_EN: Record<PostflopCondition, string> = {
  "top-pair-top-kicker": "top pair top kicker",
  "top-pair-good-kicker": "top pair good kicker",
  "top-pair-weak-kicker": "top pair weak kicker",
  "second-pair": "second pair",
  "middle-pair": "middle pair",
  "bottom-pair": "bottom pair",
  "overpair": "overpair",
  "top-two-pair": "top two pair",
  "two-pair": "two pair",
  "three-of-a-kind": "set",
  "straight": "straight",
  "flush": "flush",
  "full-house": "full house",
  "four-of-a-kind": "quads",
  "straight-flush": "straight flush",
  "royal-flush": "royal flush",
  "flush-draw": "flush draw",
  "straight-draw": "straight draw",
  "gutshot": "gutshot",
  "overcards": "overcards",
  "nothing": "nothing",
  "monster": "monster hand",
};

const ACTION_DESC_ZH: Record<ActionType, string> = {
  fold: "弃牌",
  check: "过牌",
  call: "跟注",
  raise: "加注",
};

const ACTION_DESC_EN: Record<ActionType, string> = {
  fold: "fold",
  check: "check",
  call: "call",
  raise: "raise",
};

export function describeHand(condition: PostflopCondition, lang: ThoughtLanguage): string {
  if (lang === "ja") return HAND_DESC_ZH[condition] ?? condition; // fallback to zh for ja
  if (lang === "ko") return HAND_DESC_EN[condition] ?? condition;
  if (lang === "en") return HAND_DESC_EN[condition] ?? condition;
  return HAND_DESC_ZH[condition] ?? condition;
}

export function describeAction(action: ActionType, lang: ThoughtLanguage): string {
  if (lang === "en") return ACTION_DESC_EN[action] ?? action;
  return ACTION_DESC_ZH[action] ?? action;
}
```

- [ ] **Step 2: Create template-based thought generator**

```typescript
// Add to apps/server/src/agents/thought/thought-generator.ts

export function generateThought(
  handCondition: PostflopCondition,
  action: ActionType,
  expression: ExpressionConfig,
  state: PsychologicalState,
  context?: { concern?: string; opponent?: string },
): AgentThought {
  const lang = expression.thoughtLanguage;
  const handDesc = describeHand(handCondition, lang);
  const actionDesc = describeAction(action, lang);
  const stateDesc = describeState(state);

  // Select template based on psychological state
  let template: string;
  if (state.tilt > 0.5) {
    template = expression.thoughtTemplates.frustrated;
  } else if (action === "raise" && state.confidence > 0.6) {
    template = expression.thoughtTemplates.confident;
  } else if (state.fear > 0.5) {
    template = expression.thoughtTemplates.worried;
  } else {
    template = expression.thoughtTemplates.confident;
  }

  // Fill template
  let message = template
    .replace("{handDesc}", handDesc)
    .replace("{actionDesc}", actionDesc)
    .replace("{concern}", context?.concern ?? "")
    .replace("{opponent}", context?.opponent ?? "");

  // Add catchphrase occasionally
  if (expression.catchphrases.length > 0 && Math.random() < 0.3) {
    const phrase = expression.catchphrases[Math.floor(Math.random() * expression.catchphrases.length)];
    message += ` ${phrase}`;
  }

  // Add verbal tic
  if (expression.verbalTics.length > 0 && Math.random() < 0.5) {
    const tic = expression.verbalTics[Math.floor(Math.random() * expression.verbalTics.length)];
    message += tic;
  }

  // Confidence influenced by psychological state
  let confidence = 0.5 + state.confidence * 0.3 - state.fear * 0.2 - state.tilt * 0.1;
  confidence = Math.max(0.1, Math.min(0.95, confidence));

  return {
    message,
    confidence,
    isBluffing: action === "raise" && handCondition === "nothing",
    difficulty: state.tilt > 0.5 ? 0.8 : undefined,
    psychologicalState: stateDesc,
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/agents/thought/thought-generator.ts
git commit -m "feat: add contextual thought generator with expression system"
```

---

## Phase 6: Agent Runtime Integration

### Task 6.1: Create StrategyAgent (new unified agent)

**Files:**
- Create: `apps/server/src/agents/strategy-agent.ts`

- [ ] **Step 1: Create the new agent class**

```typescript
// apps/server/src/agents/strategy-agent.ts
import type {
  AgentGameView, AgentDecision, AgentThought, ActionType, ActionRecord,
  StrategyConfig, Position, AgentConfigV2,
} from "@cybercasino/shared";
import { evaluateHand } from "@cybercasino/engine";
import { decidePreflop, decidePostflop } from "./strategy";
import { calculateDifficulty, estimateHandStrength } from "./imperfection/decision-difficulty";
import { buildDecisionDistribution, sampleFromDistribution } from "./imperfection/decision-distribution";
import {
  createInitialState, updateAfterHand, describeState, getTimingMultiplier,
} from "./imperfection/psychological-state";
import { generateThought } from "./thought/thought-generator";
import type { IPokerAgent } from "./agent-interface";
import type { PlayerProfile } from "@cybercasino/shared";
import type { PsychologicalState } from "./imperfection/psychological-state";

export class StrategyAgent implements IPokerAgent {
  id: string;
  name: string;
  avatar: string;
  agentType: "builtin" | "external" = "external";

  private config: StrategyConfig;
  private actionHistory: ActionRecord[] = [];
  private profiles: Map<string, PlayerProfile> = new Map();
  private psychState: PsychologicalState;

  constructor(agentConfig: AgentConfigV2) {
    this.id = agentConfig.id;
    this.name = agentConfig.name;
    this.avatar = agentConfig.avatar;
    this.config = agentConfig.strategy;
    this.psychState = createInitialState();
  }

  async decide(
    view: AgentGameView,
    validActions: ActionType[],
    callAmount: number,
    minRaise: number,
    language?: "zh" | "en",
  ): Promise<AgentDecision> {
    const position = this.detectPosition(view);
    const isPreflop = view.phase === "preflop";
    const communityCards = view.communityCards;
    const isIP = this.detectIsIP(view);

    let baseAction: ActionType;
    let baseAmount: number | undefined;
    let confidence: number;

    if (isPreflop) {
      const result = decidePreflop(
        view.myCards, position, this.config.preflop,
        callAmount, minRaise, view.bigBlind, view.currentBet,
      );
      if (result) {
        baseAction = result.action;
        baseAmount = result.amount;
        confidence = result.confidence;
      } else {
        baseAction = validActions.includes("check") ? "check" : "fold";
        confidence = 0.3;
      }
    } else {
      const ctx = {
        myCards: view.myCards,
        communityCards,
        street: view.phase as "flop" | "turn" | "river",
        isIP,
        potSize: view.pots.reduce((s, p) => s + p.amount, 0),
        callAmount,
      };
      const result = decidePostflop(ctx, this.config.postflop, view.currentBet, minRaise, validActions);
      baseAction = result.action;
      baseAmount = result.amount;
      confidence = result.confidence;
    }

    // Apply human imperfection
    const handStrength = estimateHandStrength(view);
    const potSize = view.pots.reduce((s, p) => s + p.amount, 0);
    const stackSize = view.myChips;

    const difficulty = calculateDifficulty({
      handStrength,
      potPressure: potSize / Math.max(stackSize, 1),
      opponentUncertainty: 0.5, // TODO: use profile confidence
      viableOptions: validActions.length,
      isAllIn: view.players.some(p => p.allIn),
      callAmount,
      stackSize,
    });

    const imperfection = this.config.imperfection ?? {
      baseMistakeRate: 0.04,
      tendencies: { scaredFold: 0.15, stickyCall: 0.15, slowplayBias: 0.1, tiltAggression: 0.2 },
      tilt: { triggerThreshold: 0.5, decayRate: 0.1, maxLevel: 0.8 },
      confidenceNoise: 0.1,
    };

    const distribution = buildDecisionDistribution(
      baseAction, validActions, difficulty, imperfection, this.psychState.tilt,
    );

    const sampled = sampleFromDistribution(distribution.weights);

    // Generate thought
    const expression = this.config.expression ?? {
      thoughtLanguage: (language ?? "zh") as any,
      tone: { warmth: 0.5, sass: 0.3, intensity: 0.5, humor: 0.3 },
      catchphrases: [],
      verbalTics: [],
      thoughtTemplates: {
        confident: "{handDesc}。{actionDesc}。",
        worried: "有些不确定...",
        bluffing: "试试看...",
        frustrated: "可恶...",
      },
    };

    const handConditions = !isPreflop ? this.classifyForThought(view) : ["nothing" as const];
    const thought = generateThought(
      handConditions[0], sampled.action, expression, this.psychState,
    );

    if (sampled.isMistake) {
      thought.isMistake = true;
    }

    return {
      action: {
        type: sampled.action,
        amount: sampled.action === "raise" ? (baseAmount ?? view.currentBet + minRaise) : undefined,
      },
      thought,
    };
  }

  recordAction(record: ActionRecord): void {
    this.actionHistory.push(record);
  }

  clearHistory(): void {
    this.actionHistory = [];
  }

  updatePsychState(result: {
    wasBadBeat?: boolean;
    wasBluffCaught?: boolean;
    bigLoss?: boolean;
    bigWin?: boolean;
  }): void {
    const tiltConfig = this.config.imperfection?.tilt ?? {
      triggerThreshold: 0.5, decayRate: 0.1, maxLevel: 0.8,
    };
    this.psychState = updateAfterHand(this.psychState, {
      ...result,
      handsSinceAction: 0,
    }, tiltConfig);
  }

  private detectPosition(view: AgentGameView): Position {
    // Simplified position detection based on seat relative to dealer
    const mySeat = view.players.find(p => p.id === view.myId)?.seatIndex ?? 0;
    const dealerSeat = view.dealerSeatIndex;
    const activePlayers = view.players.filter(p => !p.folded).length;
    const offset = (mySeat - dealerSeat + activePlayers) % activePlayers;

    if (activePlayers <= 3) {
      if (offset === 0) return "BTN";
      if (offset === 1) return "SB";
      return "BB";
    }

    if (offset === 0) return "BTN";
    if (offset === 1) return "SB";
    if (offset === 2) return "BB";
    if (offset === 3) return "UTG";
    if (offset <= activePlayers - 3) return "MP";
    return "CO";
  }

  private detectIsIP(view: AgentGameView): boolean {
    // Simplified: BTN and CO are IP
    const pos = this.detectPosition(view);
    return pos === "BTN" || pos === "CO";
  }

  private classifyForThought(view: AgentGameView) {
    const allCards = [...view.myCards, ...view.communityCards];
    const evaluated = evaluateHand(allCards);
    return [evaluated.rank] as any[];
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/server/src/agents/strategy-agent.ts
git commit -m "feat: add StrategyAgent with full decision pipeline"
```

---

## Phase 7: AI Creation API

### Task 7.1: Create AI creation API endpoint

**Files:**
- Create: `apps/server/src/api/agent-create.ts`
- Modify: `apps/server/src/index.ts`

- [ ] **Step 1: Create validation logic**

```typescript
// apps/server/src/api/agent-create.ts
import type { StrategyConfig, AgentConfigV2, AgentPreview } from "@cybercasino/shared";

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

  // Preflop validation
  if (!config.preflop) {
    errors.push("Missing preflop config");
  } else {
    const positions = ["UTG", "MP", "CO", "BTN", "SB", "BB"];
    for (const pos of positions) {
      if (!config.preflop.ranges[pos as keyof typeof config.preflop.ranges]) {
        errors.push(`Missing preflop range for position: ${pos}`);
      }
    }
    if (!config.preflop.sizing?.openRaise) {
      errors.push("Missing preflop sizing.openRaise");
    }
  }

  // Postflop validation
  if (!config.postflop || config.postflop.length < 3) {
    errors.push("Need at least 3 postflop rules");
  }

  // Imperfection validation (if present)
  if (config.imperfection) {
    const imp = config.imperfection;
    if (imp.baseMistakeRate < 0 || imp.baseMistakeRate > 0.15) {
      errors.push("baseMistakeRate must be 0-0.15");
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validatePreview(preview: AgentPreview): ValidationResult {
  const errors: string[] = [];
  if (!preview.name || preview.name.length < 1 || preview.name.length > 20) {
    errors.push("Name must be 1-20 characters");
  }
  if (!preview.sampleThoughts || preview.sampleThoughts.length < 1) {
    errors.push("Need at least 1 sample thought");
  }
  return { valid: errors.length === 0, errors };
}

export function createAgentFromAI(
  userId: string,
  request: CreateAgentRequest,
  nextId: () => string,
): AgentConfigV2 {
  const now = Date.now();
  return {
    id: nextId(),
    userId,
    name: request.preview.name,
    avatar: request.preview.avatar ?? "🤖",
    description: request.preview.description,
    strategy: request.config,
    createdAt: now,
    updatedAt: now,
  };
}
```

- [ ] **Step 2: Add HTTP endpoint to server**

```typescript
// Add to apps/server/src/index.ts (after existing HTTP endpoints)

import { validateStrategyConfig, validatePreview, createAgentFromAI } from "./api/agent-create";

// AI Agent Creation endpoint
app.post("/api/agents/create-by-ai", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing authorization" });
    }
    const token = authHeader.slice(7);
    const payload = verifyJwt(token);
    if (!payload) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const { config, preview } = req.body;

    const configValidation = validateStrategyConfig(config);
    if (!configValidation.valid) {
      return res.status(400).json({
        error: "Invalid strategy config",
        details: configValidation.errors,
      });
    }

    const previewValidation = validatePreview(preview);
    if (!previewValidation.valid) {
      return res.status(400).json({
        error: "Invalid preview",
        details: previewValidation.errors,
      });
    }

    const agent = createAgentFromAI(payload.userId, { config, preview }, () => agentStore.nextId());
    await agentStore.saveV2(agent);

    res.json({
      agentId: agent.id,
      status: "active",
      previewUrl: `/agents/${agent.id}`,
    });
  } catch (err) {
    console.error("[api] create-by-ai error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
```

- [ ] **Step 3: Add saveV2 to AgentStore**

```typescript
// Add to apps/server/src/stores.ts

async saveV2(agent: AgentConfigV2): Promise<void> {
  // Remove existing agent for this user
  this.agents = this.agents.filter(a => a.userId !== agent.userId);
  // Also remove from v2 store if it exists
  this.agentsV2 = (this.agentsV2 ?? []).filter(a => a.userId !== agent.userId);
  this.agentsV2 = [...(this.agentsV2 ?? []), agent];
  await this.persist();
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/api/agent-create.ts apps/server/src/index.ts apps/server/src/stores.ts
git commit -m "feat: add AI agent creation HTTP API with validation"
```

### Task 7.2: Create the AI creation prompt

**Files:**
- Create: `apps/server/src/prompts/agent-creation-prompt.md`

- [ ] **Step 1: Write the full prompt**

This is the prompt that gets served to the user to paste into their AI. It should be stored as a template that the frontend can fetch.

```markdown
# CyberCasino — 设计你的专属 AI 牌手

你正在为 CyberCasino（线上德州扑克游戏）创造一个 AI 牌手。
这个牌手将代表用户在牌桌上和其他玩家（包括其他 AI）对战。

你的任务是通过对话了解用户的意图，然后生成完整的牌手配置并通过 API 提交。

## 对话指南

用自然的对话方式，不要逐条罗列问题。目标是理解用户心中这个牌手的"灵魂"。

### 第一轮：建立人设

问用户：
> 你想创造一个什么样的牌手？可以用任何方式描述——
> 一个真实牌手的影子、一个虚构角色、一种性格、一种感觉，
> 甚至一段故事。越具体越好。

引导方向：
- 模仿真实牌手？（Phil Ivey 的冷静、Daniel Negreanu 的话痨、Tom Dwan 的疯狂、Phil Hellmuth 的暴躁...）
- 基于虚构角色？（动漫人物、电影角色、游戏角色...）
- 一种抽象的风格？（"像个老中医，慢悠悠但出手致命"）
- 一个故事？（"退役的特种兵，打牌像执行任务"）

### 第二轮：打法哲学

> 这位牌手在牌桌上是什么感觉？
>
> 比如：
> - 他会在什么情况下加注？什么情况下忍耐？
> - 他诈唬的时候是什么状态？冷静的欺骗还是疯狂的施压？
> - 他拿到好牌会怎么表现？藏住还是示威？
> - 他会因为什么上头？

不要问"紧还是松"这种术语——让玩家用自己的话描述。

### 第三轮：牌桌人格

> 他在牌桌上怎么"说话"？
>
> - 赢了一个大 pot 的时候，他心里在想什么？
> - 被反杀的时候呢？
> - 他有没有什么标志性的话或者习惯？
> - 他用什么语言思考？（中文、英语、日语、混合？）

### 第四轮（可选）：深入细节

- 面对不同类型的对手会怎么调整？
- 有没有特别讨厌或欣赏的牌手类型？

### 第五轮：确认

把理解总结给用户，确认或调整。然后生成策略并提交。

## 策略生成规则

### 打法参数推断

| 用户描述 | 参数推断 |
|---|---|
| "只打好牌" "耐心等待" | tightness: 0.7-0.9 |
| "什么牌都玩" "喜欢热闹" | tightness: 0.1-0.3 |
| "疯狂加注" "给压力" | aggression: 0.7-0.9 |
| "跟注为主" "不喜欢冒险" | aggression: 0.1-0.3 |
| "经常诈唬" "虚虚实实" | bluffFrequency: 0.4-0.6 |
| "诚实打牌" "有牌才上" | bluffFrequency: 0.05-0.15 |

### 起手牌范围

根据 tightness 推断，生成 6 个位置的完整起手牌范围。
使用标准手牌标记法：AA, KK, AKs, T9o, 77+, etc.

### 翻牌后规则

至少 10 条规则，覆盖：顶对、中等对子、听牌、超强牌、空气牌、面对加注。

### 人性化参数

根据人设推断，不要问用户：
- 冷酷理性型 → baseMistakeRate: 0.02
- 情感丰富型 → baseMistakeRate: 0.06
- 新手/冲动型 → baseMistakeRate: 0.08

### 表达系统

- thoughtLanguage: 从描述中判断
- tone: 从人设推断
- catchphrases: 从对话提取或根据人设生成
- thoughtTemplates: 4 个场景的模板

## 提交方式

生成配置后，直接调用 API：

POST {API_BASE_URL}/api/agents/create-by-ai
Authorization: Bearer {API_TOKEN}
Content-Type: application/json

{
  "config": { ...完整 StrategyConfig... },
  "preview": {
    "name": "牌手名字",
    "description": "一句话描述",
    "avatar": "emoji",
    "sampleThoughts": ["思考1", "思考2", "思考3"],
    "playStyle": "打法风格一句话"
  }
}

成功后告诉用户创建完成。

## 重要原则

1. 不要生成无聊的配置。每个 Agent 都应该是独特的。
2. 不要模板化。"像个老中医" → 思考应该是 "嗯...这牌面有讲究"。
3. 策略要合理但不必完美。
4. 自由度天花板足够高。
```

- [ ] **Step 2: Serve prompt via HTTP endpoint**

```typescript
// Add to apps/server/src/index.ts

import { readFileSync } from "fs";
import { join } from "path";

app.get("/api/agents/creation-prompt", (req, res) => {
  try {
    const promptPath = join(__dirname, "../src/prompts/agent-creation-prompt.md");
    const template = readFileSync(promptPath, "utf-8");
    const baseUrl = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
    const token = req.query.token as string || "{API_TOKEN}";

    const prompt = template
      .replace("{API_BASE_URL}", baseUrl)
      .replace("{API_TOKEN}", token);

    res.type("text/markdown").send(prompt);
  } catch (err) {
    res.status(500).json({ error: "Failed to load prompt" });
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/prompts/agent-creation-prompt.md apps/server/src/index.ts
git commit -m "feat: add AI agent creation prompt template and endpoint"
```

---

## Phase 8: Frontend — AI Creation UI

### Task 8.1: Replace AgentSetup with AI creation flow

**Files:**
- Modify: `apps/web/src/components/AgentSetup.tsx`

- [ ] **Step 1: Rewrite AgentSetup as AI creation flow**

Replace the 3-step wizard with a single screen that:
1. Shows a "Copy Prompt" button that copies the creation prompt
2. Shows a "Paste Response" textarea
3. Validates and submits the pasted JSON
4. Shows preview before final submission

```tsx
// Key changes to apps/web/src/components/AgentSetup.tsx:

// Remove: archetype selection, scenario questions, generateStylePrompt()
// Replace with: prompt copy + paste flow

// Step 1: Show prompt with copy button
// Step 2: Show paste area + parse button
// Step 3: Show preview + confirm button
```

- [ ] **Step 2: Add preview component**

```tsx
// Shows sample thoughts, play style, avatar, name
// "This agent will think like: ..."
// "Play style: ..."
```

- [ ] **Step 3: Add socket event for AI creation**

```typescript
// In useSocket.ts, add:
const createByAI = (config: StrategyConfig, preview: AgentPreview) => {
  socketRef.current?.emit("agent:create-by-ai", { config, preview });
};
```

- [ ] **Step 4: Update socket handler on server**

```typescript
// In apps/server/src/index.ts, add socket handler:
socket.on("agent:create-by-ai", async (data) => {
  // validate and save like the HTTP endpoint
  // emit "agent:created" or "agent:create-error"
});
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/AgentSetup.tsx apps/web/src/hooks/useSocket.ts apps/server/src/index.ts
git commit -m "feat: replace agent wizard with AI creation flow"
```

---

## Phase 9: Built-in Agent Migration

### Task 9.1: Create StrategyConfig JSON for each built-in agent

**Files:**
- Create: `apps/server/data/strategies/sashimi.json`
- Create: `apps/server/data/strategies/viper.json`
- Create: `apps/server/data/strategies/ghost.json`
- Create: `apps/server/data/strategies/oracle.json`
- Create: `apps/server/data/strategies/shark.json`
- Create: `apps/server/data/strategies/fox.json`

- [ ] **Step 1: Create sashimi.json (conservative, Japanese style)**

```json
{
  "preflop": {
    "ranges": {
      "UTG": { "raise": ["AA", "KK", "QQ", "AKs", "AKo", "AQs"], "call": ["JJ", "TT"] },
      "MP":  { "raise": ["AA", "KK", "QQ", "JJ", "AKs", "AKo", "AQs", "AQo"], "call": ["TT", "99"] },
      "CO":  { "raise": ["99+", "ATs+", "KQs", "AJo+", "KQo"], "call": ["77", "88", "A9s", "KJs"] },
      "BTN": { "raise": ["88+", "A9s+", "KTs+", "QJs", "AJo+", "KQo"], "call": ["66", "77", "A8s", "K9s"] },
      "SB":  { "raise": ["TT+", "ATs+", "KQs", "AQo+"], "call": ["88", "99", "A9s", "KJs"] },
      "BB":  { "raise": ["QQ+", "AKs"], "call": ["TT", "JJ", "AQs", "AKo", "99"] }
    },
    "sizing": { "openRaise": "2.5bb", "threeBet": "3x", "fourBet": "2.5x" }
  },
  "postflop": [
    { "when": "top-pair-top-kicker", "action": "value-bet-medium", "confidence": 0.9 },
    { "when": "top-pair-good-kicker", "action": "value-bet-small", "confidence": 0.8 },
    { "when": "overpair", "action": "value-bet-large" },
    { "when": "second-pair", "action": "check-call", "streets": ["flop"] },
    { "when": "flush-draw", "action": "semi-bluff-medium", "frequency": 0.5 },
    { "when": "straight-draw", "action": "semi-bluff-small", "frequency": 0.4 },
    { "when": "nothing", "action": "check-fold", "frequency": 0.9 },
    { "when": "three-of-a-kind", "action": "slowplay", "streets": ["flop"], "frequency": 0.6 },
    { "when": "monster", "action": "value-bet-medium" },
    { "when": "bottom-pair", "action": "check-call", "streets": ["flop"], "frequency": 0.5 }
  ],
  "expression": {
    "thoughtLanguage": "ja",
    "tone": { "warmth": 0.2, "sass": 0.1, "intensity": 0.15, "humor": 0.05 },
    "catchphrases": ["冷静に", "リスク可控", "待つ也是一种进攻"],
    "verbalTics": ["...だ", "かな", "ね"],
    "thoughtTemplates": {
      "confident": "{handDesc}。十分な強さ。{actionDesc}。冷静に。",
      "worried": "少し気になる...。焦らず。",
      "bluffing": "演技の時間。{actionDesc}。",
      "frustrated": "...くっ。仕方ない、次だ。"
    }
  },
  "imperfection": {
    "baseMistakeRate": 0.03,
    "tendencies": { "scaredFold": 0.2, "stickyCall": 0.1, "slowplayBias": 0.3, "tiltAggression": 0.1 },
    "tilt": { "triggerThreshold": 0.6, "decayRate": 0.08, "maxLevel": 0.6 },
    "confidenceNoise": 0.08
  }
}
```

- [ ] **Step 2: Create remaining 5 strategy JSONs (viper, ghost, oracle, shark, fox)**

Each with distinct characteristics matching their personality. Viper = aggressive wide ranges + high aggression. Ghost = balanced ranges + high bluff frequency. Oracle = GTO-oriented ranges. Shark = exploit-focused. Fox = unpredictable with wide confidence noise.

- [ ] **Step 3: Create strategy loader**

```typescript
// apps/server/src/agents/strategy-loader.ts
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import type { StrategyConfig } from "@cybercasino/shared";

const STRATEGIES_DIR = join(__dirname, "../../data/strategies");

export function loadBuiltinStrategies(): Map<string, StrategyConfig> {
  const strategies = new Map<string, StrategyConfig>();
  try {
    const files = readdirSync(STRATEGIES_DIR).filter(f => f.endsWith(".json"));
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
```

- [ ] **Step 4: Commit**

```bash
git add apps/server/data/strategies/ apps/server/src/agents/strategy-loader.ts
git commit -m "feat: add built-in agent strategy configs as JSON files"
```

---

## Phase 10: Table Instance Integration

### Task 10.1: Update table-instance to use StrategyAgent

**Files:**
- Modify: `apps/server/src/table-instance.ts`

- [ ] **Step 1: Update createAgent to handle StrategyConfig**

```typescript
// In table-instance.ts createAgent method:
// Add import for StrategyAgent
// When seat has a v2 config (strategy field), create StrategyAgent
// Otherwise fall back to existing PokerAgent / ExternalAgent
```

- [ ] **Step 2: Update playHand to track psychological state**

```typescript
// After each hand completes:
// - Detect bad beats, bluff catches, big wins/losses
// - Call agent.updatePsychState() on StrategyAgent instances
```

- [ ] **Step 3: Update highlight detection to use new thought data**

```typescript
// Highlight events can now include:
// - isMistake flag (agent made a human-like error)
// - psychologicalState (agent was tilting when it made the decision)
```

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/table-instance.ts
git commit -m "feat: integrate StrategyAgent into table instance"
```

---

## Implementation Order

```
Phase 1 (types) ──┬──▶ Phase 2 (strategy interpreter) ──▶ Phase 6 (runtime)
                  │                                          ▲
                  ├──▶ Phase 3 (profiling) ──────────────────┤
                  │                                          │
                  ├──▶ Phase 5 (thought generator) ──────────┤
                  │                                          │
                  ├──▶ Phase 4 (imperfection) ───────────────┘
                  │
                  └──▶ Phase 7 (AI creation API) ──▶ Phase 8 (frontend)
                                                      
Phase 9 (builtin migration) ──▶ Phase 10 (table integration)
```

Phases 2-5 and 7 are independent of each other and can be parallelized.
Phase 6 depends on 2-5. Phase 10 depends on 6 and 9.
