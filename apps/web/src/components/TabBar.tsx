"use client";

export type TabId = "live" | "highlights" | "leaderboard";

interface TabBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  hasNewHighlight: boolean;
}

const TABS: { id: TabId; label: string }[] = [
  { id: "live", label: "直播" },
  { id: "highlights", label: "精彩" },
  { id: "leaderboard", label: "排行" },
];

export function TabBar({ activeTab, onTabChange, hasNewHighlight }: TabBarProps) {
  return (
    <div className="flex items-center justify-center px-4 py-2.5 bg-white/80 backdrop-blur-xl">
      <div className="flex bg-surface-elevated rounded-lg p-0.5 w-full max-w-sm">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex-1 relative py-2 px-3 text-[13px] font-medium rounded-md transition-all min-h-[36px] ${
              activeTab === tab.id
                ? "bg-white text-text-primary shadow-sm"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {tab.label}
            {tab.id === "highlights" && hasNewHighlight && activeTab !== "highlights" && (
              <span className="absolute top-1.5 right-3 w-1.5 h-1.5 bg-accent rounded-full" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
