"use client";

import { useState, useEffect, useRef } from "react";
import type { AgentConfigV2 } from "@cybercasino/shared";
import { useLanguage } from "@/contexts/LanguageContext";

function getServerUrl() {
  if (process.env.NEXT_PUBLIC_SERVER_URL) {
    const url = process.env.NEXT_PUBLIC_SERVER_URL;
    return url.startsWith("http") ? url : `https://${url}`;
  }
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost:3001";
}
const POLL_INTERVAL = 2000;

const EMOJI_OPTIONS = ["🤖","🎭","🦊","🦈","👻","🐍","🍣","📖","🔥","💀","🐉","🃏","🎯","🧠","⚡","🌟","💎","🎪","🦅","🐺","🐱","🦉","🎲","🍀"];

interface AgentSetupProps {
  userId: string;
  onCreated: () => void;
  onBack: () => void;
}

export function AgentSetup({ userId, onCreated, onBack }: AgentSetupProps) {
  const { language } = useLanguage();
  const isZh = language === "zh";

  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("🤖");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const [soulUrl, setSoulUrl] = useState<string | null>(null);
  const [soulKey, setSoulKey] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [agent, setAgent] = useState<AgentConfigV2 | null>(null);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [existingAgent, setExistingAgent] = useState<AgentConfigV2 | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [editing, setEditing] = useState(false);

  const soulLocked = !!soulUrl;
  const isReady = !!agent;

  // ── Fetch existing agent on mount ──
  useEffect(() => {
    async function fetchExisting() {
      try {
        const res = await fetch(`${getServerUrl()}/api/agents/mine?userId=${encodeURIComponent(userId)}`);
        const data = await res.json();
        if (data.agent) {
          setExistingAgent(data.agent);
        }
      } catch { /* ignore */ }
      setLoadingExisting(false);
    }
    fetchExisting();
  }, [userId]);

  // ── Start editing existing agent ──
  function handleStartEdit() {
    if (!existingAgent) return;
    setName(existingAgent.name);
    setAvatar(existingAgent.avatar);
    setEditing(true);
    setAgent(null);
    setSoulUrl(null);
    setSoulKey(null);
  }

  // ── Poll soul status until agent is ready ──
  useEffect(() => {
    if (!soulKey || isReady) return;
    setPolling(true);

    async function check() {
      try {
        const res = await fetch(`${getServerUrl()}/api/agents/soul/${soulKey}/status`);
        const data = await res.json();
        if (data.status === "ready") {
          setAgent(data.agent);
          setPolling(false);
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        }
      } catch { /* retry next poll */ }
    }

    check(); // immediate first check
    pollRef.current = setInterval(check, POLL_INTERVAL);
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [soulKey, isReady]);

  async function handleGenerateSoul() {
    if (!name.trim()) {
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`${getServerUrl()}/api/agents/soul`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, name: name.trim(), avatar, agentId: editing && existingAgent ? existingAgent.id : undefined }),
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
      setSoulKey(data.key);
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

  // ── Preview of the created agent (inline, no nested card) ──
  function AgentPreviewCard() {
    if (!agent) return null;
    const strategy = agent.strategy;
    const preflopPositions = strategy.preflop?.ranges
      ? Object.entries(strategy.preflop.ranges).map(([pos, range]) => ({
          pos,
          raise: range.raise?.length ?? 0,
          call: range.call?.length ?? 0,
        }))
      : [];

    return (
      <div>
        {/* Identity */}
        <div className="flex items-center gap-3 mb-4">
          <span className="text-[36px]">{agent.avatar}</span>
          <div>
            <div className="text-text-primary text-[18px] font-semibold">{agent.name}</div>
            <div className="text-text-secondary text-[13px]">{agent.description ?? ""}</div>
          </div>
        </div>

        {/* Strategy overview */}
        {preflopPositions.length > 0 && (
          <>
            <div className="text-text-tertiary text-[12px] font-medium mb-2 uppercase tracking-wide">
              {isZh ? "策略概览" : "Strategy Overview"}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center mb-3">
              {preflopPositions.slice(0, 6).map(({ pos, raise, call }) => (
                <div key={pos} className="bg-surface-elevated rounded-lg px-2 py-2">
                  <div className="text-text-tertiary text-[11px]">{pos}</div>
                  <div className="text-text-primary text-[13px] font-medium">{raise}R / {call}C</div>
                </div>
              ))}
            </div>
            <div className="text-text-tertiary text-[12px]">
              {isZh
                ? `${strategy.postflop?.length ?? 0} 条翻牌后规则`
                : `${strategy.postflop?.length ?? 0} postflop rules`}
              {strategy.expression?.thoughtLanguage && ` · ${strategy.expression.thoughtLanguage.toUpperCase()}`}
              {strategy.imperfection && ` · ${(strategy.imperfection.baseMistakeRate * 100).toFixed(0)}% mistake rate`}
            </div>

            <div className="border-t border-surface-elevated my-4" />
          </>
        )}

        <button
          onClick={onCreated}
          className="w-full bg-accent hover:bg-accent-hover text-white py-3.5 rounded-full font-medium text-[17px] transition-colors"
        >
          {isZh ? "回到大厅" : "Back to Lobby"}
        </button>
      </div>
    );
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
          {editing
            ? (isZh ? "编辑 AI 牌手" : "Edit AI Player")
            : (isZh ? "创建 AI 牌手" : "Create AI Player")}
        </h2>
        <p className="text-text-secondary text-[15px] mb-6">
          {editing
            ? (isZh ? "将修改后的「灵魂」发给 AI 助手，Ta 会在现有配置基础上调整" : "Send the updated soul to AI. They will adjust based on the current config.")
            : (isZh
              ? "为你的牌手取名，然后将「灵魂」交给 AI 助手来塑造"
              : "Name your player, then hand the soul to AI for shaping")}
        </p>

        {/* Loading */}
        {loadingExisting && (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Existing agent view (before editing) */}
        {!loadingExisting && existingAgent && !editing && !soulUrl && (
          <div className="bg-white rounded-2xl p-5 shadow-sm mb-6">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-[36px]">{existingAgent.avatar}</span>
              <div>
                <div className="text-text-primary text-[18px] font-semibold">{existingAgent.name}</div>
                <div className="text-text-secondary text-[13px]">{existingAgent.description ?? ""}</div>
              </div>
              <div className="ml-auto">
                <div className="bg-green-100 text-green-700 text-[12px] font-medium px-2.5 py-1 rounded-full">
                  {isZh ? "已就绪" : "Ready"}
                </div>
              </div>
            </div>

            {/* Strategy summary */}
            {existingAgent.strategy.preflop?.ranges && (
              <>
                <div className="text-text-tertiary text-[12px] font-medium mb-2 uppercase tracking-wide">
                  {isZh ? "策略概览" : "Strategy Overview"}
                </div>
                <div className="grid grid-cols-3 gap-2 text-center mb-3">
                  {Object.entries(existingAgent.strategy.preflop.ranges).slice(0, 6).map(([pos, range]) => (
                    <div key={pos} className="bg-surface-elevated rounded-lg px-2 py-2">
                      <div className="text-text-tertiary text-[11px]">{pos}</div>
                      <div className="text-text-primary text-[13px] font-medium">
                        {range.raise?.length ?? 0}R / {range.call?.length ?? 0}C
                      </div>
                    </div>
                  ))}
                </div>
                <div className="text-text-tertiary text-[12px]">
                  {isZh
                    ? `${existingAgent.strategy.postflop?.length ?? 0} 条翻牌后规则`
                    : `${existingAgent.strategy.postflop?.length ?? 0} postflop rules`}
                  {existingAgent.strategy.expression?.thoughtLanguage && ` · ${existingAgent.strategy.expression.thoughtLanguage.toUpperCase()}`}
                  {existingAgent.strategy.imperfection && ` · ${(existingAgent.strategy.imperfection.baseMistakeRate * 100).toFixed(0)}% mistake rate`}
                </div>
              </>
            )}

            <div className="border-t border-surface-elevated my-4" />

            <button
              onClick={handleStartEdit}
              className="w-full bg-accent hover:bg-accent-hover text-white py-3.5 rounded-full font-medium text-[17px] transition-colors mb-3"
            >
              {isZh ? "编辑牌手" : "Edit Player"}
            </button>
            <button
              onClick={onCreated}
              className="w-full bg-surface-elevated hover:bg-surface-hover text-text-primary py-3.5 rounded-full font-medium text-[17px] transition-colors"
            >
              {isZh ? "回到大厅" : "Back to Lobby"}
            </button>
          </div>
        )}

        {/* Create / Edit form */}
        {!loadingExisting && (!existingAgent || editing || soulUrl) && (
          <>
        {/* Name & Avatar card — with status badge */}
        <div className="bg-white rounded-2xl p-5 shadow-sm mb-6 relative">
          {/* Status badge */}
          {soulLocked && (
            <div className={`absolute top-4 right-4 text-[12px] font-medium px-2.5 py-1 rounded-full ${isReady ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
              {isReady
                ? (isZh ? "牌手已就绪" : "Ready")
                : (isZh ? "牌手生成中" : "Generating")}
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
        </div>

        {/* Generate Soul or Soul + Preview merged card */}
        {!soulUrl ? (
          <button
            onClick={handleGenerateSoul}
            disabled={generating || !name.trim()}
            className="w-full bg-accent hover:bg-accent-hover text-white py-3.5 rounded-full font-medium text-[17px] transition-colors disabled:opacity-50 mb-6"
          >
            {generating
              ? (isZh ? "生成中..." : "Generating...")
              : (isZh ? "生成「灵魂」" : "Generate Soul")}
          </button>
        ) : null}
        {error && (
          <div className="bg-red-50 text-red-600 rounded-xl px-4 py-3 text-[14px] mb-6">{error}</div>
        )}
        {!soulUrl ? null : (
          <div className="bg-white rounded-2xl p-5 shadow-sm mb-6">
            {/* Soul link */}
            <div className="text-text-tertiary text-[12px] font-medium mb-2 uppercase tracking-wide">
              {editing
              ? (isZh ? "复制「灵魂」给 AI 助手（修改模式）" : "Copy Soul to AI Assistant (Edit Mode)")
              : (isZh ? "复制「灵魂」给 AI 助手" : "Copy Soul to AI Assistant")}
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
              {editing
                ? (isZh
                  ? "把链接发给 AI 助手，Ta 会分析当前配置并针对性地调整"
                  : "Send this link to your AI. They will analyze the current config and make targeted adjustments.")
                : (isZh
                  ? "把链接发给 AI 助手，Ta 会读懂牌手的灵魂并自动生成完整配置"
                  : "Send this link to your AI. They will understand the soul and auto-generate the config.")}
            </p>

            {/* Divider */}
            <div className="border-t border-surface-elevated mb-4" />

            {/* Preview or placeholder — inside the same card */}
            {isReady ? (
              <AgentPreviewCard />
            ) : (
              <div className="flex flex-col items-center justify-center py-6">
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
            )}
          </div>
        )}
          </>
        )}
      </div>
    </div>
  );
}