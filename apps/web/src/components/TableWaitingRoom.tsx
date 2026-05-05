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
    <div className="min-h-[100dvh] flex flex-col items-center justify-center px-5 py-8 pt-[max(2rem,env(safe-area-inset-top))]">
      <button onClick={onBack} className="absolute top-[max(1.5rem,env(safe-area-inset-top))] left-5 text-gray-500 hover:text-gray-300 text-sm min-h-[44px] flex items-center">
        ← 返回大厅
      </button>

      <h2 className="text-2xl font-bold text-cyan-400 mb-1">等待室</h2>
      <p className="text-gray-500 text-sm mb-8">{occupied}/{total} 已入座</p>

      {/* Seat grid */}
      <div className="grid grid-cols-3 gap-3 mb-8 w-full max-w-sm">
        {seats.map((seat) => (
          <div
            key={seat.seatIndex}
            className={`rounded-lg p-4 text-center border ${
              seat.status === "occupied"
                ? "bg-gray-800/50 border-gray-600/50"
                : "bg-gray-900/30 border-gray-800/30 border-dashed"
            }`}
          >
            {seat.agent ? (
              <>
                <div className="text-2xl mb-1">{seat.agent.avatar}</div>
                <div className="text-gray-300 text-xs font-medium truncate">{seat.agent.name}</div>
                <div className={`text-xs mt-0.5 ${
                  seat.agent.type === "builtin" ? "text-gray-600" :
                  seat.agent.type === "smart" ? "text-cyan-600" : "text-fuchsia-600"
                }`}>
                  {seat.agent.type === "builtin" ? "AI" :
                   seat.agent.type === "smart" ? "代打" : "自研"}
                </div>
              </>
            ) : (
              <>
                <div className="text-2xl mb-1 opacity-20">💺</div>
                <div className="text-gray-700 text-xs">空位</div>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2 w-full max-w-sm">
        {!isSeated && agentConfig && (
          <button
            onClick={() => onSit(tableId)}
            className="w-full bg-cyan-600 hover:bg-cyan-500 text-white py-2.5 rounded font-medium text-sm"
          >
            加入 ({agentConfig.avatar} {agentConfig.name})
          </button>
        )}

        {!isSeated && !agentConfig && (
          <p className="text-gray-600 text-sm text-center">请先配置你的 Agent</p>
        )}

        {isSeated && (
          <button
            onClick={() => onLeaveSeat(tableId)}
            className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 rounded text-sm"
          >
            离开座位
          </button>
        )}

        {isCreator && (
          <button
            onClick={handleStart}
            disabled={occupied < 1}
            className="w-full bg-green-600 hover:bg-green-500 disabled:bg-gray-800 disabled:text-gray-600 text-white py-2.5 rounded font-medium text-sm"
          >
            开始游戏
          </button>
        )}

        {error && (
          <p className="text-red-500 text-xs text-center">{error}</p>
        )}
      </div>

      {/* Fill AI confirmation */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 max-w-sm">
            <p className="text-gray-200 text-sm mb-2">
              当前还有 {total - occupied} 个空位
            </p>
            <p className="text-gray-400 text-xs mb-4">
              空位将由内置 AI 对手补齐，补位后立即开始对局
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleConfirmFillAndStart}
                className="flex-1 bg-green-600 hover:bg-green-500 text-white py-2 rounded text-sm"
              >
                补齐并开始
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 rounded text-sm"
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
