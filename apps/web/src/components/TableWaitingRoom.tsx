"use client";

import { useState } from "react";
import type { TableSeat, AgentConfig } from "@cybercasino/shared";

interface TableWaitingRoomProps {
  tableId: string;
  seats: TableSeat[];
  userId: string | null;
  agentConfig: AgentConfig | null;
  isCreator: boolean;
  onSit: (tableId: string) => void;
  onLeaveSeat: (tableId: string) => void;
  onFillAI: (tableId: string) => void;
  onStart: (tableId: string) => void;
  onBack: () => void;
  error: string | null;
}

export function TableWaitingRoom({
  tableId,
  seats,
  userId,
  agentConfig,
  isCreator,
  onSit,
  onLeaveSeat,
  onFillAI,
  onStart,
  onBack,
  error,
}: TableWaitingRoomProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const myAgent = seats.find((s) => s.agent?.userId === userId);
  const isSeated = !!myAgent;
  const occupied = seats.filter((s) => s.status === "occupied").length;
  const total = seats.length;

  function handleStart() {
    if (occupied < total) {
      setShowConfirm(true);
    } else {
      onStart(tableId);
    }
  }

  function handleConfirmFillAndStart() {
    setShowConfirm(false);
    onFillAI(tableId);
    setTimeout(() => onStart(tableId), 300);
  }

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center px-5 py-8 pt-[max(3rem,env(safe-area-inset-top))] bg-surface-elevated">
      <button onClick={onBack} className="absolute top-[max(1.5rem,env(safe-area-inset-top))] left-5 text-accent text-[15px] min-h-[44px] flex items-center">
        ‹ 返回
      </button>

      <h2 className="text-[28px] font-semibold text-text-primary mb-1 tracking-tight">等待室</h2>
      <p className="text-text-secondary text-[15px] mb-8">{occupied}/{total} 已入座</p>

      <div className="grid grid-cols-3 gap-2.5 mb-8 w-full max-w-sm">
        {seats.map((seat) => (
          <div
            key={seat.seatIndex}
            className={`rounded-2xl p-4 text-center ${
              seat.status === "occupied"
                ? "bg-white shadow-sm"
                : "bg-white/50"
            }`}
          >
            {seat.agent ? (
              <>
                <div className="text-[28px] mb-1.5">{seat.agent.avatar}</div>
                <div className="text-text-primary text-[13px] font-medium truncate">{seat.agent.name}</div>
                <div className={`text-[11px] mt-0.5 font-medium ${
                  seat.agent.type === "builtin" ? "text-text-tertiary" :
                  seat.agent.type === "smart" ? "text-accent" : "text-[#BF5AF2]"
                }`}>
                  {seat.agent.type === "builtin" ? "AI" :
                   seat.agent.type === "smart" ? "代打" : "自研"}
                </div>
              </>
            ) : (
              <>
                <div className="text-[28px] mb-1.5 opacity-20">💺</div>
                <div className="text-text-tertiary text-[13px]">空位</div>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3 w-full max-w-sm">
        {!isSeated && agentConfig && (
          <button
            onClick={() => onSit(tableId)}
            className="w-full bg-accent hover:bg-accent-hover text-white py-3 rounded-full font-medium text-[15px] transition-colors"
          >
            加入 ({agentConfig.avatar} {agentConfig.name})
          </button>
        )}

        {!isSeated && !agentConfig && (
          <p className="text-text-tertiary text-[15px] text-center">请先配置你的 Agent</p>
        )}

        {isSeated && (
          <button
            onClick={() => onLeaveSeat(tableId)}
            className="w-full bg-surface-elevated hover:bg-surface-deep text-text-secondary py-3 rounded-full text-[15px] font-medium transition-colors"
          >
            离开座位
          </button>
        )}

        {isCreator && (
          <button
            onClick={handleStart}
            disabled={occupied < 1}
            className="w-full bg-success hover:bg-success/90 disabled:bg-surface-elevated disabled:text-text-tertiary text-white py-3 rounded-full font-medium text-[15px] transition-colors"
          >
            开始游戏
          </button>
        )}

        {error && (
          <p className="text-danger text-[13px] text-center">{error}</p>
        )}
      </div>

      {showConfirm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-5">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-lg">
            <p className="text-text-primary text-[17px] font-semibold mb-2">
              还有 {total - occupied} 个空位
            </p>
            <p className="text-text-secondary text-[15px] mb-6">
              空位将由内置 AI 对手补齐，补位后立即开始对局
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={handleConfirmFillAndStart}
                className="w-full bg-accent hover:bg-accent-hover text-white py-3 rounded-full font-medium text-[15px] transition-colors"
              >
                补齐并开始
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                className="w-full bg-surface-elevated hover:bg-surface-deep text-text-secondary py-3 rounded-full text-[15px] font-medium transition-colors"
              >
                再等等
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
