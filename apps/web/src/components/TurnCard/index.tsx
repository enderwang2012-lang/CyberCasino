"use client";

import type { SeatState } from "../PixelTable/logic/types";
import { Typewriter } from "./Typewriter";
import { useLanguage } from "@/contexts/LanguageContext";

interface TurnCardProps {
  seat: SeatState | null;
  handIndex: number;
  totalHands: number;
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
}

function actionLabel(seat: SeatState): { text: string; color: string } | null {
  const d = seat.lastDecision;
  if (!d) return null;
  if (d.action === "fold") return { text: "FOLD", color: "text-text-secondary" };
  if (d.action === "check") return { text: "CHECK", color: "text-text-primary" };
  if (d.action === "call") return { text: `CALL $${d.amount?.toLocaleString() ?? 0}`, color: "text-blue-600" };
  return { text: `RAISE $${d.amount?.toLocaleString() ?? 0}`, color: "text-amber-700" };
}

export function TurnCard({ seat, handIndex, totalHands, onPrev, onNext, canPrev, canNext }: TurnCardProps) {
  const { t } = useLanguage();

  return (
    <div className="absolute left-0 right-0 bottom-3 px-2 flex items-center gap-1.5">
      {/* 左箭头 */}
      <button
        onClick={onPrev}
        disabled={!canPrev}
        className={`w-7 h-[88px] rounded-lg flex items-center justify-center text-lg flex-shrink-0 ${
          canPrev ? "bg-white/85 text-text-secondary" : "bg-white/55 text-text-tertiary cursor-not-allowed"
        }`}
      >
        ‹
      </button>

      {/* 卡片主体 */}
      <div className="flex-1 bg-white/95 backdrop-blur-md rounded-2xl px-3 py-2.5 shadow-lg border border-black/5 min-w-0">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[10px] text-text-secondary font-mono">
            #{seat?.lastDecision?.handNumber ?? "—"}
          </span>
          {handIndex === 0 ? (
            <span className="text-[9px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded border border-amber-200">
              ⬤ {t("turnCard.current")}
            </span>
          ) : (
            <span className="text-[9px] bg-gray-100 text-text-secondary px-1.5 py-0.5 rounded">
              {t("turnCard.history")}
            </span>
          )}
          <span className="ml-auto text-[9px] text-text-secondary font-mono">
            {handIndex + 1} / {Math.max(1, totalHands)}
          </span>
        </div>

        {seat ? (
          <div className="flex items-start gap-2">
            <div className="w-8 h-8 rounded-full bg-amber-100 border-2 border-amber-300 flex-shrink-0 flex items-center justify-center text-sm">
              {seat.avatar || "🤖"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold mb-0.5">
                {seat.name}
                {seat.status === "thinking" && <span className="text-text-secondary font-normal ml-1">思考中…</span>}
              </div>
              <div className="text-[10px] text-text-secondary leading-snug mb-1 line-clamp-2">
                <Typewriter text={seat.lastDecision?.thought?.message ?? ""} cps={30} />
              </div>
              {actionLabel(seat) && (
                <div className={`inline-flex items-center gap-1 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 text-[10px] font-semibold ${actionLabel(seat)!.color}`}>
                  {actionLabel(seat)!.text}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-text-secondary text-center py-4">
            {t("turnCard.waiting")}
          </div>
        )}
      </div>

      {/* 右箭头 */}
      <button
        onClick={onNext}
        disabled={!canNext}
        className={`w-7 h-[88px] rounded-lg flex items-center justify-center text-lg flex-shrink-0 ${
          canNext ? "bg-white/85 text-text-secondary" : "bg-white/55 text-text-tertiary cursor-not-allowed"
        }`}
      >
        ›
      </button>
    </div>
  );
}