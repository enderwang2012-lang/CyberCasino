"use client";

import { useState, useEffect, useRef } from "react";
import type { AgentConfigV2 } from "@cybercasino/shared";
import { useLanguage } from "@/contexts/LanguageContext";

const POLL_INTERVAL = 2000;
const EMOJI_OPTIONS = ["🤖","🎭","🦊","🦈","👻","🐍","🍣","📖","🔥","💀","🐉","🃏","🎯","🧠","⚡","🌟","💎","🎪","🦅","🐺","🐱","🦉","🎲","🍀"];

function getServerUrl() {
  if (process.env.NEXT_PUBLIC_SERVER_URL) {
    const url = process.env.NEXT_PUBLIC_SERVER_URL;
    return url.startsWith("http") ? url : `https://${url}`;
  }
  return "http://localhost:3001";
}

interface AgentListPageProps {
  agents: AgentConfigV2[];
  userId: string;
  onBack: () => void;
  onAgentCreated: () => void;
}

export function AgentListPage({ agents, userId, onBack, onAgentCreated }: AgentListPageProps) {
  const { language } = useLanguage();
  const isZh = language === "zh";
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // ── Inline creation state ──
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("🤖");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [soulUrl, setSoulUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function getSoulUrl(agent: AgentConfigV2) {
    if (agent.soulKey) {
      return `${getServerUrl()}/api/agents/soul/${agent.soulKey}`;
    }
    return `${getServerUrl()}/api/agents/soul/user-${agent.userId}`;
  }

  function handleCopy(agent: AgentConfigV2) {
    const url = getSoulUrl(agent);
    navigator.clipboard.writeText(url);
    setCopiedId(agent.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  // ── Poll for agent creation after soul generation ──
  useEffect(() => {
    if (!soulUrl) return;
    setPolling(true);

    async function check() {
      try {
        const res = await fetch(`/api/agents/mine?userId=${encodeURIComponent(userId)}`);
        const data = await res.json();
        if (data.agent) {
          setPolling(false);
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          onAgentCreated();
          setShowCreate(false);
          setSoulUrl(null);
          setName("");
          setAvatar("🤖");
        }
      } catch { /* retry next poll */ }
    }

    check();
    pollRef.current = setInterval(check, POLL_INTERVAL);
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [soulUrl, userId, onAgentCreated]);

  async function handleGenerateSoul() {
    if (!name.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/agents/soul", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, name: name.trim(), avatar }),
      });
      if (!res.ok) {
        const text = await res.text();
        console.error("[AgentListPage] soul generate failed:", res.status, text);
        setError(`${isZh ? "服务器错误" : "Server error"} (${res.status})`);
        setGenerating(false);
        return;
      }
      const data = await res.json();
      setSoulUrl(data.soulUrl);
    } catch (err) {
      console.error("[AgentListPage] soul generate network error:", err);
      setError(isZh ? "网络连接失败" : "Network error");
    }
    setGenerating(false);
  }

  function handleCopySoul() {
    if (!soulUrl) return;
    navigator.clipboard.writeText(soulUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleOpenCreate() {
    setShowCreate(true);
    setName("");
    setAvatar("🤖");
    setSoulUrl(null);
    setError(null);
    setShowEmojiPicker(false);
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

        {agents.length === 0 && !showCreate ? (
          <div className="text-center py-12">
            <p className="text-text-tertiary text-[15px] mb-4">
              {isZh ? "还没有创建牌手" : "No players created yet"}
            </p>
            <button
              onClick={handleOpenCreate}
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
                      {getSoulUrl(agent)}
                    </code>
                    <button
                      onClick={() => handleCopy(agent)}
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

            {/* ── Inline Creation Card ── */}
            {showCreate && (
              <div className="bg-white rounded-2xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-text-primary text-[17px] font-semibold">
                    {isZh ? "新建牌手" : "New Player"}
                  </h3>
                  {!soulUrl && (
                    <button
                      onClick={() => { setShowCreate(false); setSoulUrl(null); }}
                      className="text-text-tertiary text-[15px] min-h-[44px] flex items-center"
                    >
                      {isZh ? "取消" : "Cancel"}
                    </button>
                  )}
                </div>

                {soulUrl ? (
                  /* ── Soul URL display ── */
                  <div>
                    <div className="text-text-tertiary text-[12px] font-medium mb-2 uppercase tracking-wide">
                      {isZh ? "复制「灵魂」给 AI 助手" : "Copy Soul to AI Assistant"}
                    </div>
                    <div className="flex items-center gap-2 mb-3">
                      <code className="flex-1 bg-surface-elevated rounded-xl px-4 py-3 text-[12px] font-mono break-all">
                        {soulUrl}
                      </code>
                      <button
                        onClick={handleCopySoul}
                        className="shrink-0 bg-accent hover:bg-accent-hover text-white px-4 py-3 rounded-xl text-[13px] font-medium transition-colors"
                      >
                        {copied ? (isZh ? "已复制" : "Copied") : (isZh ? "复制" : "Copy")}
                      </button>
                    </div>
                    <p className="text-text-secondary text-[13px] mb-4">
                      {isZh
                        ? "把链接发给 AI 助手，让他/她协助你塑造牌手的灵魂"
                        : "Send this link to your AI assistant to help shape your player's soul."}
                    </p>
                    <div className="flex flex-col items-center justify-center py-4">
                      <div className="text-[36px] mb-2 animate-pulse">👻</div>
                      <p className="text-text-tertiary text-[14px]">
                        {isZh ? "灵魂生成中..." : "Soul is being shaped..."}
                      </p>
                      {polling && (
                        <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin mt-3" />
                      )}
                    </div>
                  </div>
                ) : (
                  /* ── Creation form ── */
                  <div>
                    <label className="text-text-tertiary text-[12px] font-medium mb-2 block uppercase tracking-wide">
                      {isZh ? "牌手名字" : "Player Name"}
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={isZh ? "给你的牌手取个名字..." : "Name your player..."}
                      maxLength={20}
                      className="w-full bg-surface-elevated rounded-xl px-4 py-3 text-text-primary text-[15px] focus:outline-none focus:ring-2 focus:ring-accent/50 placeholder:text-text-tertiary mb-4"
                    />

                    <label className="text-text-tertiary text-[12px] font-medium mb-2 block uppercase tracking-wide">
                      {isZh ? "选择头像" : "Choose Avatar"}
                    </label>
                    <button
                      onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                      className="w-14 h-14 bg-surface-elevated rounded-xl flex items-center justify-center text-[28px] hover:bg-surface-hover transition-colors"
                    >
                      {avatar}
                    </button>

                    {showEmojiPicker && (
                      <div className="grid grid-cols-8 gap-2 mt-3 p-3 bg-surface-elevated rounded-xl">
                        {EMOJI_OPTIONS.map((emoji) => (
                          <button
                            key={emoji}
                            onClick={() => { setAvatar(emoji); setShowEmojiPicker(false); }}
                            className={`w-9 h-9 flex items-center justify-center text-[20px] rounded-lg transition-colors ${avatar === emoji ? "bg-accent/20 ring-2 ring-accent" : "hover:bg-white"}`}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}

                    <button
                      onClick={handleGenerateSoul}
                      disabled={generating || !name.trim()}
                      className="w-full bg-accent hover:bg-accent-hover text-white py-3.5 rounded-full font-medium text-[17px] transition-colors disabled:opacity-50 mt-5"
                    >
                      {generating
                        ? (isZh ? "生成中..." : "Generating...")
                        : (isZh ? "生成「灵魂」链接" : "Generate Soul Link")}
                    </button>

                    {error && (
                      <div className="bg-red-50 text-red-600 rounded-xl px-4 py-3 text-[14px] mt-4">{error}</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {!showCreate && (
              <button
                onClick={handleOpenCreate}
                className="w-full bg-accent hover:bg-accent-hover text-white py-3.5 rounded-full font-medium text-[17px] transition-colors"
              >
                {isZh ? "新建牌手" : "Create New Player"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
