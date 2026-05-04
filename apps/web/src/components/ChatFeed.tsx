"use client";

import { useEffect, useRef, useMemo } from "react";
import type { GameEvent, Card, SeatAgent } from "@cybercasino/shared";

const SUIT_SYMBOLS: Record<string, string> = { h: "♥", d: "♦", c: "♣", s: "♠" };
const RANK_NAMES: Record<number, string> = {
  2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8",
  9: "9", 10: "10", 11: "J", 12: "Q", 13: "K", 14: "A",
};

const BUILTIN_COLORS: Record<string, string> = {
  neon: "text-blue-400",
  viper: "text-red-400",
  ghost: "text-purple-300",
  oracle: "text-amber-400",
  shark: "text-cyan-300",
  fox: "text-orange-400",
};

const DYNAMIC_COLORS = [
  "text-pink-400", "text-lime-400", "text-violet-400", "text-teal-400",
  "text-rose-400", "text-sky-400", "text-emerald-400", "text-amber-300",
];

function hashColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  return DYNAMIC_COLORS[Math.abs(hash) % DYNAMIC_COLORS.length];
}

interface AgentLookup {
  name: string;
  avatar: string;
  color: string;
}

function buildLookup(roster: SeatAgent[]): Map<string, AgentLookup> {
  const map = new Map<string, AgentLookup>();
  for (const agent of roster) {
    map.set(agent.id, {
      name: agent.name,
      avatar: agent.avatar,
      color: BUILTIN_COLORS[agent.id] ?? hashColor(agent.id),
    });
  }
  return map;
}

function CardDisplay({ card }: { card: Card }) {
  const color = card.suit === "h" || card.suit === "d" ? "text-red-400" : "text-cyan-300";
  return (
    <span className={`${color} font-bold`}>
      [{RANK_NAMES[card.rank]}{SUIT_SYMBOLS[card.suit]}]
    </span>
  );
}

function CardsInline({ cards }: { cards: Card[] }) {
  return (
    <span>
      {cards.map((c, i) => (
        <CardDisplay key={i} card={c} />
      ))}
    </span>
  );
}

function AgentTag({ id, lookup }: { id: string; lookup: Map<string, AgentLookup> }) {
  const info = lookup.get(id) ?? { name: id, avatar: "🤖", color: "text-gray-400" };
  return <span className={`${info.color} font-bold`}>[{info.avatar} {info.name}]</span>;
}

function EventLine({ event, lookup }: { event: GameEvent; lookup: Map<string, AgentLookup> }) {
  switch (event.type) {
    case "agent-roster":
      return null;

    case "hand-start":
      return (
        <div className="border-t border-cyan-900/50 pt-3 mt-3">
          <div className="text-cyan-400 text-center text-sm mb-1">
            ╭───────────────────────────────────╮
          </div>
          <div className="text-cyan-300 text-center text-sm">
            🃏 Hand #{event.handNumber} · {event.players.length} Players
          </div>
          <div className="text-cyan-400 text-center text-sm">
            ╰───────────────────────────────────╯
          </div>
        </div>
      );

    case "blinds-posted":
      return (
        <div className="space-y-0.5 text-sm">
          <div><AgentTag id={event.smallBlindPlayerId} lookup={lookup} /> <span className="text-green-600">🟢 Small Blind {event.smallBlind}</span></div>
          <div><AgentTag id={event.bigBlindPlayerId} lookup={lookup} /> <span className="text-yellow-600">🟡 Big Blind {event.bigBlind}</span></div>
        </div>
      );

    case "cards-dealt":
      return (
        <div className="bg-gray-900/50 border border-cyan-900/30 rounded p-2 my-2">
          <div className="text-cyan-400 text-xs mb-1">┌─ 👁 GOD VIEW ─────────────────────┐</div>
          {Object.entries(event.hands).map(([id, cards]) => (
            <div key={id} className="text-sm">
              <AgentTag id={id} lookup={lookup} /> <CardsInline cards={cards} />
            </div>
          ))}
          <div className="text-cyan-400 text-xs mt-1">└───────────────────────────────────┘</div>
        </div>
      );

    case "phase-change":
      return (
        <div className="text-center my-2 text-sm">
          <span className="text-gray-500">───</span>
          <span className="text-yellow-400 mx-2">
            {event.phase.toUpperCase()}: <CardsInline cards={event.communityCards} />
          </span>
          <span className="text-gray-500">───</span>
        </div>
      );

    case "action-taken": {
      const { action, thought } = event;
      const actionEmoji = {
        fold: "❌",
        check: "✅",
        call: "📞",
        raise: "⬆️",
      }[action.type];
      const actionText = action.type === "raise"
        ? `Raise ${action.amount}`
        : action.type.charAt(0).toUpperCase() + action.type.slice(1);

      return (
        <div className="space-y-0.5 my-1">
          {thought.message && thought.message !== "..." && (
            <div className="text-sm opacity-70">
              <AgentTag id={event.playerId} lookup={lookup} />{" "}
              <span className="text-gray-400">💭 &quot;{thought.message}&quot;</span>
              {thought.isBluffing && (
                <span className="text-red-500 text-xs ml-1">| 诈唬: YES</span>
              )}
              {thought.confidence > 0 && (
                <span className="text-gray-500 text-xs ml-1">
                  | 信心: {Math.round(thought.confidence * 100)}%
                </span>
              )}
            </div>
          )}
          <div className="text-sm">
            <AgentTag id={event.playerId} lookup={lookup} /> <span className="text-white">{actionEmoji} {actionText}</span>
          </div>
        </div>
      );
    }

    case "pot-updated": {
      const total = event.pots.reduce((s, p) => s + p.amount, 0);
      return (
        <div className="text-xs text-gray-500 text-right">
          💰 Pot: {total}
        </div>
      );
    }

    case "showdown":
      return (
        <div className="border-t border-yellow-900/50 pt-2 mt-2">
          <div className="text-yellow-400 text-sm text-center mb-1">🏆 SHOWDOWN</div>
          {event.results.map((r) => (
            <div key={r.playerId} className="text-sm">
              <AgentTag id={r.playerId} lookup={lookup} /> <CardsInline cards={r.holeCards} />{" "}
              <span className="text-gray-400">→ {r.handName}</span>
            </div>
          ))}
        </div>
      );

    case "player-eliminated":
      return (
        <div className="text-center my-3 text-sm">
          <span className="text-gray-500">────</span>
          <span className="text-red-400 mx-2">
            💀 <AgentTag id={event.playerId} lookup={lookup} /> 第{event.finishPosition}名淘汰 · Hand #{event.handNumber}
          </span>
          <span className="text-gray-500">────</span>
        </div>
      );

    case "blind-level-up":
      return (
        <div className="text-center my-3 text-sm">
          <span className="text-gray-500">────</span>
          <span className="text-yellow-300 mx-2">
            ⬆️ 盲注升级 Level {event.level}: {event.smallBlind}/{event.bigBlind}
          </span>
          <span className="text-gray-500">────</span>
        </div>
      );

    case "tournament-complete":
      return (
        <div className="border border-yellow-500/50 rounded my-4 p-3 bg-yellow-900/10">
          <div className="text-yellow-400 text-center text-sm mb-2">
            ╔═══════════════════════════════════╗
          </div>
          <div className="text-yellow-300 text-center text-sm font-bold mb-2">
            🏆 SNG 锦标赛结束
          </div>
          <div className="space-y-1">
            {event.rankings.map((r) => {
              const medal = r.position === 1 ? "🥇" : r.position === 2 ? "🥈" : r.position === 3 ? "🥉" : "  ";
              const suffix = r.position === 1 ? "st" : r.position === 2 ? "nd" : r.position === 3 ? "rd" : "th";
              return (
                <div key={r.playerId} className="text-sm text-center">
                  <span className="text-gray-400">{medal} {r.position}{suffix} </span>
                  <AgentTag id={r.playerId} lookup={lookup} />
                </div>
              );
            })}
          </div>
          <div className="text-yellow-400 text-center text-sm mt-2">
            ╚═══════════════════════════════════╝
          </div>
          <div className="text-xs text-gray-500 text-center mt-1">
            共 {event.rankings[0]?.handsPlayed ?? 0} 手牌
          </div>
        </div>
      );

    case "hand-highlight":
      return (
        <div className="text-center my-2 text-sm">
          <span className="text-gray-500">───</span>
          <span className="text-fuchsia-400 mx-2">
            ⭐ 精彩时刻 · Hand #{event.handNumber} · 切换「精彩解说」Tab 查看
          </span>
          <span className="text-gray-500">───</span>
        </div>
      );

    case "hand-complete": {
      const merged = new Map<string, number>();
      for (const w of event.winners) {
        merged.set(w.playerId, (merged.get(w.playerId) ?? 0) + w.amount);
      }
      return (
        <div className="border-t border-green-900/50 pt-2 mt-2 mb-4">
          {[...merged.entries()].map(([id, amount]) => (
            <div key={id} className="text-green-400 text-sm">
              🎉 <AgentTag id={id} lookup={lookup} /> wins {amount} chips!
            </div>
          ))}
          <div className="text-xs text-gray-600 mt-1">
            {event.players.map((p) => {
              const info = lookup.get(p.id);
              return (
                <span key={p.id} className="mr-3">
                  {info?.avatar ?? "🤖"} {p.chips}
                </span>
              );
            })}
          </div>
        </div>
      );
    }

    default:
      return null;
  }
}

export function ChatFeed({ events }: { events: GameEvent[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  const roster = useMemo(() => {
    const rosterEvent = events.find((e) => e.type === "agent-roster");
    if (rosterEvent && rosterEvent.type === "agent-roster") {
      return rosterEvent.agents;
    }
    return [];
  }, [events]);

  const lookup = useMemo(() => buildLookup(roster), [roster]);

  const visibleEvents = events.filter(
    (e) => e.type !== "action-required" && e.type !== "agent-roster"
  );

  return (
    <div className="flex-1 overflow-y-auto px-4 py-2 font-mono text-sm">
      {visibleEvents.length === 0 && (
        <div className="text-gray-600 text-center mt-20">
          Waiting for game to start...
        </div>
      )}
      {visibleEvents.map((event, i) => (
        <EventLine key={i} event={event} lookup={lookup} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
