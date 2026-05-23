"use client";

import { useState, useEffect, useRef } from "react";
import type { AgentConfigV2 } from "@cybercasino/shared";
import { useLanguage } from "@/contexts/LanguageContext";

const POLL_INTERVAL = 2000;
const SOUL_CACHE_KEY = "agent_soul_state";
const SOUL_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

interface SoulCache {
  soulUrl: string;
  name: string;
  avatar: string;
  editing: boolean;
  createdAt: number;
}

function loadSoulCache(): SoulCache | null {
  try {
    const raw = localStorage.getItem(SOUL_CACHE_KEY);
    if (!raw) return null;
    const cache: SoulCache = JSON.parse(raw);
    if (Date.now() - cache.createdAt > SOUL_CACHE_TTL) {
      localStorage.removeItem(SOUL_CACHE_KEY);
      return null;
    }
    return cache;
  } catch {
    return null;
  }
}

function saveSoulCache(data: Omit<SoulCache, "createdAt">) {
  localStorage.setItem(SOUL_CACHE_KEY, JSON.stringify({ ...data, createdAt: Date.now() }));
}

function clearSoulCache() {
  localStorage.removeItem(SOUL_CACHE_KEY);
}

const EMOJI_OPTIONS = ["🤖","🎭","🦊","🦈","👻","🐍","🍣","📖","🔥","💀","🐉","🃏","🎯","🧠","⚡","🌟","💎","🎪","🦅","🐺","🐱","🦉","🎲","🍀"];

interface AgentSetupProps {
  userId: string;
  onCreated: () => void;
  onBack: () => void;
}

export function AgentSetup({ userId, onCreated, onBack }: AgentSetupProps) {
  const { language } = useLanguage();
  const isZh = language === "zh";

  const cached = loadSoulCache();
  const [name, setName] = useState(cached?.name ?? "");
  const [avatar, setAvatar] = useState(cached?.avatar ?? "🤖");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const [soulUrl, setSoulUrl] = useState(cached?.soulUrl ?? null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [agent, setAgent] = useState<AgentConfigV2 | null>(null);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [existingAgent, setExistingAgent] = useState<AgentConfigV2 | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [editing, setEditing] = useState(cached?.editing ?? false);
  const [creatingNew, setCreatingNew] = useState(false);

  const soulLocked = !!soulUrl;
  const isReady = !!agent;

  // Display agent: prefer newly created (agent), fallback to existing
  const displayAgent = agent ?? existingAgent;

  // Is the user in form mode (creating or editing)?
  const showForm = creatingNew || editing || soulUrl || !existingAgent;

  function handleBackToLobby() {
    clearSoulCache();
    onCreated();
  }

  // ── Fetch existing agent on mount ──
  useEffect(() => {
    async function fetchExisting() {
      try {
        const res = await fetch(`/api/agents/mine?userId=${encodeURIComponent(userId)}`);
        const data = await res.json();
        if (data.agent) {
          setExistingAgent(data.agent);
        }
      } catch { /* ignore */ }
      setLoadingExisting(false);
    }
    fetchExisting();
  }, [userId]);

  // ── Poll for agent creation (once soulUrl is set, poll until agent exists) ──
  useEffect(() => {
    if (!soulUrl || isReady) return;
    setPolling(true);

    async function check() {
      try {
        const res = await fetch(`/api/agents/mine?userId=${encodeURIComponent(userId)}`);
        const data = await res.json();
        if (data.agent) {
          setAgent(data.agent);
          setPolling(false);
          clearSoulCache();
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        }
      } catch { /* retry next poll */ }
    }

    check();
    pollRef.current = setInterval(check, POLL_INTERVAL);
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [soulUrl, isReady, userId]);

  async function handleGenerateSoul() {
    if (!name.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/soul`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, name: name.trim(), avatar, soulKey: editing && existingAgent?.soulKey ? existingAgent.soulKey : undefined }),
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
      saveSoulCache({ soulUrl: data.soulUrl, name: name.trim(), avatar, editing });
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

  function handleCreateNew() {
    setCreatingNew(true);
    setEditing(false);
    setAgent(null);
    setSoulUrl(null);
    setName("");
    setAvatar("🤖");
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
        {/* ── Title ── */}
        <h2 className="text-[24px] font-semibold text-text-primary mb-1 tracking-tight">
          {isReady
            ? (isZh ? "我的 AI 牌手" : "My AI Player")
            : showForm
              ? (editing ? (isZh ? "编辑 AI 牌手" : "Edit AI Player") : (isZh ? "创建 AI 牌手" : "Create AI Player"))
              : (isZh ? "我的 AI 牌手" : "My AI Player")}
        </h2>
        <p className="text-text-secondary text-[15px] mb-6">
          {isReady
            ? (isZh ? "你的牌手已就绪，可以加入牌局" : "Your player is ready to join a table")
            : showForm
              ? (editing
                ? (isZh ? "修改后将「灵魂」发给 AI 助手，Ta 会在现有配置基础上调整" : "Send the updated soul to AI. They will adjust based on the current config.")
                : (isZh ? "为你的牌手取名，然后将「灵魂」交给 AI 助手来塑造" : "Name your player, then hand the soul to AI for shaping"))
              : (isZh ? "你的牌手已就绪，可以加入牌局" : "Your player is ready to join a table")}
        </p>

        {/* ── Loading ── */}
        {loadingExisting && (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* ════════════════════════════════════════════ */}
        {/* ── Existing Agent Card (view mode) ── */}
        {/* ════════════════════════════════════════════ */}
        {!loadingExisting && existingAgent && !creatingNew && !editing && !soulUrl && (
          <div className="bg-white rounded-2xl p-5 shadow-sm mb-6">
            <div className="flex items-center gap-3">
              <span className="text-[36px]">{existingAgent.avatar}</span>
              <div className="flex-1">
                <div className="text-text-primary text-[18px] font-semibold">{existingAgent.name}</div>
                <div className="text-text-secondary text-[13px]">{existingAgent.description ?? ""}</div>
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════ */}
        {/* ── Ready Agent Card (after creation) ── */}
        {/* ════════════════════════════════════════════ */}
        {!loadingExisting && isReady && !creatingNew && (
          <div className="bg-white rounded-2xl p-5 shadow-sm mb-6 relative">
            <div className="absolute top-4 right-4 text-[12px] font-medium px-2.5 py-1 rounded-full bg-green-100 text-green-700">
              {isZh ? "牌手已就绪" : "Ready"}
            </div>
            <div className="flex items-center gap-3 mb-4">
              <span className="text-[36px]">{agent!.avatar}</span>
              <div>
                <div className="text-text-primary text-[18px] font-semibold">{agent!.name}</div>
                <div className="text-text-secondary text-[13px]">{agent!.description ?? ""}</div>
              </div>
            </div>
            {soulUrl && (
              <>
                <div className="border-t border-surface-elevated pt-4 mt-2">
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
                  <p className="text-text-secondary text-[13px]">
                    {isZh
                      ? "把链接发给 AI 助手，让他/她协助你塑造牌手的灵魂"
                      : "Send this link to your AI assistant to help shape your player's soul."}
                  </p>
                </div>
              </>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════════ */}
        {/* ── Create/Edit Form Card ── */}
        {/* ════════════════════════════════════════════ */}
        {!loadingExisting && showForm && !isReady && (
          <div className="bg-white rounded-2xl p-5 shadow-sm mb-6 relative">
            {/* Status badge */}
            {soulLocked && (
              <div className="absolute top-4 right-4 text-[12px] font-medium px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">
                {isZh ? "牌手生成中" : "Generating"}
              </div>
            )}

            <label className="text-text-tertiary text-[12px] font-medium mb-2 block uppercase tracking-wide">
              {isZh ? "牌手名字" : "Player Name"}
            </label>
            <div className="flex items-center gap-3 mb-4">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={soulLocked}
                placeholder={isZh ? "给你的牌手取个名字..." : "Name your player..."}
                maxLength={20}
                className="flex-1 bg-surface-elevated rounded-xl px-4 py-3 text-text-primary text-[15px] focus:outline-none focus:ring-2 focus:ring-accent/50 placeholder:text-text-tertiary disabled:opacity-60 disabled:cursor-not-allowed"
              />
            </div>

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

            {/* Generate button */}
            {!soulUrl && (
              <button
                onClick={handleGenerateSoul}
                disabled={generating || !name.trim()}
                className="w-full bg-accent hover:bg-accent-hover text-white py-3.5 rounded-full font-medium text-[17px] transition-colors disabled:opacity-50 mt-5"
              >
                {generating
                  ? (isZh ? "生成中..." : "Generating...")
                  : (isZh ? "生成「灵魂」链接" : "Generate Soul Link")}
              </button>
            )}

            {/* Error */}
            {error && (
              <div className="bg-red-50 text-red-600 rounded-xl px-4 py-3 text-[14px] mt-4">{error}</div>
            )}

            {/* Soul Link (after generation) */}
            {soulUrl && (
              <div className="mt-5 pt-5 border-t border-surface-elevated">
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
                <p className="text-text-secondary text-[13px]">
                  {isZh
                    ? "把链接发给 AI 助手，让他/她协助你塑造牌手的灵魂"
                    : "Send this link to your AI assistant to help shape your player's soul."}
                </p>

                {/* Loading indicator */}
                <div className="flex flex-col items-center justify-center py-6 mt-4">
                  <div className="text-[40px] mb-2 animate-pulse">👻</div>
                  <p className="text-text-tertiary text-[14px]">
                    {isZh ? "灵魂生成中..." : "Soul is being shaped..."}
                  </p>
                  <p className="text-text-tertiary text-[12px] mt-1">
                    {editing
                      ? (isZh ? "AI 正在根据你的需求调整牌手配置" : "AI is adjusting the player config based on your feedback")
                      : (isZh ? "AI 助手正在为你的牌手注入灵魂" : "AI is crafting your player's soul")}
                  </p>
                  {polling && (
                    <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin mt-3" />
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Create New Button (outside card) ── */}
        {!loadingExisting && (isReady || !showForm) && !creatingNew && (
          <button
            onClick={handleCreateNew}
            className="w-full bg-accent hover:bg-accent-hover text-white py-3.5 rounded-full font-medium text-[17px] transition-colors"
          >
            {isZh ? "新建牌手" : "Create New Player"}
          </button>
        )}
      </div>
    </div>
  );
}
