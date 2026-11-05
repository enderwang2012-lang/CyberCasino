"use client";

import { useEffect, useMemo, useState } from "react";
import type { Card, GamePhase } from "@cybercasino/shared";
import type { GameEvent } from "@cybercasino/shared";
import { useLanguage } from "@/contexts/LanguageContext";
import { eventsToTableState } from "../PixelTable/logic/events-to-state";
import type { SeatState } from "../PixelTable/logic/types";

const SUIT: Record<Card["suit"], { symbol: string; red: boolean }> = {
  s: { symbol: "♠", red: false },
  h: { symbol: "♥", red: true },
  d: { symbol: "♦", red: true },
  c: { symbol: "♣", red: false },
};

const RANK: Record<number, string> = {
  11: "J", 12: "Q", 13: "K", 14: "A",
};

const STREET: Record<GamePhase, { zh: string; en: string }> = {
  preflop: { zh: "翻牌前", en: "Preflop" },
  flop: { zh: "翻牌", en: "Flop" },
  turn: { zh: "转牌", en: "Turn" },
  river: { zh: "河牌", en: "River" },
  showdown: { zh: "摊牌", en: "Showdown" },
};

type CardSide = "above" | "left" | "right";

const SLOTS: Array<{
  className: string;
  cards: CardSide;
  bet: "before" | "after";
  dealer: "left" | "right";
}> = [
  { className: "top-[9%] left-1/2 z-10 -translate-x-1/2", cards: "above", bet: "after", dealer: "right" },
  { className: "top-[22%] left-[7%] z-10", cards: "left", bet: "after", dealer: "left" },
  { className: "top-[22%] right-[7%] z-10", cards: "right", bet: "after", dealer: "right" },
  { className: "top-[56%] left-[7%] z-10", cards: "left", bet: "before", dealer: "left" },
  { className: "top-[56%] right-[7%] z-10", cards: "right", bet: "before", dealer: "right" },
  { className: "bottom-[116px] left-1/2 z-10 -translate-x-1/2", cards: "above", bet: "before", dealer: "right" },
];

export function FeltTable({ events }: { events: GameEvent[] }) {
  const { language } = useLanguage();
  const zh = language === "zh";
  const state = useMemo(() => eventsToTableState(events), [events]);
  const thinkingSeconds = useThinkingSeconds(state.currentThinkerId, state.lastEventIndex);
  const history = useMemo(() => decisionHistory(events), [events]);
  const [handIndex, setHandIndex] = useState(0);
  useEffect(() => { setHandIndex(0); }, [events.length]);

  const seatsByIndex = new Map(state.seats.map((seat) => [seat.seatIndex, seat]));
  const street = state.phase === "idle" ? "" : STREET[state.phase][zh ? "zh" : "en"];
  const handLabel = state.handNumber > 0
    ? (zh ? `第 ${state.handNumber} 手` : `Hand ${state.handNumber}`)
    : "";
  const blinds = state.bigBlind > 0 ? `${state.smallBlind}/${state.bigBlind}` : "";

  return (
    <div className="relative mx-auto h-full w-full max-w-[420px] overflow-hidden bg-[#f7f7f8]">
      <div className="absolute left-[16%] top-[18%] h-[52%] w-[68%] rounded-[999px] bg-[#f3f4f6] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.04)]" />

      <div className="absolute left-1/2 top-[43%] z-10 flex w-[60%] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2">
        <div className="rounded-full border border-black/5 bg-white px-3 py-1 text-[12px] shadow-sm">
          <span className="text-neutral-400">{zh ? "底池 " : "Pot "}</span>
          <span className="font-semibold text-neutral-900">{state.potTotal.toLocaleString()}</span>
        </div>
        <div className="flex items-end gap-1.5">
          {Array.from({ length: 5 }).map((_, index) => (
            <FaceCard key={index} card={state.communityCards[index] ?? null} size="board" />
          ))}
        </div>
        <div className="text-[11px] font-medium tracking-wide text-neutral-400">
          {[handLabel, street, blinds].filter(Boolean).join("  ·  ")}
        </div>
      </div>

      {SLOTS.map((slot, index) => {
        const seat = seatsByIndex.get(index);
        if (!seat) return null;
        return (
          <SeatSlot
            key={seat.playerId}
            seat={seat}
            slot={slot}
            isDealer={seat.seatIndex === state.dealerSeatIndex}
            thinking={seat.playerId === state.currentThinkerId}
            thinkingSeconds={thinkingSeconds}
            winAmount={state.winners.filter((item) => item.playerId === seat.playerId).reduce((sum, item) => sum + item.amount, 0)}
            zh={zh}
          />
        );
      })}

      {state.seats.length === 0 && (
        <div className="absolute inset-0 grid place-items-center text-[14px] text-neutral-400">
          {zh ? "等待发牌" : "Waiting for a hand"}
        </div>
      )}

      <ThoughtStrip
        seat={history[handIndex] ?? null}
        index={handIndex}
        total={history.length}
        zh={zh}
        onPrev={() => setHandIndex((i) => Math.min(i + 1, history.length - 1))}
        onNext={() => setHandIndex((i) => Math.max(0, i - 1))}
        canPrev={handIndex < history.length - 1}
        canNext={handIndex > 0}
      />
    </div>
  );
}

function ThoughtStrip({
  seat, index, total, zh, onPrev, onNext, canPrev, canNext,
}: {
  seat: SeatState | null;
  index: number;
  total: number;
  zh: boolean;
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
}) {
  const thought = seat?.lastDecision?.thought?.message ?? "";
  return (
    <div className="absolute bottom-3 left-3 right-3 flex items-stretch gap-1.5">
      <PagerButton label="‹" onClick={onPrev} enabled={canPrev} />
      <div className="flex min-h-[92px] min-w-0 flex-1 flex-col justify-center rounded-2xl border border-black/5 bg-white px-3 py-2.5 shadow-sm">
        {seat ? (
          <>
            <div className="mb-1 flex items-center gap-2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-neutral-100 text-[15px]">{seat.avatar || "🤖"}</span>
              <span className="truncate text-[13px] font-semibold text-neutral-900">{seat.name}</span>
              <span className="ml-auto shrink-0 text-[11px] text-neutral-400">{index + 1}/{Math.max(1, total)}</span>
            </div>
            <p className="line-clamp-3 text-[13px] leading-snug text-neutral-500">
              {thought || (zh ? "等待出牌" : "Waiting for an action")}
            </p>
          </>
        ) : (
          <p className="text-center text-[13px] text-neutral-400">{zh ? "等待出牌" : "Waiting for an action"}</p>
        )}
      </div>
      <PagerButton label="›" onClick={onNext} enabled={canNext} />
    </div>
  );
}

function PagerButton({ label, onClick, enabled }: { label: string; onClick: () => void; enabled: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={!enabled}
      className={`grid w-7 shrink-0 place-items-center rounded-xl text-[18px] ${
        enabled ? "bg-white text-neutral-500 shadow-sm" : "bg-white/60 text-neutral-300"
      }`}
    >
      {label}
    </button>
  );
}

function SeatSlot({
  seat, slot, isDealer, thinking, thinkingSeconds, winAmount, zh,
}: {
  seat: SeatState;
  slot: { className: string; cards: CardSide; bet: "before" | "after"; dealer: "left" | "right" };
  isDealer: boolean;
  thinking: boolean;
  thinkingSeconds: number;
  winAmount: number;
  zh: boolean;
}) {
  const folded = seat.status === "folded" || seat.status === "out";
  const cards = <HolePair cards={seat.holeCards} hidden={!seat.holeCards && !folded} folded={folded} />;
  const action = actionLabel(seat, zh, winAmount);
  const bet = action ? (
    <div className={`text-[11px] font-medium leading-none ${action.tone}`}>{action.text}</div>
  ) : null;
  const capsule = (
    <div className="relative">
      <div className={`flex items-center gap-2 rounded-full border bg-white py-1 pl-1 pr-3 shadow-sm ${
        thinking ? "border-sky-400 ring-2 ring-sky-400" : winAmount > 0 ? "border-emerald-400 ring-2 ring-emerald-300" : "border-black/5"
      } ${folded ? "opacity-40" : ""}`}>
        <span className="grid h-8 w-8 place-items-center rounded-full bg-neutral-100 text-[16px]">{seat.avatar || "🤖"}</span>
        <span className="min-w-0">
          <span className="block max-w-[96px] truncate text-[13px] font-semibold leading-tight text-neutral-900">{seat.name}</span>
          <span className="block text-[11px] leading-tight text-neutral-500">{seat.chips.toLocaleString()}</span>
        </span>
      </div>
      {isDealer && (
        <span className={`absolute top-1/2 grid h-[18px] w-[18px] -translate-y-1/2 place-items-center rounded-full bg-neutral-900 text-[9px] font-bold text-white ${
          slot.dealer === "left" ? "-left-2" : "-right-2"
        }`}>D</span>
      )}
    </div>
  );
  const thinkingLine = thinking ? (
    <div className="text-[11px] text-neutral-500">
      {zh ? "思考中" : "Thinking"}{thinkingSeconds > 0 ? ` · ${thinkingSeconds}s` : ""}
    </div>
  ) : null;
  const vertical = slot.cards === "above";
  const person = (
    <div className={`flex items-center ${vertical ? "flex-col gap-1" : "flex-col items-center"}`}>
      {vertical ? cards : null}
      {capsule}
      {thinkingLine}
    </div>
  );
  const seatBlock = vertical ? person : (
    <div className={`flex items-center gap-1 ${slot.cards === "right" ? "flex-row-reverse" : ""}`}>
      {cards}
      {person}
    </div>
  );

  return (
    <div className={`absolute flex flex-col items-center gap-1 ${slot.className}`}>
      {slot.bet === "before" ? bet : null}
      {seatBlock}
      {slot.bet === "after" ? bet : null}
    </div>
  );
}

function actionLabel(seat: SeatState, zh: boolean, winAmount: number): { text: string; tone: string } | null {
  if (winAmount > 0) return { text: `${zh ? "赢得" : "Won"} ${winAmount.toLocaleString()}`, tone: "text-emerald-600" };
  if (seat.status === "out") return { text: zh ? "出局" : "Out", tone: "text-neutral-400" };
  const decision = seat.lastDecision;
  if (decision?.action === "fold" || seat.status === "folded") return { text: zh ? "弃牌" : "Fold", tone: "text-neutral-400" };
  if (seat.status === "all-in") {
    const amount = decision?.amount ?? seat.currentBet;
    return { text: amount > 0 ? `${zh ? "全下" : "All-in"} ${amount.toLocaleString()}` : (zh ? "全下" : "All-in"), tone: "text-amber-700" };
  }
  if (decision?.action === "check") return { text: zh ? "过牌" : "Check", tone: "text-neutral-500" };
  if (decision?.action === "raise" && decision.amount && decision.amount > 0) {
    return { text: `${zh ? "加注" : "Raise"} ${decision.amount.toLocaleString()}`, tone: "text-neutral-600" };
  }
  if (decision?.action === "call" && (decision.amount ?? seat.currentBet) > 0) {
    return { text: `${zh ? "跟注" : "Call"} ${(decision.amount ?? seat.currentBet).toLocaleString()}`, tone: "text-neutral-600" };
  }
  if (seat.currentBet > 0) return { text: `${zh ? "盲注" : "Blind"} ${seat.currentBet.toLocaleString()}`, tone: "text-neutral-500" };
  return null;
}

function HolePair({ cards, hidden, folded }: { cards: Card[] | null; hidden: boolean; folded: boolean }) {
  if (folded) return null;
  return (
    <div className="flex -space-x-1">
      {hidden ? (
        <>
          <CardBack />
          <CardBack />
        </>
      ) : (
        <>
          <FaceCard card={cards?.[0] ?? null} size="hole" />
          <FaceCard card={cards?.[1] ?? null} size="hole" />
        </>
      )}
    </div>
  );
}

function FaceCard({ card, size }: { card: Card | null; size: "board" | "hole" }) {
  const box = size === "board" ? "h-[52px] w-[38px] text-[15px]" : "h-[36px] w-[26px] text-[12px]";
  if (!card) return <CardBack className={box} />;
  const suit = SUIT[card.suit];
  const rank = RANK[card.rank] ?? String(card.rank);
  return (
    <div className={`${box} flex flex-col items-center justify-center rounded-[8px] border border-black/10 bg-white shadow-sm ${suit.red ? "text-red-500" : "text-neutral-900"}`}>
      <span className="font-semibold leading-none">{rank}</span>
      <span className="leading-none">{suit.symbol}</span>
    </div>
  );
}

function CardBack({ className = "h-[36px] w-[26px]" }: { className?: string }) {
  return (
    <div className={`${className} grid place-items-center rounded-[8px] border border-black/10 bg-white shadow-sm`}>
      <span className="h-3.5 w-3.5 rounded-full border border-neutral-300" />
    </div>
  );
}

function useThinkingSeconds(playerId: string | null, eventIndex: number): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!playerId) {
      setSeconds(0);
      return;
    }
    const started = Date.now();
    setSeconds(0);
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [playerId, eventIndex]);
  return seconds;
}

function decisionHistory(events: GameEvent[]): SeatState[] {
  const history: SeatState[] = [];
  for (let i = events.length - 1; i >= 0 && history.length < 50; i--) {
    const event = events[i];
    if (event.type !== "action-taken" && event.type !== "hand-complete") continue;
    const partial = eventsToTableState(events.slice(0, i + 1));
    if (event.type === "action-taken") {
      const seat = partial.seats.find((item) => item.playerId === event.playerId);
      if (seat) history.push(seat);
    }
  }
  return history;
}
