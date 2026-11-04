"use client";

import { useEffect, useState } from "react";
import type {
  TableInfo,
  AgentConfigV2,
  RankedStanding,
  MatchmakingState,
  AgentArenaSummary,
} from "@cybercasino/shared";
import { useLanguage } from "@/contexts/LanguageContext";
import { AgentControlPanel } from "@/components/AgentControlPanel";
import { AgentMatchHistory } from "@/components/AgentMatchHistory";

interface LobbyProps {
  tables: TableInfo[];
  onJoin: (tableId: string) => void;
  onAgentSetup: () => void;
  onHistory: () => void;
  connected: boolean;
  agentV2?: AgentConfigV2 | null;
  matchmakingState?: MatchmakingState;
  matchmakingError?: string | null;
  onJoinMatchmaking: (agentId: string) => void;
  onLeaveMatchmaking: () => void;
  agentSummary?: AgentArenaSummary | null;
  agentSummaryLoading?: boolean;
  agentSummaryError?: boolean;
  onRefresh?: () => void;
  onOpenReplay?: (tableId: string) => void;
}

export function Lobby({
  tables,
  onJoin,
  onAgentSetup,
  onHistory,
  connected,
  agentV2,
  matchmakingState,
  matchmakingError,
  onJoinMatchmaking,
  onLeaveMatchmaking,
  agentSummary,
  agentSummaryLoading = false,
  agentSummaryError = false,
  onRefresh,
  onOpenReplay = onJoin,
}: LobbyProps) {
  const { t } = useLanguage();
  const [standings, setStandings] = useState<RankedStanding[]>([]);
  const [seasonBoard, setSeasonBoard] = useState<Array<{
    agentId: string;
    displayName: string;
    countedHands: number;
    equity: number;
    bbPer100: number | null;
  }>>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/leaderboard")
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) {
          setStandings(data.legacy ?? data.standings ?? []);
          const season = data.season;
          setSeasonBoard([...(season?.ranked ?? []), ...(season?.provisional ?? [])]);
        }
      })
      .catch(() => {
        if (!cancelled) setStandings([]);
      });
    return () => { cancelled = true; };
  }, [tables]);

  const queueState: MatchmakingState = matchmakingState ?? {
    queue: "ranked-default",
    status: "idle",
    queueSize: 0,
    requiredPlayers: 6,
    autoRequeue: false,
  };

  const consoleSummary = agentSummary === undefined
    ? { agent: agentV2 ?? null, currentMatch: queueState, recentMatches: [] }
    : agentSummary;

  return (
    <main className="min-h-[100dvh] tracking-normal flex flex-col items-center px-5 pt-[max(4rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] bg-surface-elevated">
      <header className="w-full max-w-3xl flex flex-wrap items-center justify-between gap-3 mb-8">
        <h1 className="text-[24px] font-semibold text-text-primary leading-tight">
          {t("lobby.title")}
        </h1>
        <div className="flex flex-wrap items-center gap-4">
          <span className={`text-[13px] font-medium ${connected ? "text-success" : "text-danger"}`}>
            {t(connected ? "common.connected" : "common.disconnected")}
          </span>
          {onRefresh && <button
            onClick={onRefresh}
            disabled={agentSummaryLoading}
            className="text-accent text-[13px] min-h-[44px] disabled:opacity-50"
          >
            {t("agentConsole.refresh")}
          </button>}
        </div>
      </header>
      {agentSummaryError && (
        <p role="alert" className="w-full max-w-3xl text-danger text-[13px] mb-4">
          {t("agentConsole.summaryError")}
        </p>
      )}
      <AgentControlPanel
        summary={consoleSummary}
        loading={agentSummaryLoading}
        connected={connected}
        onAgentSetup={onAgentSetup}
        onJoinMatchmaking={onJoinMatchmaking}
        onLeaveMatchmaking={onLeaveMatchmaking}
        onOpenTable={onJoin}
      />
      {matchmakingError && (
        <p role="alert" className="w-full max-w-3xl text-danger text-[13px] mt-3">{matchmakingError}</p>
      )}

      {agentSummary?.agent && (
        <AgentMatchHistory
          matches={agentSummary.recentMatches}
          onOpenReplay={onOpenReplay}
        />
      )}

      <div className="w-full max-w-3xl mt-10">
        <h2 className="text-text-primary text-[20px] font-semibold mb-4">{t("agentConsole.publicArena")}</h2>

        <div className="space-y-2">
          {tables.map((table) => {
            const exhibition = table.spectator === true || table.config.mode === "exhibition";
            const cash = table.config.mode === "cash" && !exhibition;
            return (
              <button
                key={table.id}
                onClick={() => onJoin(table.id)}
                className="w-full text-left bg-white hover:bg-white/80 rounded-2xl p-4 transition-colors shadow-sm"
              >
                <div className="flex flex-wrap justify-between items-center gap-2">
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <span className="text-text-primary text-[15px] font-medium break-all">{table.name}</span>
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                      exhibition ? "bg-surface-elevated text-text-secondary" : "bg-[#BF5AF2]/10 text-[#BF5AF2]"
                    }`}>
                      {t(exhibition ? "lobby.exhibition" : cash ? "lobby.cash" : "lobby.ranked")}
                    </span>
                  </div>
                  <span className={`text-[12px] font-medium px-2 py-0.5 rounded-full ${
                    table.status === "playing" ? "bg-success/15 text-success" : "bg-surface-elevated text-text-secondary"
                  }`}>
                    {t(table.status === "playing" ? "lobby.playing" : table.status === "finished" ? "common.finished" : "lobby.waiting")}
                  </span>
                </div>
                <div className="text-text-secondary text-[13px] mt-1.5">
                  {t("lobby.blinds")} {table.config.smallBlind}/{table.config.bigBlind} ·{" "}
                  {table.status === "waiting"
                    ? `${table.seats.filter((s) => s.status === "occupied").length}/${table.seats.length} ${t("lobby.seated")}`
                    : `${table.playerCount} ${t("lobby.players")} · ${t("lobby.hand", { number: table.handNumber })}`
                  }
                </div>
                <div className="text-text-tertiary text-[12px] mt-1">
                  {t(exhibition ? "lobby.exhibitionHint" : cash ? "lobby.cashHint" : "lobby.rankedHint")}
                </div>
              </button>
            );
          })}

          {tables.length === 0 && (
            <div className="text-text-secondary py-6 border-y border-separator">
              <p className="text-[15px]">{t("agentConsole.noTables")}</p>
            </div>
          )}
        </div>

        <div className="mt-6 text-center">
          <button
            onClick={onHistory}
            className="text-text-secondary text-[14px] hover:text-accent transition-colors"
          >
            {t("lobby.history")}
          </button>
        </div>

        <div className="mt-8">
          <h2 className="text-text-primary text-[20px] font-semibold mb-4">{t("lobby.longTermLeaderboard")}</h2>
          {seasonBoard.length > 0 && (
            <div className="space-y-2 mb-4">
              {seasonBoard.slice(0, 10).map((row) => (
                <div key={row.agentId} className="bg-white rounded-2xl px-4 py-3 flex items-center gap-3 shadow-sm">
                  <div className="flex-1 min-w-0">
                    <div className="text-text-primary text-[14px] font-medium truncate">{row.displayName}</div>
                    <div className="text-text-secondary text-[12px]">{row.countedHands} 手 · 权益 {row.equity}</div>
                  </div>
                  <span className="text-[#BF5AF2] font-semibold text-[14px]">
                    {row.bbPer100 == null ? "未满 500 手" : `${row.bbPer100.toFixed(1)} bb/100`}
                  </span>
                </div>
              ))}
            </div>
          )}
          {standings.length === 0 && seasonBoard.length === 0 ? (
            <div className="border-y border-separator py-6 text-text-secondary text-[14px]">
              {t("lobby.noRankedResults")}
            </div>
          ) : (
            <div className="space-y-2">
              {standings.slice(0, 10).map((standing, index) => (
                <div key={standing.agentId} className="bg-white rounded-2xl px-4 py-3 flex items-center gap-3 shadow-sm">
                  <span className="w-6 text-center text-text-secondary text-[13px]">
                    {standing.provisional ? "--" : index + 1}
                  </span>
                  <span className="text-[22px]">{standing.avatar}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-text-primary text-[14px] font-medium truncate">{standing.name}</div>
                    <div className="text-text-secondary text-[12px]">
                      {t("lobby.rankRecord", { games: standing.gamesPlayed, wins: standing.wins })}
                      {standing.provisional ? ` · ${t("lobby.provisionalRank", { games: standing.ratedGames ?? 0 })}` : ""}
                      {standing.activeStrategyVersion ? ` · v${standing.activeStrategyVersion}` : ""}
                    </div>
                  </div>
                  <span className="text-[#BF5AF2] font-semibold text-[14px]">{standing.rating}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
