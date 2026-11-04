"use client";

import type { AgentArenaSummary, MatchmakingState } from "@cybercasino/shared";
import { useLanguage } from "@/contexts/LanguageContext";

interface AgentControlPanelProps {
  summary: AgentArenaSummary | null;
  loading: boolean;
  connected: boolean;
  onAgentSetup: () => void;
  onJoinMatchmaking: (agentId: string) => void;
  onLeaveMatchmaking: () => void;
  onOpenTable: (tableId: string) => void;
}

export function AgentControlPanel({
  summary,
  loading,
  connected,
  onAgentSetup,
  onJoinMatchmaking,
  onLeaveMatchmaking,
  onOpenTable,
}: AgentControlPanelProps) {
  const { t } = useLanguage();
  const agent = summary?.agent;
  const currentMatch = summary?.currentMatch ?? idleMatch();
  const currentStrategyVersion = agent?.strategyVersion ?? agent?.strategyPackage?.manifest.version;
  const pendingStrategyVersion = agent?.pendingStrategyVersion;
  const mode = agent?.executionMode === "remote_agent"
    ? t("agentConsole.executionRemote")
    : agent?.executionMode === "verified_package"
      ? t("agentConsole.executionVerified")
      : t("agentConsole.executionUnknown");
  const inMatch = currentMatch.status === "matched" || currentMatch.status === "playing";

  return (
    <section className="w-full max-w-3xl tracking-normal" aria-labelledby="agent-console-title" aria-busy={loading}>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 id="agent-console-title" className="text-text-primary text-[28px] font-semibold leading-tight">
            {t("agentConsole.title")}
          </h2>
        </div>
        {loading && <span className="text-text-tertiary text-[13px]">{t("common.loading")}</span>}
      </div>

      {!summary ? (
        <p className="text-text-secondary py-6 text-[14px]">
          {t(loading ? "common.loading" : "agentConsole.summaryUnavailable")}
        </p>
      ) : !agent ? (
        <div className="border-y border-separator py-5">
          <div className="flex items-start gap-4">
            <span className="text-[36px] opacity-35" aria-hidden="true">🤖</span>
            <div className="flex-1 min-w-0">
              <h3 className="text-text-primary text-[18px] font-semibold">{t("agentConsole.noAgentTitle")}</h3>
              <p className="text-text-secondary text-[14px] mt-1">{t("agentConsole.noAgentDescription")}</p>
            </div>
          </div>
          <button
            onClick={onAgentSetup}
            className="w-full mt-5 bg-accent hover:bg-accent-hover text-white py-3 rounded-full font-medium text-[15px] transition-colors"
          >
            {t("agentConsole.createAgent")}
          </button>
        </div>
      ) : (
        <div className="border-y border-separator py-5">
          <div className="flex flex-wrap items-start gap-4">
            <span className="text-[40px]" aria-hidden="true">{agent.avatar}</span>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h3 className="text-text-primary text-[20px] font-semibold break-all">{agent.name}</h3>
                <span className="text-[12px] font-medium px-2 py-0.5 rounded-full bg-[#BF5AF2]/10 text-[#BF5AF2]">
                  {mode}
                </span>
              </div>
              <p className="text-text-tertiary text-[12px] mt-1 break-all">{t("agentConsole.identity")}: {agent.id}</p>
              <div className="text-text-secondary text-[13px] mt-2 flex flex-wrap gap-x-3 gap-y-1">
                <span>{currentStrategyVersion != null
                  ? t("agentConsole.currentVersion", { version: currentStrategyVersion })
                  : t("agentConsole.versionUnknown")}</span>
                {pendingStrategyVersion != null && <span className="text-warning">{t("agentConsole.pendingVersion", { version: pendingStrategyVersion })}</span>}
              </div>
              {agent.executionMode === "remote_agent" && (
                <p className="text-text-secondary text-[12px] mt-2">
                  {t(summary.externalAgentConnected === true ? "agentConsole.externalOnline"
                    : summary.externalAgentConnected === false ? "agentConsole.externalOffline" : "agentConsole.externalUnknown")}
                </p>
              )}
            </div>
            <button
              onClick={onAgentSetup}
              className="shrink-0 text-accent text-[13px] font-medium min-h-[44px]"
            >
              {t("agentConsole.edit")}
            </button>
          </div>

          <div className="text-text-secondary text-[13px] mt-4 space-y-1">
            <p>{t("agentConsole.packageUpdateHint")}</p>
            <p>{t("agentConsole.styleUpdateHint")}</p>
          </div>

          <div className="border-t border-separator mt-5 pt-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-text-tertiary text-[12px] font-medium">
                  {t("agentConsole.matchStatus")}
                </p>
                <p className={`text-[16px] font-semibold mt-1 ${statusColor(currentMatch.status)}`}>
                  {statusLabel(currentMatch.status, t)}
                </p>
              </div>
              {!connected && (
                <span className="text-danger text-[12px] font-medium">{t("common.disconnected")}</span>
              )}
            </div>

            {currentMatch.status === "queued" && (
              <p className="text-text-secondary text-[13px] mt-2">
                {t("agentConsole.queuePosition")}
              </p>
            )}
            {inMatch && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-2">
                {currentMatch.tableId && <p className="text-text-secondary text-[13px] break-all">
                  {t("agentConsole.table", { tableId: currentMatch.tableId })}
                </p>}
                {summary.currentMatchStrategyVersion != null && (
                  <span className="text-[#BF5AF2] text-[13px] font-medium">
                    {t("agentConsole.frozenVersion", { version: summary.currentMatchStrategyVersion })}
                  </span>
                )}
              </div>
            )}

            {inMatch && (
              <p className="text-text-secondary text-[13px] mt-2">
                {t(currentMatch.autoRequeue ? "agentConsole.autoRequeue" : "agentConsole.requeueStopped")}
              </p>
            )}
            {currentMatch.seasonHands != null && (
              <p className="text-text-secondary text-[13px] mt-2">
                {t("agentConsole.seasonLine", {
                  equity: currentMatch.seasonEquity ?? 0,
                  hands: currentMatch.seasonHands,
                  rate: currentMatch.seasonBbPer100 == null
                    ? t("agentConsole.seasonProvisional")
                    : currentMatch.seasonBbPer100.toFixed(1),
                })}
              </p>
            )}

            <div className="flex flex-col sm:flex-row gap-2 mt-4">
              {currentMatch.status === "idle" && (
                <button
                  onClick={() => onJoinMatchmaking(agent.id)}
                  disabled={!connected}
                  className="flex-1 bg-accent hover:bg-accent-hover disabled:bg-surface-deep disabled:text-text-tertiary text-white py-3 rounded-full font-medium text-[15px] transition-colors"
                >
                  {t("lobby.joinMatch")}
                </button>
              )}
              {currentMatch.status === "queued" && (
                <button
                  onClick={onLeaveMatchmaking}
                  disabled={!connected}
                  className="flex-1 border border-danger/30 text-danger hover:bg-danger/10 disabled:opacity-50 py-3 rounded-full font-medium text-[15px] transition-colors"
                >
                  {t("lobby.leaveMatch")}
                </button>
              )}
              {inMatch && (
                <>
                  {currentMatch.tableId && <button
                    onClick={() => onOpenTable(currentMatch.tableId!)}
                    disabled={!connected}
                    className="flex-1 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white py-3 rounded-full font-medium text-[15px] transition-colors"
                  >
                    {t("lobby.openTable")}
                  </button>}
                  <button
                    onClick={onLeaveMatchmaking}
                    disabled={!connected}
                    aria-describedby="stop-match-description"
                    className="flex-1 border border-danger/30 text-danger hover:bg-danger/10 disabled:opacity-50 py-3 rounded-full font-medium text-[15px] transition-colors"
                  >
                    {t("agentConsole.stopAfterCurrent")}
                  </button>
                </>
              )}
            </div>
            {inMatch && (
              <p id="stop-match-description" className="text-text-secondary text-[12px] mt-2">
                {t("agentConsole.stopAfterCurrentDescription")}
              </p>
            )}
          </div>

          {currentMatch.seasonHands != null ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 border-t border-separator mt-5 pt-4">
              <Stat label={t("agentConsole.seasonEquity")} value={currentMatch.seasonEquity ?? 0} />
              <Stat label={t("agentConsole.seasonHandsLabel")} value={currentMatch.seasonHands} />
              <Stat label="bb/100" value={currentMatch.seasonBbPer100 == null ? t("agentConsole.seasonProvisional") : currentMatch.seasonBbPer100.toFixed(1)} />
            </div>
          ) : summary?.standing && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 border-t border-separator mt-5 pt-4">
              <Stat label={t("agentConsole.rating")} value={summary.standing.rating} />
              <Stat label={t("agentConsole.games")} value={summary.standing.gamesPlayed} />
              <Stat label={t("agentConsole.wins")} value={summary.standing.wins} />
              <Stat label={t("agentConsole.averagePosition")} value={summary.standing.averageFinish.toFixed(1)} />
            </div>
          )}
          {currentMatch.seasonHands == null && !summary.standing && <p className="text-text-secondary text-[13px] mt-5">{t("lobby.noRankedResults")}</p>}
          {summary.standing?.provisional && (
            <p className="text-text-secondary text-[12px] mt-2">
              {t("lobby.provisionalRank", { games: summary.standing.ratedGames ?? 0 })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="py-2.5">
      <p className="text-text-tertiary text-[11px]">{label}</p>
      <p className="text-text-primary text-[16px] font-semibold mt-1">{value}</p>
    </div>
  );
}

function idleMatch(): MatchmakingState {
  return {
    queue: "ranked-default",
    status: "idle",
    queueSize: 0,
    requiredPlayers: 6,
    autoRequeue: false,
  };
}

function statusLabel(status: MatchmakingState["status"], t: (key: string, params?: Record<string, string | number>) => string) {
  return t(`agentConsole.status.${status}`);
}

function statusColor(status: MatchmakingState["status"]) {
  if (status === "playing") return "text-success";
  if (status === "queued" || status === "matched") return "text-warning";
  return "text-text-primary";
}
