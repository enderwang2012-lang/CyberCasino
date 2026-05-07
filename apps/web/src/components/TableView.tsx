"use client";

import { useState, useEffect, useRef } from "react";
import type { GameEvent } from "@cybercasino/shared";
import { ChatFeed } from "./ChatFeed";
import { TabBar, type TabId } from "./TabBar";
import { HighlightFeed } from "./HighlightFeed";
import { Leaderboard } from "./Leaderboard";

interface TableViewProps {
  tableId: string;
  tableName?: string;
  events: GameEvent[];
  onLeave: () => void;
  defaultTab?: TabId;
  isFinished?: boolean;
}

export function TableView({ tableId, tableName, events, onLeave, defaultTab = "live", isFinished = false }: TableViewProps) {
  const [activeTab, setActiveTab] = useState<TabId>(defaultTab);
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
    <div className="h-[100dvh] flex flex-col bg-surface-elevated">
      <header className="shrink-0 flex items-center justify-between px-5 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] bg-white/80 backdrop-blur-xl border-b border-separator z-20">
        <button
          onClick={onLeave}
          className="text-accent text-[15px] font-normal min-w-[44px] min-h-[44px] flex items-center"
        >
          ‹ 返回
        </button>
        <h2 className="text-text-primary text-[17px] font-semibold tracking-tight">
          {tableName || "CyberCasino"}
        </h2>
        {isFinished ? (
          <div className="text-text-tertiary text-[13px] min-w-[44px] text-right font-medium">已结束</div>
        ) : (
          <div className="text-success text-[13px] min-w-[44px] text-right font-medium">● LIVE</div>
        )}
      </header>

      <div className="shrink-0 border-b border-separator">
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
