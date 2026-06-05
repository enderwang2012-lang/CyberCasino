"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { GameEvent } from "@cybercasino/shared";
import { PixiStage } from "./stage/PixiStage";
import { Table } from "./stage/Table";
import { PotDisplay } from "./stage/PotDisplay";
import { CommunityCards } from "./stage/CommunityCards";
import { Seat } from "./stage/Seat";
import { eventsToTableState } from "./logic/events-to-state";
import { computeSeatPositions, computeTableEllipse } from "./logic/seat-layout";
import { createBubbleScheduler } from "./logic/animation-scheduler";
import { pickEmoji, type EmojiKind } from "./logic/emoji-pool";

interface PixelTableViewProps {
  events: GameEvent[];
}

type ActionTakenEvent = Extract<GameEvent, { type: "action-taken" }>;

function mapActionToKind(e: ActionTakenEvent): EmojiKind {
  if (e.action.type === "fold") return "fold";
  if (e.action.type === "check") return "check";
  if (e.action.type === "call") return "call";
  if (e.allIn) return "all-in";
  return "raise";
}

export function PixelTableView({ events }: PixelTableViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dim, setDim] = useState({ width: 360, height: 480 });
  const [bubbles, setBubbles] = useState<Record<string, string>>({});
  const recentRef = useRef<Record<string, string[]>>({});
  const lastEventIndexRef = useRef(-1);
  const schedulerRef = useRef<ReturnType<typeof createBubbleScheduler> | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setDim({ width: Math.max(280, Math.floor(r.width)), height: Math.max(360, Math.floor(r.height)) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const state = useMemo(() => eventsToTableState(events), [events]);
  const seatPositions = useMemo(() => computeSeatPositions(dim), [dim]);
  const ellipse = useMemo(() => computeTableEllipse(dim), [dim]);

  // 气泡调度器
  useEffect(() => {
    schedulerRef.current = createBubbleScheduler(800, (pid, emoji) => {
      setBubbles((b) => ({ ...b, [pid]: emoji }));
      setTimeout(() => setBubbles((b) => {
        if (b[pid] !== emoji) return b;
        const { [pid]: _, ...rest } = b;
        return rest;
      }), 2400);
    });
    return () => schedulerRef.current?.dispose();
  }, []);

  // 监听新增事件 → 触发 emoji
  useEffect(() => {
    const sched = schedulerRef.current;
    if (!sched) return;
    for (let i = lastEventIndexRef.current + 1; i < events.length; i++) {
      const e = events[i];
      if (e.type === "action-taken") {
        const kind = mapActionToKind(e);
        const recent = recentRef.current[e.playerId] ?? [];
        const emoji = pickEmoji(kind, recent);
        if (emoji) {
          recentRef.current[e.playerId] = [emoji, ...recent].slice(0, 3);
          sched.request(e.playerId, emoji);
        }
      } else if (e.type === "hand-complete") {
        e.winners.forEach((w) => {
          const recent = recentRef.current[w.playerId] ?? [];
          const emoji = pickEmoji("win", recent);
          if (emoji) {
            recentRef.current[w.playerId] = [emoji, ...recent].slice(0, 3);
            sched.request(w.playerId, emoji);
          }
        });
      }
    }
    lastEventIndexRef.current = events.length - 1;
  }, [events]);

  // idle 概率：每 8s 为活跃/思考中玩家随机表情
  useEffect(() => {
    const interval = setInterval(() => {
      const sched = schedulerRef.current;
      if (!sched) return;
      state.seats.forEach((s) => {
        if (s.status !== "active" && s.status !== "thinking") return;
        const recent = recentRef.current[s.playerId] ?? [];
        const emoji = pickEmoji("idle", recent);
        if (emoji) {
          recentRef.current[s.playerId] = [emoji, ...recent].slice(0, 3);
          sched.request(s.playerId, emoji);
        }
      });
    }, 8000);
    return () => clearInterval(interval);
  }, [state.seats]);

  const placedSeats = state.seats.map((seat) => ({
    seat,
    pos: seatPositions[seat.seatIndex] ?? seatPositions[0],
    bubble: bubbles[seat.playerId] ?? null,
  }));

  return (
    <div ref={containerRef} className="flex-1 flex items-center justify-center bg-surface-elevated relative">
      <PixiStage width={dim.width} height={dim.height}>
        <Table dim={dim} />
        <PotDisplay
          amount={state.potTotal}
          x={ellipse.cx}
          y={ellipse.cy - ellipse.ry - 14}
          flash={isAllInFlashing(state.allInFlashAt)}
        />
        <CommunityCards cards={state.communityCards} cx={ellipse.cx} cy={ellipse.cy} />
        {placedSeats.map(({ seat, pos, bubble }) => (
          <Seat key={seat.playerId} seat={seat} x={pos.x} y={pos.y} bubble={bubble} />
        ))}
      </PixiStage>
    </div>
  );
}

function isAllInFlashing(at: number | null): boolean {
  if (at == null) return false;
  return Date.now() - at < 1500;
}