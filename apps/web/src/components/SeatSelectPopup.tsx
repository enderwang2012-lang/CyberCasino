"use client";

import type { AgentConfig, BuiltinPersonalityInfo } from "@cybercasino/shared";
import { useLanguage } from "@/contexts/LanguageContext";

interface SeatSelectPopupProps {
  agentConfig: AgentConfig | null;
  myAgentSeated: boolean;
  personalities: BuiltinPersonalityInfo[];
  seatedPersonalityIds: string[];
  onSelectSelf: () => void;
  onSelectBuiltin: (personalityId: string) => void;
  onAgentSetup: () => void;
  onClose: () => void;
}

export function SeatSelectPopup({
  agentConfig,
  myAgentSeated,
  personalities,
  seatedPersonalityIds,
  onSelectSelf,
  onSelectBuiltin,
  onAgentSetup,
  onClose,
}: SeatSelectPopupProps) {
  const { t } = useLanguage();
  const selfDisabled = myAgentSeated || !agentConfig;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-t-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto shadow-lg animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white px-5 pt-5 pb-3 border-b border-separator">
          <div className="flex justify-between items-center">
            <h3 className="text-text-primary text-[17px] font-semibold">{t("seatSelect.title")}</h3>
            <button onClick={onClose} className="text-text-tertiary text-[15px] min-w-[44px] min-h-[44px] flex items-center justify-center">
              {t("common.close")}
            </button>
          </div>
        </div>

        <div className="px-5 py-4">
          {agentConfig ? (
            <button
              onClick={onSelectSelf}
              disabled={myAgentSeated}
              className={`w-full text-left flex items-center gap-4 p-3 rounded-xl transition-colors ${
                myAgentSeated ? "opacity-40 cursor-not-allowed" : "active:bg-surface-elevated"
              }`}
            >
              <span className="text-[32px]">{agentConfig.avatar}</span>
              <div className="flex-1">
                <div className="text-text-primary text-[15px] font-medium">{agentConfig.name}</div>
                <div className="text-[13px] text-[#BF5AF2]">
                  {t("seatSelect.customAgent")}
                </div>
              </div>
              {myAgentSeated && <span className="text-text-tertiary text-[12px]">{t("seatSelect.alreadySeated")}</span>}
            </button>
          ) : (
            <button
              onClick={onAgentSetup}
              className="w-full text-left flex items-center gap-4 p-3 rounded-xl active:bg-surface-elevated transition-colors"
            >
              <span className="text-[32px] opacity-30">🤖</span>
              <div className="flex-1">
                <div className="text-text-primary text-[15px] font-medium">{t("seatSelect.createNew")}</div>
                <div className="text-text-tertiary text-[13px]">{t("seatSelect.createDesc")}</div>
              </div>
              <span className="text-text-tertiary text-[13px]">→</span>
            </button>
          )}
        </div>

        <div className="mx-5 h-px bg-separator" />

        <div className="px-5 py-4">
          <p className="text-text-tertiary text-[12px] font-medium uppercase tracking-wide mb-3">{t("seatSelect.builtinAi")}</p>
          <div className="space-y-1">
            {personalities.map((p) => {
              const isSeated = seatedPersonalityIds.includes(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => !isSeated && onSelectBuiltin(p.id)}
                  disabled={isSeated}
                  className={`w-full text-left flex items-center gap-4 p-3 rounded-xl transition-colors ${
                    isSeated ? "opacity-40 cursor-not-allowed" : "active:bg-surface-elevated"
                  }`}
                >
                  <span className="text-[32px]">{p.avatar}</span>
                  <div className="flex-1">
                    <div className="text-text-primary text-[15px] font-medium">{p.name}</div>
                    <div className="text-text-tertiary text-[13px]">{p.style}</div>
                  </div>
                  {isSeated && <span className="text-text-tertiary text-[12px]">{t("seatSelect.alreadySeated")}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
