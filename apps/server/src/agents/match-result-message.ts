import type {
  ExternalAgentMatchResult,
  GameEvent,
  ReplayData,
  ReplayHandAction,
} from "@cybercasino/shared";

type MatchResultPayload = Omit<ExternalAgentMatchResult, "type" | "protocol_version">;

export function matchResultMessageFor(
  payload: MatchResultPayload,
): ExternalAgentMatchResult {
  return {
    type: "match_result",
    protocol_version: 1,
    ...payload,
    replay: publicReplayFor(payload.replay),
  };
}

export function publicReplayFor(replay: ReplayData): ReplayData {
  return {
    ...replay,
    hands: replay.hands.map((hand) => ({
      ...hand,
      actions: hand.actions.map(stripActionAudit),
    })),
    timeline: replay.timeline?.map(stripEventAudit),
  };
}

function stripActionAudit(action: ReplayHandAction): ReplayHandAction {
  const { audit: _audit, ...publicAction } = action;
  return publicAction;
}

function stripEventAudit(event: GameEvent): GameEvent {
  if (event.type !== "action-taken") return event;
  const { audit: _audit, ...publicEvent } = event;
  return publicEvent;
}
