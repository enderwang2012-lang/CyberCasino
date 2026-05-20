"use client";

import { useMemo, useEffect, useRef } from "react";
import type { GameEvent, HighlightReason, SeatAgent } from "@cybercasino/shared";
import { useLanguage } from "@/contexts/LanguageContext";

export function HighlightFeed({ events }: { events: GameEvent[] }) {
  const { t } = useLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  const REASON_BADGES: Record<HighlightReason, { label: string; color: string }> = {
    "big-pot": { label: t("highlightFeed.bigPot"), color: "bg-warning/15 text-warning" },
    "bluff-success": { label: t("highlightFeed.bluffSuccess"), color: "bg-danger/15 text-danger" },
    "bluff-catch": { label: t("highlightFeed.bluffCatch"), color: "bg-success/15 text-success" },
    "cooler": { label: t("highlightFeed.cooler"), color: "bg-[#BF5AF2]/15 text-[#BF5AF2]" },
    "bad-beat": { label: t("highlightFeed.badBeat"), color: "bg-[#FF9F0A]/15 text-[#FF9F0A]" },
    "short-stack-comeback": { label: t("highlightFeed.shortStackComeback"), color: "bg-accent/15 text-accent" },
    "multi-way-allin": { label: t("highlightFeed.multiWayAllin"), color: "bg-[#BF5AF2]/15 text-[#BF5AF2]" },
  };

  const roster = useMemo(() => {
    const rosterEvent = events.find((e) => e.type === "agent-roster");
    if (rosterEvent && rosterEvent.type === "agent-roster") return rosterEvent.agents;
    return [] as SeatAgent[];
  }, [events]);

  const agentMap = useMemo(() => {
    const map = new Map<string, SeatAgent>();
    for (const a of roster) map.set(a.id, a);
    return map;
  }, [roster]);

  const highlights = useMemo(
    () => events.filter((e) => e.type === "hand-highlight"),
    [events]
  );

  useEffect(() => {
    if (highlights.length > prevCountRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
    prevCountRef.current = highlights.length;
  }, [highlights.length]);

  if (highlights.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary px-8">
        <div className="text-[40px] mb-4">🎬</div>
        <div className="text-[15px] text-text-secondary text-center">
          {t("highlightFeed.highlightsComing")}
        </div>
        <div className="text-[13px] text-text-tertiary mt-1 text-center">
          {t("highlightFeed.highlightsDesc")}
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 overscroll-contain">
      {highlights.map((event, idx) => {
        if (event.type !== "hand-highlight") return null;
        return (
          <div
            key={idx}
            className="bg-white rounded-2xl p-5 shadow-sm"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="text-[13px] text-text-tertiary font-medium">
                {t("highlightFeed.hand", { number: event.handNumber })}
              </div>
              <div className="text-[13px] text-warning font-medium">
                {t("highlightFeed.potAmount", { amount: event.potTotal.toLocaleString() })}
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 mb-4">
              {event.reasons.map((reason) => {
                const badge = REASON_BADGES[reason];
                return (
                  <span
                    key={reason}
                    className={`text-[12px] font-medium px-2.5 py-1 rounded-full ${badge.color}`}
                  >
                    {badge.label}
                  </span>
                );
              })}
            </div>

            <div className="text-[15px] text-text-primary leading-relaxed whitespace-pre-wrap">
              {event.commentary}
            </div>

            {event.involvedPlayerIds.length > 0 && (
              <div className="mt-4 pt-3 border-t border-separator flex gap-3 text-[13px] text-text-secondary">
                {event.involvedPlayerIds.map((id) => {
                  const agent = agentMap.get(id);
                  return (
                    <span key={id}>
                      {agent?.avatar ?? "🤖"} {agent?.name ?? id}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
