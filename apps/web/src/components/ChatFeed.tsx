"use client";

import { useEffect, useRef, useMemo } from "react";
import type { GameEvent, Card, SeatAgent } from "@cybercasino/shared";
import { evaluateHand } from "@cybercasino/engine";

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
  return <span className={`${info.color} font-bold`}>{info.avatar} {info.name}</span>;
}

function getHandName(holeCards: Card[], communityCards: Card[]): string | null {
  const allCards = [...holeCards, ...communityCards];
  if (allCards.length < 5) return null;
  const result = evaluateHand(allCards);
  return result.name;
}

interface EventContext {
  lookup: Map<string, AgentLookup>;
  chipsBeforeHand: Map<string, number>;
  holeCards: Map<string, Card[]>;
  communityCards: Card[];
  currentChips: Map<string, number>;
}

function EventLine({ event, ctx }: { event: GameEvent; ctx: EventContext }) {
  const { lookup, chipsBeforeHand, holeCards, communityCards, currentChips } = ctx;

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
          <div><AgentTag id={event.smallBlindPlayerId} lookup={lookup} /> <span className="text-green-600">🟢 SB {event.smallBlind}</span></div>
          <div><AgentTag id={event.bigBlindPlayerId} lookup={lookup} /> <span className="text-yellow-600">🟡 BB {event.bigBlind}</span></div>
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

      const chips = currentChips.get(event.playerId) ?? 0;
      const myCards = holeCards.get(event.playerId);
      const handName = myCards ? getHandName(myCards, communityCards) : null;

      return (
        <div className="my-1.5 border-l-2 border-gray-800 pl-2">
          <div className="text-sm">
            <AgentTag id={event.playerId} lookup={lookup} />
            <span className="text-gray-500 ml-1.5">💰{chips}</span>
            {myCards && <span className="ml-1.5"><CardsInline cards={myCards} /></span>}
            {handName && <span className="text-gray-400 ml-1">→ {handName}</span>}
          </div>
          {thought.message && thought.message !== "..." && (
            <div className="text-xs text-gray-400 mt-0.5">
              💭 &quot;{thought.message}&quot;
              {thought.isBluffing && (
                <span className="text-red-500 ml-1">| 诈唬</span>
              )}
              {thought.confidence > 0 && (
                <span className="text-gray-500 ml-1">
                  | {Math.round(thought.confidence * 100)}%
                </span>
              )}
            </div>
          )}
          <div className="text-sm mt-0.5">
            <span className="text-white">{actionEmoji} {actionText}</span>
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
          <span className="text-gray-500">──</span>
          <span className="text-fuchsia-400 mx-2">⭐精彩时刻⭐</span>
          <span className="text-gray-500">──</span>
        </div>
      );

    case "hand-complete": {
      const netChanges = event.players
        .map((p) => ({
          id: p.id,
          net: p.chips - (chipsBeforeHand.get(p.id) ?? p.chips),
        }))
        .filter((p) => p.net !== 0)
        .sort((a, b) => b.net - a.net);

      return (
        <div className="border-t border-green-900/50 pt-2 mt-2 mb-4">
          {netChanges.map(({ id, net }) => (
            <div key={id} className={`text-sm ${net > 0 ? "text-green-400" : "text-red-400"}`}>
              {net > 0 ? "🎉" : "💸"} <AgentTag id={id} lookup={lookup} /> {net > 0 ? `+${net}` : `${net}`}
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

interface AccumulatedContext {
  chipsBeforeHand: Map<string, number>;
  holeCards: Map<string, Card[]>;
  communityCards: Card[];
  currentChips: Map<string, number>;
}

export function ChatFeed({ events }: { events: GameEvent[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  useEffect(() => {
    if (events.length > prevCountRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevCountRef.current = events.length;
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

  // Build accumulated context per event for action-taken rendering
  const contexts = useMemo(() => {
    const result: AccumulatedContext[] = [];
    let chipsBeforeHand = new Map<string, number>();
    let holeCards = new Map<string, Card[]>();
    let communityCards: Card[] = [];
    let currentChips = new Map<string, number>();

    for (const event of visibleEvents) {
      if (event.type === "hand-start") {
        chipsBeforeHand = new Map(event.players.map((p) => [p.id, p.chips]));
        currentChips = new Map(event.players.map((p) => [p.id, p.chips]));
        holeCards = new Map();
        communityCards = [];
      }
      if (event.type === "cards-dealt") {
        for (const [id, cards] of Object.entries(event.hands)) {
          holeCards.set(id, cards);
        }
      }
      if (event.type === "phase-change") {
        communityCards = event.communityCards;
      }
      if (event.type === "action-taken") {
        const { action, playerId } = event;
        if (action.type === "call" || action.type === "raise") {
          const chips = currentChips.get(playerId) ?? 0;
          const cost = action.amount ?? 0;
          currentChips.set(playerId, Math.max(0, chips - cost));
        }
      }
      if (event.type === "hand-complete") {
        for (const p of event.players) {
          currentChips.set(p.id, p.chips);
        }
      }
      result.push({ chipsBeforeHand, holeCards, communityCards, currentChips: new Map(currentChips) });
    }
    return result;
  }, [visibleEvents]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-2 font-mono text-sm">
      {visibleEvents.length === 0 && (
        <div className="text-gray-600 text-center mt-20">
          Waiting for game to start...
        </div>
      )}
      {visibleEvents.map((event, i) => (
        <EventLine
          key={i}
          event={event}
          ctx={{
            lookup,
            chipsBeforeHand: contexts[i].chipsBeforeHand,
            holeCards: contexts[i].holeCards,
            communityCards: contexts[i].communityCards,
            currentChips: contexts[i].currentChips,
          }}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
