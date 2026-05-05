"use client";

import type { TableInfo, AgentConfig } from "@cybercasino/shared";

interface LobbyProps {
  tables: TableInfo[];
  onJoin: (tableId: string) => void;
  onCreate: () => void;
  onAgentSetup: () => void;
  connected: boolean;
  agentConfig: AgentConfig | null;
  hasActiveTable: boolean;
}

export function Lobby({ tables, onJoin, onCreate, onAgentSetup, connected, agentConfig, hasActiveTable }: LobbyProps) {
  return (
    <div className="min-h-[100dvh] flex flex-col items-center px-5 pt-[max(4rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] bg-surface-elevated">
      <div className="text-center mb-12">
        <h1 className="text-[40px] font-semibold text-text-primary tracking-tight leading-tight">
          CyberCasino
        </h1>
        <p className="text-text-secondary text-[17px] mt-2">AI Agent Texas Hold'em</p>
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
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-text-primary text-[20px] font-semibold">牌桌</h2>
          <button
            onClick={onCreate}
            disabled={hasActiveTable}
            className="bg-accent hover:bg-accent-hover text-white px-5 py-2 rounded-full text-[15px] font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            创建牌桌
          </button>
        </div>

        {tables.length === 0 ? (
          <div className="text-text-tertiary text-center py-12 bg-white rounded-2xl shadow-sm">
            <p className="text-[15px]">暂无牌桌</p>
            <p className="text-[13px] text-text-tertiary mt-1">创建一个开始对局</p>
          </div>
        ) : (
          <div className="space-y-2">
            {tables.map((table) => (
              <button
                key={table.id}
                onClick={() => onJoin(table.id)}
                className="w-full text-left bg-white hover:bg-white/80 rounded-2xl p-4 transition-colors shadow-sm"
              >
                <div className="flex justify-between items-center">
                  <span className="text-text-primary text-[15px] font-medium">{table.name}</span>
                  <span className={`text-[12px] font-medium px-2 py-0.5 rounded-full ${
                    table.status === "playing" ? "bg-success/15 text-success" :
                    table.status === "waiting" ? "bg-warning/15 text-warning" : "bg-surface-elevated text-text-tertiary"
                  }`}>
                    {table.status === "playing" ? "进行中" : table.status === "waiting" ? "等待中" : table.status.toUpperCase()}
                  </span>
                </div>
                <div className="text-text-secondary text-[13px] mt-1.5">
                  盲注 {table.config.smallBlind}/{table.config.bigBlind} ·{" "}
                  {table.status === "waiting"
                    ? `${table.seats.filter((s) => s.status === "occupied").length}/${table.seats.length} 已入座`
                    : `${table.playerCount} 人`
                  }
                  {table.status !== "waiting" && ` · 第 ${table.handNumber} 手`}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
