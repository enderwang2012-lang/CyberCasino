"use client";

import { useState, useEffect, useRef } from "react";
import type { AgentConfigV2 } from "@cybercasino/shared";
import { useLanguage } from "@/contexts/LanguageContext";

const POLL_INTERVAL = 2000;
const EMOJI_OPTIONS = ["🤖","🎭","🦊","🦈","👻","🐍","🍣","📖","🔥","💀","🐉","🃏","🎯","🧠","⚡","🌟","💎","🎪","🦅","🐺","🐱","🦉","🎲","🍀"];

interface AgentSetupProps {
  userId: string;
  onCreated: () => void;
  onBack: () => void;
  deletedAgentId?: string | null;
  onDeleteAgent?: (agentId: string) => void;
}

export function AgentSetup({ userId, onCreated, onBack, deletedAgentId, onDeleteAgent }: AgentSetupProps) {
  const { language } = useLanguage();
  const isZh = language === "zh";

  const [existingAgent, setExistingAgent] = useState<AgentConfigV2 | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(true);

  // ── Inline creation state ──
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("🤖");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [soulUrl, setSoulUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Newly created agent (for preview) ──
  const [newAgent, setNewAgent] = useState<AgentConfigV2 | null>(null);

  const displayAgent = newAgent ?? existingAgent;

  // ── Fetch existing agent on mount ──
  useEffect(() => {
    async function fetchExisting() {
      try {
        const res = await fetch(`/api/agents/mine?userId=${encodeURIComponent(userId)}`);
        const data = await res.json();
        if (data.agent) setExistingAgent(data.agent);
      } catch { /* ignore */ }
      setLoadingExisting(false);
    }
    fetchExisting();
  }, [userId]);

  useEffect(() => {
    if (!deletedAgentId || existingAgent?.id !== deletedAgentId) return;
    setExistingAgent(null);
    setNewAgent(null);
    setSoulUrl(null);
    setShowCreate(false);
  }, [deletedAgentId, existingAgent?.id]);

  // ── Poll for agent creation after soul generation ──
  useEffect(() => {
    if (!soulUrl || newAgent) return;
    setPolling(true);

    async function check() {
      try {
        const res = await fetch(`/api/agents/mine?userId=${encodeURIComponent(userId)}`);
        const data = await res.json();
        if (data.agent) {
          setNewAgent(data.agent);
          setPolling(false);
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        }
      } catch { /* retry next poll */ }
    }

    check();
    pollRef.current = setInterval(check, POLL_INTERVAL);
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [soulUrl, newAgent, userId]);

  async function handleGenerateSoul() {
    if (!name.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/soul`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, name: name.trim(), avatar }),
      });
      if (!res.ok) {
        const text = await res.text();
        console.error("[AgentSetup] soul generate failed:", res.status, text);
        setError(`${isZh ? "服务器错误" : "Server error"} (${res.status})`);
        setGenerating(false);
        return;
      }
      const data = await res.json();
      setSoulUrl(data.soulUrl);
    } catch (err) {
      console.error("[AgentSetup] soul generate network error:", err);
      setError(isZh ? "网络连接失败，请检查网络后重试" : "Network error, please check connection and retry");
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
    setNewAgent(null);
    setError(null);
    setShowEmojiPicker(false);
  }

  function handleCancelCreate() {
    setShowCreate(false);
    setSoulUrl(null);
    setNewAgent(null);
    setError(null);
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
          {isZh ? "我的 AI 牌手" : "My AI Player"}
        </h2>
        <p className="text-text-secondary text-[15px] mb-6">
          {isZh
            ? "管理并持续升级你的唯一参赛 Agent"
            : "Manage and continuously upgrade your competition agent"}
        </p>

        {/* ── Loading ── */}
        {loadingExisting && (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* ════════════════════════════════════════════ */}
        {/* ── Existing Agent Card ── */}
        {/* ════════════════════════════════════════════ */}
        {!loadingExisting && existingAgent && !newAgent && (
          <div className="bg-white rounded-2xl p-5 shadow-sm mb-4">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-[36px]">{existingAgent.avatar}</span>
              <div className="flex-1">
                <div className="text-text-primary text-[18px] font-semibold">{existingAgent.name}</div>
                <div className="text-text-secondary text-[13px]">{existingAgent.description ?? ""}</div>
                {(existingAgent.strategyVersion ?? existingAgent.strategyPackage?.manifest.version) && (
                  <div className="text-[#BF5AF2] text-[12px] mt-1">
                    Strategy v{existingAgent.strategyVersion ?? existingAgent.strategyPackage?.manifest.version}
                  </div>
                )}
                {existingAgent.pendingStrategyVersion && (
                  <div className="text-warning text-[12px] mt-1">
                    {isZh
                      ? `v${existingAgent.pendingStrategyVersion} 已保存，将于下一场生效`
                      : `v${existingAgent.pendingStrategyVersion} saved and activates next match`}
                  </div>
                )}
              </div>
            </div>

            {existingAgent.soulKey && (
              <div className="border-t border-surface-elevated pt-4 mt-4">
                <div className="text-text-tertiary text-[12px] font-medium mb-2 uppercase tracking-wide">
                  {isZh ? "「灵魂」链接" : "Soul Link"}
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <code className="flex-1 bg-surface-elevated rounded-xl px-4 py-3 text-[12px] font-mono break-all">
                    {`${window.location.origin}/api/agents/soul/${existingAgent.soulKey}`}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/api/agents/soul/${existingAgent.soulKey}`);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="shrink-0 bg-accent hover:bg-accent-hover text-white px-4 py-3 rounded-xl text-[13px] font-medium transition-colors"
                  >
                    {copied ? (isZh ? "已复制" : "Copied") : (isZh ? "复制" : "Copy")}
                  </button>
                </div>
                <p className="text-text-secondary text-[13px]">
                  {isZh
                    ? "把链接发给 AI 助手，让他/她协助你塑造牌手的灵魂"
                    : "Send this link to your AI assistant to help shape your player's soul."}
                </p>
              </div>
            )}

            {onDeleteAgent && (
              <div className="border-t border-surface-elevated pt-3 mt-3">
                <button
                  onClick={() => {
                    if (confirm(isZh ? `确定删除牌手「${existingAgent.name}」？` : `Delete player "${existingAgent.name}"?`)) {
                      onDeleteAgent(existingAgent.id);
                    }
                  }}
                  className="text-[13px] text-red-500 hover:text-red-600 min-h-[44px] flex items-center"
                >
                  {isZh ? "删除牌手" : "Delete Player"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════════ */}
        {/* ── Newly Created Agent Preview ── */}
        {/* ════════════════════════════════════════════ */}
        {!loadingExisting && newAgent && (
          <div className="bg-white rounded-2xl p-5 shadow-sm mb-4 relative">
            <div className="absolute top-4 right-4 text-[12px] font-medium px-2.5 py-1 rounded-full bg-green-100 text-green-700">
              {isZh ? "牌手已就绪" : "Ready"}
            </div>
            <div className="flex items-center gap-3 mb-4">
              <span className="text-[36px]">{newAgent.avatar}</span>
              <div>
                <div className="text-text-primary text-[18px] font-semibold">{newAgent.name}</div>
                <div className="text-text-secondary text-[13px]">{newAgent.description ?? ""}</div>
              </div>
            </div>

            <div className="border-t border-surface-elevated my-4" />

            <button
              onClick={onCreated}
              className="w-full bg-accent hover:bg-accent-hover text-white py-3.5 rounded-full font-medium text-[17px] transition-colors"
            >
              {isZh ? "回到大厅" : "Back to Lobby"}
            </button>
          </div>
        )}

        {/* ════════════════════════════════════════════ */}
        {/* ── Inline Creation Form ── */}
        {/* ════════════════════════════════════════════ */}
        {!loadingExisting && !existingAgent && showCreate && !newAgent && (
          <div className="bg-white rounded-2xl p-5 shadow-sm mb-4 relative">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-text-primary text-[17px] font-semibold">
                {isZh ? "新建牌手" : "New Player"}
              </h3>
              {!soulUrl && (
                <button
                  onClick={handleCancelCreate}
                  className="text-text-tertiary text-[15px] min-h-[44px] flex items-center"
                >
                  {isZh ? "取消" : "Cancel"}
                </button>
              )}
            </div>

            {soulUrl ? (
              /* ── Soul URL display + polling ── */
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

                <div className="border-t border-surface-elevated mb-4" />

                <div className="flex flex-col items-center justify-center py-6">
                  <div className="text-[40px] mb-2 animate-pulse">👻</div>
                  <p className="text-text-tertiary text-[14px]">
                    {isZh ? "灵魂生成中..." : "Soul is being shaped..."}
                  </p>
                  <p className="text-text-tertiary text-[12px] mt-1">
                    {isZh ? "AI 助手正在为你的牌手注入灵魂" : "AI is crafting your player's soul"}
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

        {/* ── Create New Button ── */}
        {!loadingExisting && !existingAgent && !showCreate && !newAgent && (
          <button
            onClick={handleOpenCreate}
            className="w-full bg-accent hover:bg-accent-hover text-white py-3.5 rounded-full font-medium text-[17px] transition-colors"
          >
            {isZh ? "新建牌手" : "Create New Player"}
          </button>
        )}
      </div>
    </div>
  );
}
