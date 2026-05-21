"use client";

import { useEffect } from "react";
import type { TableInfo } from "@cybercasino/shared";
import { useLanguage } from "@/contexts/LanguageContext";
import { useHeader } from "@/contexts/HeaderContext";

interface HistoryPageProps {
  tables: TableInfo[];
  onJoin: (tableId: string) => void;
  onBack: () => void;
}

export function HistoryPage({ tables, onJoin, onBack }: HistoryPageProps) {
  const { t } = useLanguage();
  const { setVisible } = useHeader();
  useEffect(() => {
    setVisible(false);
    return () => setVisible(true);
  }, [setVisible]);

  return (
    <div className="min-h-[100dvh] flex flex-col items-center px-5 pt-[max(4rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] bg-surface-elevated">
      <button onClick={onBack} className="absolute top-[max(1.5rem,env(safe-area-inset-top))] left-5 text-accent text-[15px] min-h-[44px] flex items-center">
        {t("common.back")}
      </button>

      <h2 className="text-[28px] font-semibold text-text-primary mb-8 tracking-tight">{t("history.title")}</h2>

      {tables.length === 0 ? (
        <div className="text-text-tertiary text-center py-12 bg-white rounded-2xl shadow-sm w-full max-w-lg">
          <p className="text-[15px]">{t("history.noHistory")}</p>
        </div>
      ) : (
        <div className="w-full max-w-lg space-y-2">
          {tables.map((table) => (
            <button
              key={table.id}
              onClick={() => onJoin(table.id)}
              className="w-full text-left bg-white hover:bg-white/80 rounded-2xl p-4 transition-colors shadow-sm"
            >
              <div className="flex justify-between items-center">
                <span className="text-text-primary text-[15px] font-medium">{table.name}</span>
                <span className="text-[12px] font-medium px-2 py-0.5 rounded-full bg-surface-elevated text-text-tertiary">
                  {t("common.finished")}
                </span>
              </div>
              <div className="text-text-secondary text-[13px] mt-1.5">
                {t("history.totalHands", { count: table.handNumber })}
                {table.finishedAt && ` · ${formatTime(table.finishedAt)}`}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hour = d.getHours().toString().padStart(2, "0");
  const min = d.getMinutes().toString().padStart(2, "0");
  return `${month}/${day} ${hour}:${min}`;
}
