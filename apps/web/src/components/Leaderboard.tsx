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

    // Get latest chip counts from hand-start (initial) and hand-complete (updated)
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

    // Get elimination info
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

    // Sort: active players by chips descending, then eliminated by position
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
      <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
        等待比赛开始...
      </div>
    );
  }

  const maxChips = Math.max(...entries.filter((e) => !e.eliminated).map((e) => e.chips), 1);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 font-mono">
      <div className="space-y-2">
        {entries.map((entry, idx) => {
          const rank = entry.eliminated ? entry.finishPosition : idx + 1;
          const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null;
          const barWidth = entry.eliminated ? 0 : (entry.chips / maxChips) * 100;

          return (
            <div
              key={entry.id}
              className={`relative rounded border p-2.5 ${
                entry.eliminated
                  ? "border-gray-800 bg-gray-900/30 opacity-60"
                  : "border-cyan-900/40 bg-gray-900/60"
              }`}
            >
              {!entry.eliminated && (
                <div
                  className="absolute inset-0 bg-cyan-950/30 rounded"
                  style={{ width: `${barWidth}%` }}
                />
              )}
              <div className="relative flex items-center gap-3">
                <span className="text-lg w-8 text-center">
                  {medal ?? <span className="text-gray-500 text-sm">#{rank}</span>}
                </span>
                <span className="text-lg">{entry.avatar}</span>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-bold truncate ${entry.eliminated ? "text-gray-500" : "text-white"}`}>
                    {entry.name}
                  </div>
                  {entry.eliminated ? (
                    <div className="text-xs text-red-400/70">
                      💀 第{entry.finishPosition}名淘汰 · Hand #{entry.eliminatedAtHand}
                    </div>
                  ) : (
                    <div className="text-xs text-cyan-400/80">
                      {entry.chips.toLocaleString()} chips
                    </div>
                  )}
                </div>
                {!entry.eliminated && (
                  <div className="text-green-400 text-xs font-bold">
                    ALIVE
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
