"use client";

import { useState, useEffect, useRef } from "react";
import type { GameEvent } from "@cybercasino/shared";
import { TabBar, type TabId } from "./TabBar";
import { HighlightFeed } from "./HighlightFeed";
import { Leaderboard } from "./Leaderboard";
import { PixelTableView } from "./PixelTable/PixelTableView";
import { useLanguage } from "@/contexts/LanguageContext";
import { useHeader } from "@/contexts/HeaderContext";

type LiveSubTab = "live" | "text";

interface TableViewProps {
  tableId: string;
  tableName?: string;
  events: GameEvent[];
  onLeave: () => void;
  defaultTab?: TabId;
  isFinished?: boolean;
}

export function TableView({ tableId, tableName, events, onLeave, defaultTab = "highlights", isFinished = false }: TableViewProps) {
  const { t } = useLanguage();
  const { setVisible } = useHeader();
  const [replayCopied, setReplayCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>(defaultTab);
  const [liveSubTab, setLiveSubTab] = useState<LiveSubTab>("live");
  const [hasNewHighlight, setHasNewHighlight] = useState(false);
  const lastHighlightCount = useRef(0);

  useEffect(() => {
    setVisible(false);
    return () => setVisible(true);
  }, [setVisible]);

  useEffect(() => {
    const count = events.filter((e) => e.type === "hand-highlight").length;
    if (count > lastHighlightCount.current && activeTab !== "highlights") {
      setHasNewHighlight(true);
    }
    lastHighlightCount.current = count;
  }, [events, activeTab]);

  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab);
    if (tab === "highlights") setHasNewHighlight(false);
  };

  return (
    <div className="h-[100dvh] flex flex-col bg-surface-elevated">
      {/* ① 系统状态栏 + 顶部导航（延用现有样式） */}
      <header className="shrink-0 flex items-center justify-between px-5 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] bg-white/80 backdrop-blur-xl border-b border-separator z-20">
        <button
          onClick={onLeave}
          className="text-accent text-[15px] font-normal min-w-[44px] min-h-[44px] flex items-center"
        >
          {t("common.back")}
        </button>
        <h2 className="text-text-primary text-[17px] font-semibold tracking-tight">
          {tableName || "CyberCasino"}
        </h2>
        {isFinished ? (
          <button
            onClick={() => {
              const url = `${window.location.origin}/api/replay/${tableId}`;
              navigator.clipboard.writeText(url).then(() => {
                setReplayCopied(true);
                setTimeout(() => setReplayCopied(false), 2000);
              });
            }}
            className="text-accent text-[13px] font-medium min-h-[44px] flex items-center justify-end active:scale-95 transition-transform"
          >
            {replayCopied ? t("chatFeed.replayCopied") : t("chatFeed.shareReplay")}
          </button>
        ) : (
          <div className="text-success text-[13px] min-w-[44px] text-right font-medium">{t("lobby.playing")}</div>
        )}
      </header>

      {/* ② 一级 Tab：集锦 / 排行榜 */}
      <div className="shrink-0 border-b border-separator">
        <TabBar activeTab={activeTab} onTabChange={handleTabChange} hasNewHighlight={hasNewHighlight} showReplay={isFinished} />
      </div>

      {/* ③ 二级 Tab：仅在集锦 tab 下，实况 / 文字 */}
      {activeTab === "highlights" && (
        <div className="shrink-0 flex justify-center py-2 bg-white/60">
          <div className="inline-flex bg-surface-elevated rounded-lg p-0.5 text-[12px]">
            <button
              onClick={() => setLiveSubTab("live")}
              className={`px-4 py-1.5 rounded-md transition-all ${
                liveSubTab === "live" ? "bg-white shadow-sm font-semibold text-text-primary" : "text-text-secondary"
              }`}
            >
              📺 {t("tableView.subLive")}
            </button>
            <button
              onClick={() => setLiveSubTab("text")}
              className={`px-4 py-1.5 rounded-md transition-all ${
                liveSubTab === "text" ? "bg-white shadow-sm font-semibold text-text-primary" : "text-text-secondary"
              }`}
            >
              📝 {t("tableView.subText")}
            </button>
          </div>
        </div>
      )}

      {/* ④ 内容区 */}
      <div className="flex-1 min-h-0 relative">
        <div className={`absolute inset-0 flex flex-col ${activeTab === "highlights" && liveSubTab === "live" ? "" : "invisible pointer-events-none"}`}>
          <PixelTableView events={events} />
        </div>
        <div className={`absolute inset-0 flex flex-col ${activeTab === "highlights" && liveSubTab === "text" ? "" : "invisible pointer-events-none"}`}>
          <HighlightFeed events={events} />
        </div>
        <div className={`absolute inset-0 flex flex-col ${activeTab === "leaderboard" ? "" : "invisible pointer-events-none"}`}>
          <Leaderboard events={events} />
        </div>
      </div>
    </div>
  );
}