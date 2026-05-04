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
    <div className="h-screen flex flex-col">
      <header className="sticky top-0 z-20 flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-950">
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
        <div className="text-green-500 text-xs">● LIVE</div>
      </header>

      <TabBar activeTab={activeTab} onTabChange={handleTabChange} hasNewHighlight={hasNewHighlight} />

      <div className="flex-1 overflow-hidden relative flex flex-col">
        <div className={`flex-1 flex flex-col ${activeTab === "live" ? "" : "hidden"}`}>
          <ChatFeed events={events} />
        </div>
        <div className={`flex-1 flex flex-col ${activeTab === "highlights" ? "" : "hidden"}`}>
          <HighlightFeed events={events} />
        </div>
        <div className={`flex-1 flex flex-col ${activeTab === "leaderboard" ? "" : "hidden"}`}>
          <Leaderboard events={events} />
        </div>
      </div>
    </div>
  );
}
