"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GameEvent } from "@cybercasino/shared";
import { PixiStage } from "./stage/PixiStage";
import { Table } from "./stage/Table";
import { PotDisplay } from "./stage/PotDisplay";
import { CommunityCards } from "./stage/CommunityCards";
import { Seat } from "./stage/Seat";
import { eventsToTableState } from "./logic/events-to-state";
import { computeSeatPositions, computeTableEllipse } from "./logic/seat-layout";

interface PixelTableViewProps {
  events: GameEvent[];
}

export function PixelTableView({ events }: PixelTableViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dim, setDim] = useState({ width: 360, height: 480 });

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

  const placedSeats = state.seats.map((seat) => ({
    seat,
    pos: seatPositions[seat.seatIndex] ?? seatPositions[0],
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
        {placedSeats.map(({ seat, pos }) => (
          <Seat key={seat.playerId} seat={seat} x={pos.x} y={pos.y} />
        ))}
      </PixiStage>
    </div>
  );
}

function isAllInFlashing(at: number | null): boolean {
  if (at == null) return false;
  return Date.now() - at < 1500;
}