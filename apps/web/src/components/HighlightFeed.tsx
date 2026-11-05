"use client";

import { useMemo, useEffect, useRef } from "react";
import type { GameEvent, HighlightReason, SeatAgent } from "@cybercasino/shared";
import { useLanguage } from "@/contexts/LanguageContext";

export function HighlightFeed({ events }: { events: GameEvent[] }) {
  const { t, language } = useLanguage();
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
    const rosterEvent = events.findLast((e) => e.type === "agent-roster");
    if (rosterEvent && rosterEvent.type === "agent-roster") return rosterEvent.agents;
    return [] as SeatAgent[];
  }, [events]);

  const agentMap = useMemo(() => {
    const map = new Map<string, SeatAgent>();
    for (const a of roster) map.set(a.id, a);
    return map;
  }, [roster]);

  const highlights = useMemo(
    () => events.filter((e) => e.type === "hand-highlight" || e.type === "public-commentary"),
    [events]
  );
  const recap = useMemo(
    () => highlights.length > 0 ? [] : buildHandRecap(events, agentMap, language),
    [agentMap, events, highlights.length, language],
  );

  useEffect(() => {
    if (highlights.length > prevCountRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
    prevCountRef.current = highlights.length;
  }, [highlights.length]);

  if (highlights.length === 0 && recap.length === 0) {
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

  if (highlights.length === 0) {
    return (
      <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 overscroll-contain">
        {recap.map((hand) => (
          <div key={hand.handNumber} className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="text-[13px] text-text-tertiary font-medium mb-3">
              {t("highlightFeed.hand", { number: hand.handNumber })}
            </div>
            <div className="text-[15px] text-text-primary leading-relaxed whitespace-pre-wrap">
              {hand.lines.join("\n")}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 overscroll-contain">
      {highlights.map((event, idx) => {
        if (event.type === "public-commentary") {
          return (
            <div key={idx} className="bg-white rounded-2xl p-5 shadow-sm">
              <div className="text-[13px] text-text-tertiary font-medium mb-3">
                {t("highlightFeed.hand", { number: event.handNumber })}
              </div>
              <div className="text-[15px] text-text-primary leading-relaxed whitespace-pre-wrap">
                {event.commentary}
              </div>
            </div>
          );
        }
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

function buildHandRecap(
  events: GameEvent[],
  agents: Map<string, SeatAgent>,
  language: "zh" | "en",
): Array<{ handNumber: number; lines: string[] }> {
  const nameOf = (id: string) => agents.get(id)?.name ?? id;
  const hands: Array<{ handNumber: number; lines: string[] }> = [];
  let current: { handNumber: number; lines: string[] } | null = null;
  const zh = language === "zh";

  for (const event of events) {
    if (event.type === "hand-start") {
      if (current && current.lines.length > 0) hands.push(current);
      current = { handNumber: event.handNumber, lines: [] };
      continue;
    }
    if (!current) continue;
    if (event.type === "phase-change" && event.communityCards.length > 0) {
      const cards = event.communityCards.map((card) => `${card.rank}${card.suit}`).join(" ");
      current.lines.push(zh ? `${event.phase} ${cards}` : `${event.phase} ${cards}`);
    } else if (event.type === "action-taken") {
      const who = nameOf(event.playerId);
      const amount = event.action.amount;
      const action = event.action.type === "raise"
        ? (zh ? `加注到 ${amount ?? ""}` : `raises to ${amount ?? ""}`)
        : event.action.type === "call" ? (zh ? "跟注" : "calls")
        : event.action.type === "fold" ? (zh ? "弃牌" : "folds")
        : (zh ? "过牌" : "checks");
      current.lines.push(`${who} ${action}`);
    } else if (event.type === "showdown") {
      current.lines.push(event.results.map((result) =>
        `${nameOf(result.playerId)} ${result.handName}`).join(zh ? "，" : ", "));
    } else if (event.type === "hand-complete" && event.winners.length > 0) {
      const winners = [...new Set(event.winners.map((winner) => nameOf(winner.playerId)))].join(zh ? "、" : ", ");
      current.lines.push(zh ? `${winners} 赢下底池` : `${winners} wins the pot`);
    }
  }
  if (current && current.lines.length > 0) hands.push(current);
  return hands;
}
