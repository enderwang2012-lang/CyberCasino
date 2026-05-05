"use client";

import { useMemo } from "react";
import type { GameEvent, SeatAgent } from "@cybercasino/shared";

interface LeaderboardEntry {
  id: string;
  name: string;
  avatar: string;
  chips: number;
  eliminated: boolean;
  finishPosition?: number;
  eliminatedAtHand?: number;
}

export function Leaderboard({ events }: { events: GameEvent[] }) {
  const entries = useMemo(() => {
    const roster: SeatAgent[] = [];
    const rosterEvent = events.find((e) => e.type === "agent-roster");
    if (rosterEvent && rosterEvent.type === "agent-roster") {
      roster.push(...rosterEvent.agents);
    }

    const chipMap = new Map<string, number>();
    for (const event of events) {
      if (event.type === "hand-start") {
        for (const p of event.players) {
          if (!chipMap.has(p.id)) {
            chipMap.set(p.id, p.chips);
          }
        }
      }
      if (event.type === "hand-complete") {
        for (const p of event.players) {
          chipMap.set(p.id, p.chips);
        }
      }
    }

    const eliminations = new Map<string, { position: number; hand: number }>();
    for (const event of events) {
      if (event.type === "player-eliminated") {
        eliminations.set(event.playerId, {
          position: event.finishPosition,
          hand: event.handNumber,
        });
      }
    }

    const result: LeaderboardEntry[] = roster.map((agent) => {
      const elim = eliminations.get(agent.id);
      return {
        id: agent.id,
        name: agent.name,
        avatar: agent.avatar,
        chips: chipMap.get(agent.id) ?? 0,
        eliminated: !!elim,
        finishPosition: elim?.position,
        eliminatedAtHand: elim?.hand,
      };
    });

    result.sort((a, b) => {
      if (a.eliminated && !b.eliminated) return 1;
      if (!a.eliminated && b.eliminated) return -1;
      if (!a.eliminated && !b.eliminated) return b.chips - a.chips;
      return (a.finishPosition ?? 99) - (b.finishPosition ?? 99);
    });

    return result;
  }, [events]);

  if (entries.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-[15px]">
        等待比赛开始...
      </div>
    );
  }

  const totalChips = entries.reduce((sum, e) => sum + e.chips, 0);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4">
      <div className="space-y-1.5">
        {entries.map((entry, idx) => {
          const rank = entry.eliminated ? entry.finishPosition : idx + 1;
          const chipPercent = totalChips > 0 ? Math.round((entry.chips / totalChips) * 100) : 0;

          return (
            <div
              key={entry.id}
              className="flex items-center gap-3 rounded-xl px-4 py-3 bg-white shadow-sm"
            >
              <span className="text-text-secondary text-[13px] font-medium w-6 text-center">
                {rank}
              </span>
              <span className="text-[24px]">{entry.avatar}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-medium truncate text-text-primary">
                  {entry.name}
                </div>
                {entry.eliminated ? (
                  <div className="text-[13px] text-text-secondary">
                    第{entry.finishPosition}名淘汰 · 第{entry.eliminatedAtHand}手
                  </div>
                ) : (
                  <div className="text-[13px] text-text-secondary">
                    {entry.chips.toLocaleString()} · {chipPercent}%
                  </div>
                )}
              </div>
              {!entry.eliminated && (
                <div className="w-16 h-1.5 bg-surface-deep rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-full transition-all"
                    style={{ width: `${chipPercent}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
