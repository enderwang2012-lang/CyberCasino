"use client";

import { useState, useEffect } from "react";
import type { TableSeat, AgentConfig, BuiltinPersonalityInfo } from "@cybercasino/shared";
import { SeatSelectPopup } from "./SeatSelectPopup";
import { useLanguage } from "@/contexts/LanguageContext";
import { useHeader } from "@/contexts/HeaderContext";

interface TableWaitingRoomProps {
  tableId: string;
  seats: TableSeat[];
  userId: string | null;
  agentConfig: AgentConfig | null;
  personalities: BuiltinPersonalityInfo[];
  onSitSelf: () => void;
  onSitBuiltin: (personalityId: string) => void;
  onRemoveSeat: (seatIndex: number) => void;
  onStart: () => void;
  onBack: () => void;
  onAgentSetup: () => void;
  error: string | null;
}

export function TableWaitingRoom({
  tableId,
  seats,
  userId,
  agentConfig,
  personalities,
  onSitSelf,
  onSitBuiltin,
  onRemoveSeat,
  onStart,
  onBack,
  onAgentSetup,
  error,
}: TableWaitingRoomProps) {
  const { t } = useLanguage();
  const { setVisible } = useHeader();
  useEffect(() => {
    setVisible(false);
    return () => setVisible(true);
  }, [setVisible]);
  const [showSelectPopup, setShowSelectPopup] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<{ seatIndex: number; name: string } | null>(null);

  const occupied = seats.filter((s) => s.status === "occupied").length;
  const total = seats.length;
  const isFull = occupied === total;

  const seatedPersonalityIds = seats
    .filter((s) => s.agent?.type === "builtin")
    .map((s) => s.agent!.id);

  const myAgentSeated = seats.some((s) => s.agent?.userId === userId);

  function handleSeatClick(seat: TableSeat) {
    if (seat.status === "empty") {
      setShowSelectPopup(true);
      return;
    }

    if (!seat.agent) return;

    if (seat.agent.type === "builtin") {
      setConfirmRemove({ seatIndex: seat.seatIndex, name: seat.agent.name });
    } else if (seat.agent.userId === userId) {
      setConfirmRemove({ seatIndex: seat.seatIndex, name: seat.agent.name });
    }
  }

  function handleSelectSelf() {
    setShowSelectPopup(false);
    onSitSelf();
  }

  function handleSelectBuiltin(personalityId: string) {
    setShowSelectPopup(false);
    onSitBuiltin(personalityId);
  }

  function handleConfirmRemove() {
    if (confirmRemove) {
      onRemoveSeat(confirmRemove.seatIndex);
      setConfirmRemove(null);
    }
  }

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center px-5 py-8 pt-[max(3rem,env(safe-area-inset-top))] bg-surface-elevated">
      <button onClick={onBack} className="absolute top-[max(1.5rem,env(safe-area-inset-top))] left-5 text-accent text-[15px] min-h-[44px] flex items-center">
        {t("common.back")}
      </button>

      <h2 className="text-[28px] font-semibold text-text-primary mb-1 tracking-tight">{t("tableWaiting.title")}</h2>
      <p className="text-text-secondary text-[15px] mb-8">{t("tableWaiting.seated", { occupied, total })}</p>

      <div className="grid grid-cols-3 gap-2.5 mb-8 w-full max-w-sm">
        {seats.map((seat) => (
          <button
            key={seat.seatIndex}
            onClick={() => handleSeatClick(seat)}
            className={`rounded-2xl p-4 text-center transition-colors ${
              seat.status === "occupied"
                ? "bg-white shadow-sm active:bg-white/70"
                : "bg-white/50 active:bg-white/30 border-2 border-dashed border-separator"
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
                  {seat.agent.type === "builtin" ? t("tableWaiting.ai") :
                   seat.agent.type === "smart" ? t("tableWaiting.proxy") : t("tableWaiting.custom")}
                </div>
              </>
            ) : (
              <>
                <div className="text-[28px] mb-1.5 opacity-20">+</div>
                <div className="text-text-tertiary text-[13px]">{t("tableWaiting.emptySeat")}</div>
              </>
            )}
          </button>
        ))}
      </div>

      <div className="w-full max-w-sm">
        <button
          onClick={onStart}
          disabled={!isFull}
          className={`w-full py-3 rounded-full font-medium text-[15px] transition-colors ${
            isFull
              ? "bg-accent hover:bg-accent-hover text-white"
              : "bg-surface-deep text-text-tertiary cursor-not-allowed"
          }`}
        >
          {t("tableWaiting.startGame")}
        </button>

        {error && (
          <p className="text-danger text-[13px] text-center mt-3">{error}</p>
        )}
      </div>

      {showSelectPopup && (
        <SeatSelectPopup
          agentConfig={agentConfig}
          myAgentSeated={myAgentSeated}
          personalities={personalities}
          seatedPersonalityIds={seatedPersonalityIds}
          onSelectSelf={handleSelectSelf}
          onSelectBuiltin={handleSelectBuiltin}
          onAgentSetup={() => { setShowSelectPopup(false); onAgentSetup(); }}
          onClose={() => setShowSelectPopup(false)}
        />
      )}

      {confirmRemove && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-5">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-lg">
            <p className="text-text-primary text-[17px] font-semibold mb-2">
              {t("tableWaiting.confirmRemove")}
            </p>
            <p className="text-text-secondary text-[15px] mb-6">
              {t("tableWaiting.removeConfirm", { name: confirmRemove.name })}
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={handleConfirmRemove}
                className="w-full bg-danger hover:bg-danger/90 text-white py-3 rounded-full font-medium text-[15px] transition-colors"
              >
                {t("tableWaiting.remove")}
              </button>
              <button
                onClick={() => setConfirmRemove(null)}
                className="w-full bg-surface-elevated hover:bg-surface-deep text-text-secondary py-3 rounded-full text-[15px] font-medium transition-colors"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
