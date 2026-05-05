"use client";

export type TabId = "live" | "highlights" | "leaderboard";

interface TabBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  hasNewHighlight: boolean;
}

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "live", label: "实时直播", icon: "🔴" },
  { id: "highlights", label: "精彩解说", icon: "🎬" },
  { id: "leaderboard", label: "排行榜", icon: "🏆" },
];

export function TabBar({ activeTab, onTabChange, hasNewHighlight }: TabBarProps) {
  return (
    <div className="flex border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`flex-1 py-3 px-3 text-sm font-medium transition-all relative min-h-[44px] ${
            activeTab === tab.id
              ? "text-cyan-400 border-b-2 border-cyan-400 bg-cyan-950/20"
              : "text-gray-500 hover:text-gray-300 border-b-2 border-transparent"
          }`}
        >
          <span className="mr-1">{tab.icon}</span>
          {tab.label}
          {tab.id === "highlights" && hasNewHighlight && activeTab !== "highlights" && (
            <span className="absolute top-2 right-1/4 w-2 h-2 bg-fuchsia-500 rounded-full animate-pulse" />
          )}
        </button>
      ))}
    </div>
  );
}
