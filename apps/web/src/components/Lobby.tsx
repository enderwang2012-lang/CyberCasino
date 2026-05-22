"use client";

import { useRef, useCallback } from "react";
import type { TableInfo, AgentConfig } from "@cybercasino/shared";
import { useLanguage } from "@/contexts/LanguageContext";

interface LobbyProps {
  tables: TableInfo[];
  onJoin: (tableId: string) => void;
  onAgentSetup: () => void;
  onHistory: () => void;
  onClearSeats: (tableId: string) => void;
  connected: boolean;
  agentConfig: AgentConfig | null;
}

export function Lobby({ tables, onJoin, onAgentSetup, onHistory, onClearSeats, connected, agentConfig }: LobbyProps) {
  const { t } = useLanguage();
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const presetTable = tables.find((t) => t.status === "waiting" || t.status === "playing");
  const finishedTable = tables.find((t) => t.status === "finished");

  const handleTouchStart = useCallback((tableId: string, status: string) => {
    if (status !== "waiting") return;
    longPressTimer.current = setTimeout(() => {
      onClearSeats(tableId);
      longPressTimer.current = null;
    }, 30000);
  }, [onClearSeats]);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  return (
    <div className="min-h-[100dvh] flex flex-col items-center px-5 pt-[max(4rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] bg-surface-elevated">
      <div className="text-center mb-12">
        <h1 className="text-[40px] font-semibold text-text-primary tracking-tight leading-tight">
          {t("lobby.title")}
        </h1>
        <p className="text-text-secondary text-[17px] mt-2">{t("lobby.subtitle")}</p>
        <div className="mt-3">
          {connected ? (
            <span className="text-success text-[13px] font-medium">{t("common.connected")}</span>
          ) : (
            <span className="text-danger text-[13px] font-medium">{t("common.disconnected")}</span>
          )}
        </div>
      </div>

      <div className="w-full max-w-lg mb-8">
        <button
          onClick={onAgentSetup}
          className="w-full text-left bg-white hover:bg-white/80 rounded-2xl p-4 transition-colors shadow-sm"
        >
          {agentConfig ? (
            <div className="flex items-center gap-4">
              <span className="text-[28px]">{agentConfig.avatar}</span>
              <div className="flex-1">
                <span className="text-text-primary text-[15px] font-medium">{agentConfig.name}</span>
                <span className="ml-2 text-[13px] text-[#BF5AF2]">
                  {t("lobby.customAgent")}
                </span>
              </div>
              <span className="text-text-tertiary text-[13px]">{t("lobby.edit")}</span>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <span className="text-[28px] opacity-30">🤖</span>
              <span className="text-text-secondary text-[15px]">{t("lobby.agentConfig")}</span>
              <span className="ml-auto text-text-tertiary text-[13px]">→</span>
            </div>
          )}
        </button>
      </div>

      <div className="w-full max-w-lg">
        <h2 className="text-text-primary text-[20px] font-semibold mb-4">{t("lobby.tables")}</h2>

        <div className="space-y-2">
          {presetTable && (
            <button
              onClick={() => onJoin(presetTable.id)}
              onTouchStart={() => handleTouchStart(presetTable.id, presetTable.status)}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
              onMouseDown={() => handleTouchStart(presetTable.id, presetTable.status)}
              onMouseUp={handleTouchEnd}
              onMouseLeave={handleTouchEnd}
              className="w-full text-left bg-white hover:bg-white/80 rounded-2xl p-4 transition-colors shadow-sm"
            >
              <div className="flex justify-between items-center">
                <span className="text-text-primary text-[15px] font-medium">{presetTable.name}</span>
                <span className={`text-[12px] font-medium px-2 py-0.5 rounded-full ${
                  presetTable.status === "playing" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"
                }`}>
                  {presetTable.status === "playing" ? t("lobby.playing") : t("lobby.waiting")}
                </span>
              </div>
              <div className="text-text-secondary text-[13px] mt-1.5">
                {t("lobby.blinds")} {presetTable.config.smallBlind}/{presetTable.config.bigBlind} ·{" "}
                {presetTable.status === "waiting"
                  ? `${presetTable.seats.filter((s) => s.status === "occupied").length}/${presetTable.seats.length} ${t("lobby.seated")}`
                  : `${presetTable.playerCount} ${t("lobby.players")} · ${t("lobby.hand", { number: presetTable.handNumber })}`
                }
              </div>
            </button>
          )}

          {finishedTable && (
            <button
              onClick={() => onJoin(finishedTable.id)}
              className="w-full text-left bg-white hover:bg-white/80 rounded-2xl p-4 transition-colors shadow-sm"
            >
              <div className="flex justify-between items-center">
                <span className="text-text-primary text-[15px] font-medium">{finishedTable.name}</span>
                <span className="text-[12px] font-medium px-2 py-0.5 rounded-full bg-surface-elevated text-text-tertiary">
                  {t("common.finished")}
                </span>
              </div>
              <div className="text-text-secondary text-[13px] mt-1.5">
                {t("chatFeed.totalHands", { count: finishedTable.handNumber })}
              </div>
            </button>
          )}

          {!presetTable && !finishedTable && (
            <div className="text-text-tertiary text-center py-12 bg-white rounded-2xl shadow-sm">
              <p className="text-[15px]">{t("common.loading")}</p>
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
      </div>
    </div>
  );
}
