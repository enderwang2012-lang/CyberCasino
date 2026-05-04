"use client";

import { useMemo, useEffect, useRef } from "react";
import type { GameEvent, HighlightReason, SeatAgent } from "@cybercasino/shared";

const REASON_BADGES: Record<HighlightReason, { label: string; color: string }> = {
  "big-pot": { label: "大底池", color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/40" },
  "bluff-success": { label: "诈唬成功", color: "bg-red-500/20 text-red-400 border-red-500/40" },
  "bluff-catch": { label: "抓诈", color: "bg-green-500/20 text-green-400 border-green-500/40" },
  "cooler": { label: "Cooler", color: "bg-purple-500/20 text-purple-400 border-purple-500/40" },
  "bad-beat": { label: "Bad Beat", color: "bg-orange-500/20 text-orange-400 border-orange-500/40" },
  "short-stack-comeback": { label: "短码翻盘", color: "bg-cyan-500/20 text-cyan-400 border-cyan-500/40" },
  "multi-way-allin": { label: "多人全下", color: "bg-fuchsia-500/20 text-fuchsia-400 border-fuchsia-500/40" },
};

export function HighlightFeed({ events }: { events: GameEvent[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

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
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [highlights.length]);

  if (highlights.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-600 px-8">
        <div className="text-4xl mb-3">🎬</div>
        <div className="text-sm text-center">
          比赛精彩时刻即将到来...
        </div>
        <div className="text-xs text-gray-700 mt-1">
          大底池、诈唬对决、翻盘时刻会自动生成解说
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
      {highlights.map((event, idx) => {
        if (event.type !== "hand-highlight") return null;
        return (
          <div
            key={idx}
            className="border border-fuchsia-900/40 rounded-lg bg-gray-900/60 p-4 backdrop-blur-sm"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-gray-500">
                Hand #{event.handNumber}
              </div>
              <div className="text-xs text-yellow-400/80">
                💰 {event.potTotal.toLocaleString()}
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 mb-3">
              {event.reasons.map((reason) => {
                const badge = REASON_BADGES[reason];
                return (
                  <span
                    key={reason}
                    className={`text-xs px-2 py-0.5 rounded border ${badge.color}`}
                  >
                    {badge.label}
                  </span>
                );
              })}
            </div>

            <div className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">
              {event.commentary}
            </div>

            {event.involvedPlayerIds.length > 0 && (
              <div className="mt-3 flex gap-2 text-xs text-gray-500">
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
      <div ref={bottomRef} />
    </div>
  );
}
