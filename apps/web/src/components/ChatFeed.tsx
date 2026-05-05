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
  neon: "text-accent",
  viper: "text-danger",
  ghost: "text-[#BF5AF2]",
  oracle: "text-warning",
  shark: "text-[#64D2FF]",
  fox: "text-[#FF9F0A]",
};

const DYNAMIC_COLORS = [
  "text-[#FF375F]", "text-success", "text-[#BF5AF2]", "text-[#64D2FF]",
  "text-[#FF9F0A]", "text-accent", "text-[#30D158]", "text-warning",
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
  const color = card.suit === "h" || card.suit === "d" ? "text-danger" : "text-text-primary";
  return (
    <span className={`${color} font-semibold`}>
      {RANK_NAMES[card.rank]}{SUIT_SYMBOLS[card.suit]}
    </span>
  );
}

function CardsInline({ cards }: { cards: Card[] }) {
  return (
    <span className="inline-flex gap-0.5">
      {cards.map((c, i) => (
        <CardDisplay key={i} card={c} />
      ))}
    </span>
  );
}

function AgentTag({ id, lookup }: { id: string; lookup: Map<string, AgentLookup> }) {
  const info = lookup.get(id) ?? { name: id, avatar: "🤖", color: "text-text-secondary" };
  return <span className={`${info.color} font-medium`}>{info.avatar} {info.name}</span>;
}

function getHandName(holeCards: Card[], communityCards: Card[]): string | null {
  const allCards = [...holeCards, ...communityCards];
  if (allCards.length < 5) return null;
  const result = evaluateHand(allCards);
  return result.name;
}

interface BlindInfo {
  smallBlindPlayerId: string;
  bigBlindPlayerId: string;
  smallBlind: number;
  bigBlind: number;
}

interface EventContext {
  lookup: Map<string, AgentLookup>;
  chipsBeforeHand: Map<string, number>;
  holeCards: Map<string, Card[]>;
  communityCards: Card[];
  currentChips: Map<string, number>;
  potTotal?: number;
  blindInfo?: BlindInfo;
  netProfits?: Map<string, number>;
}

function EventLine({ event, ctx }: { event: GameEvent; ctx: EventContext }) {
  const { lookup, chipsBeforeHand, holeCards, communityCards, currentChips, potTotal } = ctx;

  switch (event.type) {
    case "agent-roster":
      return null;

    case "hand-start":
      return (
        <div className="pt-5 mt-3">
          <div className="text-center">
            <span className="text-text-secondary text-[13px] font-medium bg-white px-4 py-1.5 rounded-full shadow-sm">
              第 {event.handNumber} 手 · {event.players.length} 人
            </span>
          </div>
        </div>
      );

    case "blinds-posted":
      return null;

    case "cards-dealt": {
      const blind = ctx.blindInfo;
      return (
        <div className="bg-white rounded-2xl p-4 my-2 shadow-sm">
          <div className="text-[11px] text-text-tertiary font-medium mb-2 uppercase tracking-wide">发牌</div>
          <div className="space-y-1">
            {Object.entries(event.hands).map(([id, cards]) => {
              const isSB = blind?.smallBlindPlayerId === id;
              const isBB = blind?.bigBlindPlayerId === id;
              return (
                <div key={id} className="flex items-center text-[14px] leading-relaxed">
                  <AgentTag id={id} lookup={lookup} /> <span className="ml-1.5"><CardsInline cards={cards} /></span>
                  {isSB && <span className="ml-2 text-[12px] text-text-tertiary font-medium">SB {blind.smallBlind}</span>}
                  {isBB && <span className="ml-2 text-[12px] text-text-tertiary font-medium">BB {blind.bigBlind}</span>}
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    case "phase-change":
      return (
        <div className="text-center my-3">
          <span className="text-text-secondary text-[13px]">
            <span className="text-text-tertiary mr-2">—</span>
            <span className="font-medium">{event.phase.toUpperCase()}</span>
            <span className="ml-2"><CardsInline cards={event.communityCards} /></span>
            <span className="text-text-tertiary ml-2">—</span>
          </span>
        </div>
      );

    case "action-taken": {
      const { action, thought } = event;
      const actionLabel = action.type === "raise"
        ? `加注 ${action.amount}`
        : action.type === "call" ? "跟注"
        : action.type === "check" ? "过牌"
        : "弃牌";

      const actionColor = action.type === "fold" ? "text-text-tertiary"
        : action.type === "raise" ? "text-warning"
        : action.type === "call" ? "text-success"
        : "text-text-secondary";

      const chips = currentChips.get(event.playerId) ?? 0;
      const myCards = holeCards.get(event.playerId);
      const handName = myCards ? getHandName(myCards, communityCards) : null;

      return (
        <div className="bg-white rounded-2xl p-4 my-2 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-[14px] text-text-primary">
              <AgentTag id={event.playerId} lookup={lookup} />
              <span className="text-text-secondary ml-1.5">{chips}</span>
              {myCards && <span className="ml-1.5"><CardsInline cards={myCards} /></span>}
              {handName && <span className="text-text-secondary ml-1">· {handName}</span>}
            </div>
            {potTotal != null && (
              <div className="text-[13px] text-warning font-medium">
                底池 {potTotal}
              </div>
            )}
          </div>
          {thought.message && thought.message !== "..." && (
            <div className="text-[13px] text-text-secondary mt-1.5 italic">
              "{thought.message}"
              {thought.isBluffing && <span className="text-danger ml-1 not-italic">诈唬</span>}
              {thought.confidence > 0 && (
                <span className="text-text-tertiary ml-1 not-italic">
                  {Math.round(thought.confidence * 100)}%
                </span>
              )}
            </div>
          )}
          <div className={`text-[14px] font-semibold mt-1.5 ${actionColor}`}>
            {actionLabel}
          </div>
        </div>
      );
    }

    case "pot-updated":
      return null;

    case "showdown":
      return (
        <div className="bg-white rounded-2xl p-4 my-2 shadow-sm">
          <div className="text-warning text-[13px] text-center mb-3 font-medium">SHOWDOWN</div>
          <div className="space-y-1.5">
            {event.results.map((r) => (
              <div key={r.playerId} className="flex items-center text-[14px]">
                <AgentTag id={r.playerId} lookup={lookup} />
                <span className="ml-1.5"><CardsInline cards={r.holeCards} /></span>
                <span className="text-text-secondary ml-1.5">· {r.handName}</span>
              </div>
            ))}
          </div>
        </div>
      );

    case "player-eliminated":
      return (
        <div className="text-center my-4">
          <span className="text-danger text-[13px] bg-danger/10 px-4 py-1.5 rounded-full">
            <AgentTag id={event.playerId} lookup={lookup} /> 第{event.finishPosition}名淘汰
          </span>
        </div>
      );

    case "blind-level-up":
      return (
        <div className="text-center my-4">
          <span className="text-warning text-[13px] bg-warning/10 px-4 py-1.5 rounded-full font-medium">
            盲注升级 {event.smallBlind}/{event.bigBlind}
          </span>
        </div>
      );

    case "tournament-complete":
      return (
        <div className="bg-white rounded-2xl my-4 mx-1 p-5 shadow-sm">
          <div className="text-center mb-4">
            <div className="text-[20px] font-semibold text-text-primary">锦标赛结束</div>
          </div>
          <div className="space-y-2">
            {event.rankings.map((r) => {
              const medal = r.position === 1 ? "🥇" : r.position === 2 ? "🥈" : r.position === 3 ? "🥉" : "";
              return (
                <div key={r.playerId} className="text-[14px] text-center">
                  <span className="text-text-secondary">{medal || `#${r.position}`} </span>
                  <AgentTag id={r.playerId} lookup={lookup} />
                </div>
              );
            })}
          </div>
          <div className="text-[13px] text-text-tertiary text-center mt-4">
            共 {event.rankings[0]?.handsPlayed ?? 0} 手
          </div>
        </div>
      );

    case "hand-highlight":
      return (
        <div className="text-center my-2">
          <span className="text-[12px] text-text-tertiary">— 精彩时刻 —</span>
        </div>
      );

    case "hand-complete": {
      return (
        <div className="text-[13px] mt-1 mb-4 mx-1 flex flex-wrap gap-x-4 gap-y-1">
          {event.players.map((p) => {
            const info = lookup.get(p.id);
            const before = chipsBeforeHand.get(p.id) ?? p.chips;
            const net = p.chips - before;
            const netColor = net > 0 ? "text-success" : net < 0 ? "text-danger" : "text-text-tertiary";
            return (
              <span key={p.id} className="text-text-secondary">
                {info?.avatar ?? "🤖"} {info?.name ?? p.id} {p.chips}
                {net !== 0 && (
                  <span className={`${netColor} ml-0.5`}>
                    ({net > 0 ? `+${net}` : `${net}`})
                  </span>
                )}
              </span>
            );
          })}
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
  blindInfo?: BlindInfo;
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

  const visibleEvents = useMemo(() => {
    const filtered = events.filter(
      (e) => e.type !== "action-required" && e.type !== "agent-roster"
    );
    const highlights = filtered.filter((e) => e.type === "hand-highlight");
    if (highlights.length === 0) return filtered;

    const withoutHighlights = filtered.filter((e) => e.type !== "hand-highlight");
    const result: GameEvent[] = [];
    let currentHandNumber = 0;
    const placed = new Set<GameEvent>();

    for (const event of withoutHighlights) {
      if (event.type === "hand-start") {
        currentHandNumber = event.handNumber;
      }
      result.push(event);
      if (event.type === "hand-complete") {
        for (const h of highlights) {
          if (h.type === "hand-highlight" && h.handNumber === currentHandNumber && !placed.has(h)) {
            result.push(h);
            placed.add(h);
          }
        }
      }
    }
    for (const h of highlights) {
      if (!placed.has(h)) result.push(h);
    }
    return result;
  }, [events]);

  const contexts = useMemo(() => {
    const result: AccumulatedContext[] = [];
    let chipsBeforeHand = new Map<string, number>();
    let holeCards = new Map<string, Card[]>();
    let communityCards: Card[] = [];
    let currentChips = new Map<string, number>();
    let blindInfo: BlindInfo | undefined;

    for (const event of visibleEvents) {
      if (event.type === "hand-start") {
        chipsBeforeHand = new Map(event.players.map((p) => [p.id, p.chips]));
        currentChips = new Map(event.players.map((p) => [p.id, p.chips]));
        holeCards = new Map();
        communityCards = [];
        blindInfo = undefined;
      }
      if (event.type === "blinds-posted") {
        blindInfo = {
          smallBlindPlayerId: event.smallBlindPlayerId,
          bigBlindPlayerId: event.bigBlindPlayerId,
          smallBlind: event.smallBlind,
          bigBlind: event.bigBlind,
        };
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
      result.push({ chipsBeforeHand, holeCards, communityCards, currentChips: new Map(currentChips), blindInfo });
    }
    return result;
  }, [visibleEvents]);

  const groupedEvents = useMemo(() => {
    const groups: Array<{ event: GameEvent; index: number; potTotal?: number; netProfits?: Map<string, number> }> = [];
    for (let i = 0; i < visibleEvents.length; i++) {
      const event = visibleEvents[i];
      if (event.type === "pot-updated") {
        const prev = groups[groups.length - 1];
        if (prev && prev.event.type === "action-taken") {
          prev.potTotal = event.pots.reduce((s, p) => s + p.amount, 0);
          continue;
        }
      }
      if (event.type === "hand-complete") {
        const prev = groups[groups.length - 1];
        if (prev && prev.event.type === "showdown") {
          const cbh = contexts[prev.index].chipsBeforeHand;
          const nets = new Map<string, number>();
          for (const p of event.players) {
            const before = cbh.get(p.id) ?? p.chips;
            const net = p.chips - before;
            if (net !== 0) nets.set(p.id, net);
          }
          prev.netProfits = nets;
        }
      }
      groups.push({ event, index: i });
    }
    return groups;
  }, [visibleEvents, contexts]);

  return (
    <div className="flex-1 overflow-y-auto px-3 py-3 text-[14px] leading-relaxed overscroll-contain bg-surface-elevated">
      {visibleEvents.length === 0 && (
        <div className="text-text-tertiary text-center mt-20 text-[15px]">
          等待比赛开始...
        </div>
      )}
      {groupedEvents.map(({ event, index, potTotal, netProfits }) => (
        <EventLine
          key={index}
          event={event}
          ctx={{
            lookup,
            chipsBeforeHand: contexts[index].chipsBeforeHand,
            holeCards: contexts[index].holeCards,
            communityCards: contexts[index].communityCards,
            currentChips: contexts[index].currentChips,
            potTotal,
            blindInfo: contexts[index].blindInfo,
            netProfits,
          }}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
