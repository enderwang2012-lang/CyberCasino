"use client";

import type { GameEvent } from "@cybercasino/shared";
import { ChatFeed } from "./ChatFeed";

interface TableViewProps {
  tableId: string;
  events: GameEvent[];
  onLeave: () => void;
  onStop?: () => void;
}

export function TableView({ tableId, events, onLeave, onStop }: TableViewProps) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
        <button
          onClick={onLeave}
          className="text-gray-500 hover:text-cyan-400 text-sm transition-colors"
        >
          ← Back
        </button>
        <h2 className="text-cyan-400 text-sm font-bold tracking-wider">
          CYBER<span className="text-fuchsia-500">CASINO</span>
          <span className="text-gray-500 ml-2">· {tableId}</span>
        </h2>
        <div className="flex items-center gap-3">
          {onStop && (
            <button
              onClick={onStop}
              className="text-red-500 hover:text-red-400 text-xs transition-colors"
            >
              Stop
            </button>
          )}
          <div className="text-green-500 text-xs">● LIVE</div>
        </div>
      </header>

      <ChatFeed events={events} />
    </div>
  );
}
