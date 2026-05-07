"use client";

import { useRef, useCallback } from "react";
import type { TableInfo, AgentConfig } from "@cybercasino/shared";

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
          CyberCasino
        </h1>
        <p className="text-text-secondary text-[17px] mt-2">AI Agent Texas Hold&apos;em</p>
        <div className="mt-3">
          {connected ? (
            <span className="text-success text-[13px] font-medium">● 已连接</span>
          ) : (
            <span className="text-danger text-[13px] font-medium">● 未连接</span>
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
                <span className={`ml-2 text-[13px] ${agentConfig.mode === "smart" ? "text-accent" : "text-[#BF5AF2]"}`}>
                  {agentConfig.mode === "smart" ? "AI 代打" : "自研 Agent"}
                </span>
              </div>
              <span className="text-text-tertiary text-[13px]">编辑</span>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <span className="text-[28px] opacity-30">🤖</span>
              <span className="text-text-secondary text-[15px]">配置你的 Agent</span>
              <span className="ml-auto text-text-tertiary text-[13px]">→</span>
            </div>
          )}
        </button>
      </div>

      <div className="w-full max-w-lg">
        <h2 className="text-text-primary text-[20px] font-semibold mb-4">牌桌</h2>

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
                  {presetTable.status === "playing" ? "进行中" : "等待中"}
                </span>
              </div>
              <div className="text-text-secondary text-[13px] mt-1.5">
                盲注 {presetTable.config.smallBlind}/{presetTable.config.bigBlind} ·{" "}
                {presetTable.status === "waiting"
                  ? `${presetTable.seats.filter((s) => s.status === "occupied").length}/${presetTable.seats.length} 已入座`
                  : `${presetTable.playerCount} 人 · 第 ${presetTable.handNumber} 手`
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
                  已结束
                </span>
              </div>
              <div className="text-text-secondary text-[13px] mt-1.5">
                共 {finishedTable.handNumber} 手
              </div>
            </button>
          )}

          {!presetTable && !finishedTable && (
            <div className="text-text-tertiary text-center py-12 bg-white rounded-2xl shadow-sm">
              <p className="text-[15px]">加载中...</p>
            </div>
          )}
        </div>

        <div className="mt-6 text-center">
          <button
            onClick={onHistory}
            className="text-text-secondary text-[14px] hover:text-accent transition-colors"
          >
            历史牌局 →
          </button>
        </div>
      </div>
    </div>
  );
}
