"use client";

import { useState, useEffect, useRef } from "react";
import type { GameEvent } from "@cybercasino/shared";
import { ChatFeed } from "./ChatFeed";
import { TabBar, type TabId } from "./TabBar";
import { HighlightFeed } from "./HighlightFeed";
import { Leaderboard } from "./Leaderboard";

interface TableViewProps {
  tableId: string;
  events: GameEvent[];
  onLeave: () => void;
}

export function TableView({ tableId, events, onLeave }: TableViewProps) {
  const [activeTab, setActiveTab] = useState<TabId>("live");
  const [hasNewHighlight, setHasNewHighlight] = useState(false);
  const lastHighlightCount = useRef(0);

  useEffect(() => {
    const count = events.filter((e) => e.type === "hand-highlight").length;
    if (count > lastHighlightCount.current && activeTab !== "highlights") {
      setHasNewHighlight(true);
    }
    lastHighlightCount.current = count;
  }, [events, activeTab]);

  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab);
    if (tab === "highlights") {
      setHasNewHighlight(false);
    }
  };

  return (
    <div className="h-[100dvh] flex flex-col">
      <header className="shrink-0 flex items-center justify-between px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] border-b border-gray-800 bg-gray-950 z-20">
        <button
          onClick={onLeave}
          className="text-gray-500 hover:text-cyan-400 text-sm transition-colors min-w-[44px] min-h-[44px] flex items-center"
        >
          ← Back
        </button>
        <h2 className="text-cyan-400 text-sm font-bold tracking-wider">
          CYBER<span className="text-fuchsia-500">CASINO</span>
        </h2>
        <div className="text-green-500 text-xs min-w-[44px] text-right">● LIVE</div>
      </header>

      <div className="shrink-0">
        <TabBar activeTab={activeTab} onTabChange={handleTabChange} hasNewHighlight={hasNewHighlight} />
      </div>

      <div className="flex-1 min-h-0 relative">
        <div className={`absolute inset-0 flex flex-col ${activeTab === "live" ? "" : "invisible pointer-events-none"}`}>
          <ChatFeed events={events} />
        </div>
        <div className={`absolute inset-0 flex flex-col ${activeTab === "highlights" ? "" : "invisible pointer-events-none"}`}>
          <HighlightFeed events={events} />
        </div>
        <div className={`absolute inset-0 flex flex-col ${activeTab === "leaderboard" ? "" : "invisible pointer-events-none"}`}>
          <Leaderboard events={events} />
        </div>
      </div>
    </div>
  );
}
