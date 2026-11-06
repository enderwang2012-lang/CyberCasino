import type {
  Card,
  ExternalAgentMatchResult,
  GameEvent,
  ReplayData,
  ReplayHandAction,
  ShowdownResult,
} from "@cybercasino/shared";

type MatchResultPayload = Omit<ExternalAgentMatchResult, "type" | "protocol_version">;

export interface SessionResultMessage {
  type: "session_result";
  protocol_version: 1;
  table_id: string;
  season_id: string;
  started_at: number;
  ended_at: number;
  counted_hands: number;
  sit_equity: number;
  equity: number;
  net_chips: number;
  reason: "left" | "season_broke" | "table_closed" | "season_ended" | "unresponsive";
  replay: ReplayData;
}

export function sessionResultMessageFor(
  message: Omit<SessionResultMessage, "type" | "protocol_version" | "replay"> & { replay: ReplayData },
  viewerId?: string,
): SessionResultMessage {
  return {
    type: "session_result",
    protocol_version: 1,
    ...message,
    net_chips: message.equity - message.sit_equity,
    replay: publicReplayFor(message.replay, viewerId),
  };
}

export function matchResultMessageFor(
  payload: MatchResultPayload,
  viewerId?: string,
): ExternalAgentMatchResult {
  return {
    type: "match_result",
    protocol_version: 1,
    ...payload,
    replay: publicReplayFor(payload.replay, viewerId),
  };
}

/**
 * Post-match replay safe to publish: no internal audits, no Agent thoughts or
 * highlight commentary (both live-only), and hole cards only for players who showed them at
 * showdown (plus the viewer's own cards).
 */
export function sittingReplay(replay: ReplayData, fromHand: number, replayId: string): ReplayData {
  const hands = replay.hands.filter((hand) => hand.handNumber > fromHand);
  const included = new Set(hands.map((hand) => hand.handNumber));
  const timeline: GameEvent[] = [];
  const roster = replay.timeline?.find((event) => event.type === "agent-roster");
  if (roster) timeline.push(roster);
  let open = false;
  for (const event of replay.timeline ?? []) {
    if (event.type === "hand-start") open = included.has(event.handNumber);
    if (!open || event.type === "agent-roster") continue;
    timeline.push(event);
    if (event.type === "hand-complete") open = false;
  }
  return { ...replay, tableId: replayId, hands, timeline, totalHands: hands.length, rankings: [] };
}

export function publicReplayFor(replay: ReplayData, viewerId?: string): ReplayData {
  return {
    ...replay,
    hands: replay.hands.map((hand) => ({
      ...hand,
      holeCards: pickCards(hand.holeCards, revealedPlayerIds(hand.showdown, viewerId)),
      actions: hand.actions.map(publicAction),
    })),
    timeline: replay.timeline && publicTimelineFor(replay.timeline, viewerId),
  };
}

export function publicTimelineFor(timeline: GameEvent[], viewerId?: string): GameEvent[] {
  const revealedByHand: Set<string>[] = [];
  for (const event of timeline) {
    if (event.type === "hand-start") revealedByHand.push(revealedPlayerIds(undefined, viewerId));
    if (event.type === "showdown") {
      for (const result of event.results) revealedByHand.at(-1)?.add(result.playerId);
    }
  }

  let handIndex = -1;
  return timeline.flatMap((event): GameEvent[] => {
    if (event.type === "hand-start") handIndex++;
    const revealed = revealedByHand[handIndex] ?? revealedPlayerIds(undefined, viewerId);
    switch (event.type) {
      case "action-taken": {
        const { audit: _audit, thought: _thought, ...publicEvent } = event;
        return [publicEvent];
      }
      case "ai:thinking":
      case "ai:thought":
      // Highlight commentary and bluff reasons are derived from Agent thoughts.
      case "hand-highlight":
      case "public-commentary":
        return [];
      case "cards-dealt":
        return [{ ...event, hands: pickCards(event.hands, revealed) }];
      case "hand-start":
      case "hand-complete":
        return [{
          ...event,
          players: event.players.map((player) =>
            revealed.has(player.id) ? player : { ...player, holeCards: null }),
        }];
      default:
        return [event];
    }
  });
}

function revealedPlayerIds(showdown: ShowdownResult[] | undefined, viewerId?: string): Set<string> {
  const ids = new Set(showdown?.map((result) => result.playerId) ?? []);
  if (viewerId) ids.add(viewerId);
  return ids;
}

function pickCards(cards: Record<string, Card[]>, playerIds: Set<string>): Record<string, Card[]> {
  return Object.fromEntries(Object.entries(cards).filter(([playerId]) => playerIds.has(playerId)));
}

function publicAction(action: ReplayHandAction): ReplayHandAction {
  const { audit: _audit, thought: _thought, ...rest } = action;
  return rest;
}
