"use client";

import type { AgentMatchSummary } from "@cybercasino/shared";
import { useLanguage } from "@/contexts/LanguageContext";

interface AgentMatchHistoryProps {
  matches: AgentMatchSummary[];
  onOpenReplay: (tableId: string) => void;
}

export function AgentMatchHistory({ matches, onOpenReplay }: AgentMatchHistoryProps) {
  const { t, language } = useLanguage();

  return (
    <section className="w-full max-w-3xl mt-8 tracking-normal" aria-labelledby="agent-history-title">
      <div className="flex items-center justify-between mb-4">
        <h2 id="agent-history-title" className="text-text-primary text-[20px] font-semibold">
          {t("agentConsole.recentMatches")}
        </h2>
        <span className="text-text-tertiary text-[13px]">{matches.length}</span>
      </div>
      {matches.length === 0 ? (
        <div className="border-y border-separator py-6 text-text-secondary text-[14px]">
          {t("agentConsole.noRecentMatches")}
        </div>
      ) : (
        <div className="space-y-2">
          {matches.map((match) => (
            <div key={match.tableId} className="bg-white rounded-2xl p-4 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h3 className="text-text-primary text-[15px] font-medium break-all">{match.tableName}</h3>
                    <span className="text-text-secondary text-[13px]">
                      {match.format === "cash"
                        ? t("agentConsole.cashResult", {
                          chips: `${(match.netChips ?? 0) > 0 ? "+" : ""}${match.netChips ?? 0}`,
                          hands: match.handsPlayed,
                        })
                        : t("agentConsole.place", { position: match.position })}
                    </span>
                  </div>
                  {match.format !== "cash" && (
                    <p className="text-text-secondary text-[13px] mt-1">
                      {t("agentConsole.matchStats", {
                        players: match.totalPlayers,
                        hands: match.handsPlayed,
                        totalHands: match.totalHands,
                      })}
                    </p>
                  )}
                  <div className="text-text-secondary text-[12px] mt-1 flex flex-wrap gap-x-3">
                    <span>{match.finishedAt != null ? formatTime(match.finishedAt, language) : t("agentConsole.finishedTimeUnknown")}</span>
                    {match.strategyVersion != null && <span>{t("agentConsole.matchVersion", { version: match.strategyVersion })}</span>}
                  </div>
                </div>
                {match.replayAvailable ? (
                  <div className="shrink-0 flex flex-wrap sm:flex-col gap-x-4">
                    <button
                    onClick={() => onOpenReplay(match.tableId)}
                    className="shrink-0 text-accent text-[13px] font-medium min-h-[44px] px-2"
                  >
                    {t("agentConsole.openReplay")}
                    </button>
                    <a
                      href={`/api/replay/${encodeURIComponent(match.tableId)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent text-[12px] min-h-[44px] flex items-center px-2"
                    >
                      {t("agentConsole.replayData")}
                    </a>
                  </div>
                ) : <span className="text-text-secondary text-[13px]">{t("agentConsole.replayUnavailable")}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function formatTime(timestamp: number, language: string) {
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}
