import type {
  AgentMatchSummary,
  ReplayData,
  TableInfo,
} from "@cybercasino/shared";

type StoredMatch = {
  info: TableInfo;
  events: ReplayData | null | undefined;
};

export function recentMatchesFor(
  agentId: string,
  values: StoredMatch[],
  limit = 20,
): AgentMatchSummary[] {
  return values
    .filter((entry): entry is { info: TableInfo; events: ReplayData } => {
      if (!entry.events || !Array.isArray(entry.events.players) || !Array.isArray(entry.events.rankings)) {
        return false;
      }
      const playerIds = new Set(entry.events.players.map((player) => player.id));
      return entry.events.rankings.some((ranking) => ranking.playerId === agentId && playerIds.has(agentId));
    })
    .sort((a, b) => (b.info.finishedAt ?? 0) - (a.info.finishedAt ?? 0))
    .slice(0, limit)
    .map(({ info, events }) => {
      const ranking = events.rankings.find((result) => result.playerId === agentId);
      const player = events.players.find((candidate) => candidate.id === agentId);
      const handsPlayed = ranking?.handsPlayed
        ?? countHandsPlayed(agentId, events)
        ?? events.totalHands;
      return {
        tableId: events.tableId || info.id,
        tableName: events.tableName || info.name,
        finishedAt: info.finishedAt,
        position: ranking!.position,
        totalPlayers: events.players.length,
        handsPlayed,
        totalHands: events.totalHands,
        strategyVersion: player?.strategyVersion,
        replayAvailable: true,
      };
    });
}

function countHandsPlayed(agentId: string, replay: ReplayData): number | undefined {
  if (!Array.isArray(replay.hands) || replay.hands.length === 0) return undefined;
  const participated = replay.hands.filter((hand) =>
    Boolean(hand.holeCards?.[agentId])
      || hand.actions.some((action) => action.playerId === agentId),
  ).length;
  return participated > 0 ? participated : undefined;
}
