"use client";

import { useState } from "react";
import type { AgentConfigV2 } from "@cybercasino/shared";
import { useLanguage } from "@/contexts/LanguageContext";

function getServerUrl() {
  if (process.env.NEXT_PUBLIC_SERVER_URL) {
    const url = process.env.NEXT_PUBLIC_SERVER_URL;
    return url.startsWith("http") ? url : `https://${url}`;
  }
  return "http://localhost:3001";
}

interface AgentListPageProps {
  agents: AgentConfigV2[];
  onBack: () => void;
  onCreateNew: () => void;
}

export function AgentListPage({ agents, onBack, onCreateNew }: AgentListPageProps) {
  const { language } = useLanguage();
  const isZh = language === "zh";
  const [copiedId, setCopiedId] = useState<string | null>(null);

  function getSoulUrl(agentId: string, userId: string) {
    const baseUrl = getServerUrl();
    return `${baseUrl}/api/agents/soul/user-${userId}`;
  }

  function handleCopy(agentId: string, userId: string) {
    const url = getSoulUrl(agentId, userId);
    navigator.clipboard.writeText(url);
    setCopiedId(agentId);
    setTimeout(() => setCopiedId(null), 2000);
  }

  return (
    <div className="min-h-[100dvh] flex flex-col items-center p-6 pt-[max(3rem,env(safe-area-inset-top))] bg-surface-elevated">
      <button
        onClick={onBack}
        className="self-start text-accent text-[15px] min-h-[44px] flex items-center mb-4"
      >
        {isZh ? "← 返回" : "← Back"}
      </button>

      <div className="w-full max-w-md">
        <h2 className="text-[24px] font-semibold text-text-primary mb-1 tracking-tight">
          {isZh ? "我的牌手" : "My Players"}
        </h2>
        <p className="text-text-secondary text-[15px] mb-6">
          {isZh ? "复制「灵魂」链接发给 AI 助手来塑造你的牌手" : "Copy the Soul link and send it to your AI assistant"}
        </p>

        {agents.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-text-tertiary text-[15px] mb-4">
              {isZh ? "还没有创建牌手" : "No players created yet"}
            </p>
            <button
              onClick={onCreateNew}
              className="bg-accent hover:bg-accent-hover text-white px-6 py-3 rounded-full font-medium text-[15px] transition-colors"
            >
              {isZh ? "创建第一个牌手" : "Create Your First Player"}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {agents.map((agent) => (
              <div key={agent.id} className="bg-white rounded-2xl p-5 shadow-sm">
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-[36px]">{agent.avatar}</span>
                  <div className="flex-1">
                    <div className="text-text-primary text-[18px] font-semibold">{agent.name}</div>
                    <div className="text-text-secondary text-[13px]">{agent.description ?? ""}</div>
                  </div>
                </div>

                <div className="border-t border-surface-elevated pt-4">
                  <div className="text-text-tertiary text-[12px] font-medium mb-2 uppercase tracking-wide">
                    {isZh ? "「灵魂」链接" : "Soul Link"}
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <code className="flex-1 bg-surface-elevated rounded-xl px-4 py-3 text-[12px] font-mono break-all">
                      {getSoulUrl(agent.id, agent.userId)}
                    </code>
                    <button
                      onClick={() => handleCopy(agent.id, agent.userId)}
                      className="shrink-0 bg-accent hover:bg-accent-hover text-white px-4 py-3 rounded-xl text-[13px] font-medium transition-colors"
                    >
                      {copiedId === agent.id
                        ? (isZh ? "已复制" : "Copied")
                        : (isZh ? "复制" : "Copy")}
                    </button>
                  </div>
                  <p className="text-text-secondary text-[13px]">
                    {isZh
                      ? "把链接发给 AI 助手，让他/她协助你塑造牌手的灵魂"
                      : "Send this link to your AI assistant to help shape your player's soul."}
                  </p>
                </div>
              </div>
            ))}

            <button
              onClick={onCreateNew}
              className="w-full bg-accent hover:bg-accent-hover text-white py-3.5 rounded-full font-medium text-[17px] transition-colors"
            >
              {isZh ? "新建牌手" : "Create New Player"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
