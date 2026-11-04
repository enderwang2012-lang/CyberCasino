import type {
  Card,
  GameEvent,
  GamePhase,
  Action,
  ActionType,
  PlayerState,
  AgentThought,
  AgentActionAudit,
  Winner,
  ShowdownResult,
} from "@cybercasino/shared";
import { Deck } from "./deck";
import { PotManager } from "./pot-manager";
import { evaluateHand, compareHands } from "./hand-evaluator";

export interface GameConfig {
  smallBlind: number;
  bigBlind: number;
}

export interface GamePlayer {
  id: string;
  name: string;
  avatar: string;
  chips: number;
  seatIndex: number;
}

type DecisionCallback = (
  playerId: string,
  validActions: ActionType[],
  currentBet: number,
  minRaise: number,
  callAmount: number
) => Promise<{ action: Action; thought: AgentThought; audit?: AgentActionAudit }>;

export async function* gameLoop(
  players: GamePlayer[],
  config: GameConfig,
  dealerSeatIndex: number,
  handNumber: number,
  getDecision: DecisionCallback
): AsyncGenerator<GameEvent> {
  const deck = new Deck();
  const potManager = new PotManager();

  const state: PlayerState[] = players.map((p) => ({
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    chips: p.chips,
    holeCards: null,
    bet: 0,
    folded: false,
    allIn: false,
    seatIndex: p.seatIndex,
  }));

  potManager.reset(state.map((p) => p.id));

  yield { type: "hand-start", handNumber, players: state, dealerSeatIndex };

  // Post blinds
  const activePlayers = state.filter((p) => p.chips > 0);
  if (activePlayers.length < 2) return;

  const seatOrder = [...state].sort((a, b) => a.seatIndex - b.seatIndex);
  const dealerIdx = seatOrder.findIndex((p) => p.seatIndex === dealerSeatIndex);

  function nextActiveFrom(fromIdx: number): PlayerState {
    let idx = (fromIdx + 1) % seatOrder.length;
    while (seatOrder[idx].chips <= 0) {
      idx = (idx + 1) % seatOrder.length;
    }
    return seatOrder[idx];
  }

  const sbPlayer = activePlayers.length === 2 ? seatOrder[dealerIdx] : nextActiveFrom(dealerIdx);
  const sbIdx = seatOrder.indexOf(sbPlayer);
  const bbPlayer = nextActiveFrom(sbIdx);

  const sbAmount = Math.min(config.smallBlind, sbPlayer.chips);
  sbPlayer.chips -= sbAmount;
  sbPlayer.bet = sbAmount;
  if (sbPlayer.chips === 0) sbPlayer.allIn = true;
  potManager.addBet(sbPlayer.id, sbAmount);

  const bbAmount = Math.min(config.bigBlind, bbPlayer.chips);
  bbPlayer.chips -= bbAmount;
  bbPlayer.bet = bbAmount;
  if (bbPlayer.chips === 0) bbPlayer.allIn = true;
  potManager.addBet(bbPlayer.id, bbAmount);

  yield {
    type: "blinds-posted",
    smallBlindPlayerId: sbPlayer.id,
    bigBlindPlayerId: bbPlayer.id,
    smallBlind: sbAmount,
    bigBlind: bbAmount,
  };

  // Deal hole cards
  const hands: Record<string, Card[]> = {};
  for (const p of state) {
    if (p.chips > 0 || p.bet > 0) {
      const cards = deck.deal(2);
      p.holeCards = cards;
      hands[p.id] = cards;
    }
  }
  yield { type: "cards-dealt", hands };

  // Betting rounds
  const phases: { phase: GamePhase; cardCount: number }[] = [
    { phase: "preflop", cardCount: 0 },
    { phase: "flop", cardCount: 3 },
    { phase: "turn", cardCount: 1 },
    { phase: "river", cardCount: 1 },
  ];

  const communityCards: Card[] = [];

  for (const { phase, cardCount } of phases) {
    const inHand = state.filter((p) => !p.folded && (p.chips > 0 || p.bet > 0 || p.allIn));
    if (inHand.length <= 1) break;

    const canAct = inHand.filter((p) => !p.allIn);
    if (canAct.length <= 1 && phase !== "preflop") {
      // Only one player can act — deal remaining cards for showdown
      if (cardCount > 0) {
        if (phase === "flop") deck.deal(1); // burn
        const newCards = deck.deal(cardCount);
        communityCards.push(...newCards);
        yield { type: "phase-change", phase, communityCards: [...communityCards] };
      }
      continue;
    }

    if (cardCount > 0) {
      deck.deal(1); // burn card
      const newCards = deck.deal(cardCount);
      communityCards.push(...newCards);
      yield { type: "phase-change", phase, communityCards: [...communityCards] };
    }

    // Reset bets for new round (except preflop where blinds are already in)
    if (phase !== "preflop") {
      for (const p of state) {
        p.bet = 0;
      }
    }

    let currentBet = phase === "preflop" ? Math.max(sbAmount, bbAmount) : 0;
    let minRaise = config.bigBlind;
    let raiseCount = 0;
    const MAX_RAISES = 4;
    // 已经对上一次完整加注表过态的人。不足额全下不会清空它，因此不能再加注。
    const acted = new Set<string>();

    let startIdx: number;
    if (phase === "preflop") {
      const bbIdx = seatOrder.indexOf(bbPlayer);
      startIdx = (bbIdx + 1) % seatOrder.length;
    } else {
      startIdx = (dealerIdx + 1) % seatOrder.length;
    }

    let actorIdx = startIdx;
    let idle = 0;
    let guard = 0;
    const needsAction = (player: PlayerState) =>
      !player.folded && !player.allIn && player.chips > 0
      && (!acted.has(player.id) || player.bet < currentBet);

    while (idle < seatOrder.length && guard < seatOrder.length * (MAX_RAISES + 3)) {
      guard++;
      const player = seatOrder[actorIdx];
      actorIdx = (actorIdx + 1) % seatOrder.length;
      if (!needsAction(player)) {
        idle++;
        continue;
      }
      idle = 0;

      const callAmount = Math.max(0, currentBet - player.bet);
      const validActions: ActionType[] = [];
      if (callAmount <= 0) validActions.push("check");
      else validActions.push("call");
      validActions.push("fold");
      const facingShortAllIn = acted.has(player.id) && player.bet < currentBet;
      if (player.chips > callAmount && raiseCount < MAX_RAISES && !facingShortAllIn) {
        validActions.push("raise");
      }

      yield {
        type: "action-required",
        playerId: player.id,
        validActions,
        currentBet,
        minRaise,
        callAmount: Math.min(callAmount, player.chips),
      };

      const { action, thought, audit } = await getDecision(
        player.id,
        validActions,
        currentBet,
        minRaise,
        Math.min(callAmount, player.chips)
      );

      switch (action.type) {
        case "fold":
          player.folded = true;
          potManager.markFolded(player.id);
          acted.add(player.id);
          break;

        case "check":
          acted.add(player.id);
          break;

        case "call": {
          const toCall = Math.min(currentBet - player.bet, player.chips);
          player.chips -= toCall;
          player.bet += toCall;
          potManager.addBet(player.id, toCall);
          if (player.chips === 0) player.allIn = true;
          acted.add(player.id);
          break;
        }

        case "raise": {
          let raiseAmount = action.amount ?? currentBet + minRaise;
          const minTotalBet = currentBet + minRaise;
          if (raiseAmount < minTotalBet) {
            raiseAmount = minTotalBet;
          }
          const totalBet = Math.min(raiseAmount, player.bet + player.chips);
          const toAdd = totalBet - player.bet;
          const actualRaise = totalBet - currentBet;
          const fullRaise = actualRaise >= minRaise;
          if (fullRaise && actualRaise > minRaise) minRaise = actualRaise;
          player.chips -= toAdd;
          player.bet = totalBet;
          potManager.addBet(player.id, toAdd);
          if (player.chips === 0) player.allIn = true;
          if (actualRaise > 0) currentBet = totalBet;
          if (fullRaise) {
            raiseCount++;
            acted.clear();
          }
          acted.add(player.id);
          break;
        }
      }

      yield { type: "action-taken", playerId: player.id, action, thought, audit, allIn: player.allIn || undefined };
      yield { type: "pot-updated", pots: potManager.calculatePots() };

      if (state.filter((p) => !p.folded).length === 1) break;
    }

    if (state.filter((p) => !p.folded).length <= 1) break;
  }

  // Showdown or last player standing
  const remaining = state.filter((p) => !p.folded);
  const pots = potManager.calculatePots();
  const winners: Winner[] = [];

  if (remaining.length === 1) {
    const winner = remaining[0];
    const totalPot = potManager.getTotalPot();
    winners.push({ playerId: winner.id, amount: totalPot, potIndex: 0 });
    winner.chips += totalPot;
  } else {
    // Deal remaining community cards if needed
    while (communityCards.length < 5) {
      deck.deal(1);
      communityCards.push(...deck.deal(1));
    }

    const showdownResults: ShowdownResult[] = remaining.map((p) => {
      const allCards = [...p.holeCards!, ...communityCards];
      const evaluated = evaluateHand(allCards);
      return {
        playerId: p.id,
        holeCards: p.holeCards!,
        bestHand: evaluated.bestCards,
        handRank: evaluated.rank,
        handName: evaluated.name,
      };
    });

    yield { type: "showdown", results: showdownResults };

    for (let potIdx = 0; potIdx < pots.length; potIdx++) {
      const pot = pots[potIdx];
      const eligibleResults = showdownResults.filter((r) =>
        pot.eligiblePlayerIds.includes(r.playerId)
      );
      if (eligibleResults.length === 0) continue;
      // 只有一个人够到这一层，说明多出来的筹码没人跟，退回即可，不算赢下底池。
      const contested = pot.eligiblePlayerIds.length > 1;

      const evaluated = eligibleResults.map((r) => ({
        ...r,
        eval: evaluateHand([...r.holeCards, ...communityCards]),
      }));

      evaluated.sort((a, b) => compareHands(b.eval, a.eval));

      const bestScore = evaluated[0].eval.score;
      const potWinners = evaluated.filter((e) => e.eval.score === bestScore);
      const share = Math.floor(pot.amount / potWinners.length);
      const remainder = pot.amount - share * potWinners.length;
      const seatsFromButton = (playerId: string) => {
        const pos = seatOrder.findIndex((p) => p.id === playerId);
        return (pos - dealerIdx - 1 + seatOrder.length) % seatOrder.length;
      };
      const orderedWinners = [...potWinners].sort(
        (a, b) => seatsFromButton(a.playerId) - seatsFromButton(b.playerId),
      );

      for (let i = 0; i < orderedWinners.length; i++) {
        const amount = share + (i === 0 ? remainder : 0);
        const player = state.find((p) => p.id === orderedWinners[i].playerId)!;
        player.chips += amount;
        if (contested) winners.push({ playerId: player.id, amount, potIndex: potIdx });
      }
    }
  }

  yield { type: "hand-complete", winners, players: state };
}
