"use client";

import type { GameEvent } from "@cybercasino/shared";

interface PixelTableViewProps {
  events: GameEvent[];
}

export function PixelTableView({ events }: PixelTableViewProps) {
  return (
    <div className="flex-1 flex items-center justify-center text-text-secondary text-sm">
      PixelTableView 占位 · {events.length} events
    </div>
  );
}