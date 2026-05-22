"use client";

import { useState, useEffect } from "react";
import type { StrategyConfig, AgentPreview } from "@cybercasino/shared";
import { useLanguage } from "@/contexts/LanguageContext";
import { useHeader } from "@/contexts/HeaderContext";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";

interface ParsedPayload {
  config: StrategyConfig;
  preview: AgentPreview;
}

interface AgentSetupProps {
  userId: string;
  onCreated: () => void;
  onBack: () => void;
}

export function AgentSetup({ userId, onCreated, onBack }: AgentSetupProps) {
  const { language } = useLanguage();
  const { setVisible } = useHeader();
  useEffect(() => {
    setVisible(false);
    return () => setVisible(true);
  }, [setVisible]);

  const isZh = language === "zh";

  const [step, setStep] = useState<"copy" | "paste" | "preview" | "creating" | "done">("copy");
  const [promptText, setPromptText] = useState("");
  const [promptLoading, setPromptLoading] = useState(true);
  const [pasteContent, setPasteContent] = useState("");
  const [parsed, setParsed] = useState<ParsedPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [createdAgentId, setCreatedAgentId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${SERVER_URL}/api/agents/creation-prompt?token=${encodeURIComponent(userId)}`)
      .then((r) => r.text())
      .then((text) => {
        setPromptText(text);
        setPromptLoading(false);
      })
      .catch(() => {
        setPromptLoading(false);
        setError(isZh ? "无法加载创建 Prompt" : "Failed to load creation prompt");
      });
  }, [userId, isZh]);

  function handleCopy() {
    navigator.clipboard.writeText(promptText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleParse() {
    setError(null);
    try {
      const trimmed = pasteContent.trim();
      const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        setError(isZh ? "未找到 JSON 内容" : "No JSON found in response");
        return;
      }
      const data = JSON.parse(jsonMatch[0]);

      if (!data.config || !data.preview) {
        setError(isZh ? 'JSON 需要包含 "config" 和 "preview" 字段' : 'JSON must contain "config" and "preview" fields');
        return;
      }

      setParsed(data as ParsedPayload);
      setStep("preview");
    } catch {
      setError(isZh ? "JSON 解析失败，请检查格式" : "JSON parse error, check format");
    }
  }

  async function handleSubmit() {
    if (!parsed) return;
    setStep("creating");
    setError(null);

    try {
      const res = await fetch(`${SERVER_URL}/api/agents/create-by-ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...parsed, userId }),
      });

      if (!res.ok) {
        const body = await res.json();
        setError(body.error || body.details?.join(", ") || "Creation failed");
        setStep("preview");
        return;
      }

      const result = await res.json();
      setCreatedAgentId(result.agentId);
      setStep("done");
    } catch {
      setError(isZh ? "网络错误，请重试" : "Network error, please retry");
      setStep("preview");
    }
  }

  // ── Step 1: Copy prompt ──
  if (step === "copy") {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center p-6 pt-[max(3rem,env(safe-area-inset-top))] bg-surface-elevated">
        <button onClick={onBack} className="absolute top-[max(1.5rem,env(safe-area-inset-top))] left-5 text-accent text-[15px] min-h-[44px] flex items-center">
          {isZh ? "返回" : "Back"}
        </button>

        <div className="w-full max-w-md">
          <h2 className="text-[24px] font-semibold text-text-primary mb-1 tracking-tight">
            {isZh ? "设计你的 AI 牌手" : "Design Your AI Player"}
          </h2>
          <p className="text-text-secondary text-[15px] mb-6">
            {isZh
              ? "复制下方 Prompt 到你的 AI 助手，通过对话设计专属牌手"
              : "Copy the prompt below to your AI assistant to design a unique player"}
          </p>

          <div className="bg-white rounded-2xl p-5 shadow-sm mb-6">
            {promptLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <>
                <pre className="text-text-secondary text-[12px] whitespace-pre-wrap max-h-48 overflow-auto mb-4 leading-relaxed">
                  {promptText.length > 600 ? promptText.slice(0, 600) + "..." : promptText}
                </pre>
                <div className="text-text-tertiary text-[12px] mb-3">
                  {isZh ? `共 ${promptText.length} 字符` : `${promptText.length} characters total`}
                </div>
              </>
            )}
          </div>

          <button
            onClick={handleCopy}
            disabled={promptLoading}
            className="w-full bg-accent hover:bg-accent-hover text-white py-3.5 rounded-full font-medium text-[17px] transition-colors disabled:opacity-50 mb-3"
          >
            {copied ? (isZh ? "已复制!" : "Copied!") : (isZh ? "复制 Prompt" : "Copy Prompt")}
          </button>

          <button
            onClick={() => setStep("paste")}
            className="w-full text-accent text-[15px] py-2 min-h-[44px] flex items-center justify-center"
          >
            {isZh ? "我已拿到 AI 的回复 → 粘贴" : "I have the AI response → Paste"}
          </button>
        </div>
      </div>
    );
  }

  // ── Step 2: Paste response ──
  if (step === "paste") {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center p-6 pt-[max(3rem,env(safe-area-inset-top))] bg-surface-elevated">
        <button onClick={() => setStep("copy")} className="absolute top-[max(1.5rem,env(safe-area-inset-top))] left-5 text-accent text-[15px] min-h-[44px] flex items-center">
          {isZh ? "返回" : "Back"}
        </button>

        <div className="w-full max-w-md">
          <h2 className="text-[24px] font-semibold text-text-primary mb-1 tracking-tight">
            {isZh ? "粘贴 AI 回复" : "Paste AI Response"}
          </h2>
          <p className="text-text-secondary text-[15px] mb-6">
            {isZh
              ? "将 AI 助手生成的 JSON 配置粘贴到下方"
              : "Paste the JSON config from your AI assistant below"}
          </p>

          <textarea
            value={pasteContent}
            onChange={(e) => { setPasteContent(e.target.value); setError(null); }}
            placeholder={isZh ? '粘贴包含 "config" 和 "preview" 的 JSON...' : 'Paste JSON with "config" and "preview"...'}
            rows={12}
            className="w-full bg-white rounded-2xl px-5 py-4 text-text-primary text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none placeholder:text-text-tertiary shadow-sm mb-4"
          />

          {error && (
            <p className="text-danger text-[13px] mb-4">{error}</p>
          )}

          <button
            onClick={handleParse}
            disabled={!pasteContent.trim()}
            className="w-full bg-accent hover:bg-accent-hover text-white py-3.5 rounded-full font-medium text-[17px] transition-colors disabled:opacity-50"
          >
            {isZh ? "解析并预览" : "Parse & Preview"}
          </button>
        </div>
      </div>
    );
  }

  // ── Step 3: Preview ──
  if (step === "preview" && parsed) {
    const { config, preview } = parsed;
    const preflopPositions = config.preflop?.ranges
      ? Object.entries(config.preflop.ranges).map(([pos, range]) => ({
          pos,
          raise: range.raise?.length ?? 0,
          call: range.call?.length ?? 0,
        }))
      : [];

    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center p-6 pt-[max(3rem,env(safe-area-inset-top))] bg-surface-elevated">
        <button onClick={() => setStep("paste")} className="absolute top-[max(1.5rem,env(safe-area-inset-top))] left-5 text-accent text-[15px] min-h-[44px] flex items-center">
          {isZh ? "返回修改" : "Back to Edit"}
        </button>

        <div className="w-full max-w-md">
          <h2 className="text-[24px] font-semibold text-text-primary mb-1 tracking-tight">
            {isZh ? "确认牌手" : "Confirm Player"}
          </h2>
          <p className="text-text-secondary text-[15px] mb-6">
            {isZh ? "检查无误后点击创建" : "Review and create"}
          </p>

          <div className="space-y-4 mb-6">
            {/* Identity card */}
            <div className="bg-white rounded-2xl p-5 shadow-sm">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-[36px]">{preview.avatar ?? "🤖"}</span>
                <div>
                  <div className="text-text-primary text-[18px] font-semibold">{preview.name}</div>
                  <div className="text-text-secondary text-[13px]">{preview.playStyle}</div>
                </div>
              </div>
              {preview.description && (
                <p className="text-text-secondary text-[14px]">{preview.description}</p>
              )}
            </div>

            {/* Sample thoughts */}
            {preview.sampleThoughts && preview.sampleThoughts.length > 0 && (
              <div className="bg-white rounded-2xl p-5 shadow-sm">
                <div className="text-text-tertiary text-[12px] font-medium mb-2 uppercase tracking-wide">
                  {isZh ? "思考风格" : "Thought Style"}
                </div>
                <div className="space-y-2">
                  {preview.sampleThoughts.map((thought, i) => (
                    <div key={i} className="text-text-primary text-[14px] italic">
                      "{thought}"
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Strategy summary */}
            <div className="bg-white rounded-2xl p-5 shadow-sm">
              <div className="text-text-tertiary text-[12px] font-medium mb-2 uppercase tracking-wide">
                {isZh ? "策略概览" : "Strategy Overview"}
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                {preflopPositions.slice(0, 6).map(({ pos, raise, call }) => (
                  <div key={pos} className="bg-surface-elevated rounded-lg px-2 py-2">
                    <div className="text-text-tertiary text-[11px]">{pos}</div>
                    <div className="text-text-primary text-[13px] font-medium">
                      {raise}R / {call}C
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 text-text-tertiary text-[12px]">
                {isZh
                  ? `${config.postflop?.length ?? 0} 条翻牌后规则`
                  : `${config.postflop?.length ?? 0} postflop rules`}
                {config.expression?.thoughtLanguage && ` · ${config.expression.thoughtLanguage.toUpperCase()}`}
                {config.imperfection && ` · ${(config.imperfection.baseMistakeRate * 100).toFixed(0)}% mistake rate`}
              </div>
            </div>
          </div>

          {error && (
            <p className="text-danger text-[13px] mb-4">{error}</p>
          )}

          <button
            onClick={handleSubmit}
            className="w-full bg-accent hover:bg-accent-hover text-white py-3.5 rounded-full font-medium text-[17px] transition-colors"
          >
            {isZh ? "创建牌手" : "Create Player"}
          </button>
        </div>
      </div>
    );
  }

  // ── Creating spinner ──
  if (step === "creating") {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-surface-elevated">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-text-secondary text-[15px]">
          {isZh ? "正在创建牌手..." : "Creating player..."}
        </p>
      </div>
    );
  }

  // ── Done ──
  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center p-6 bg-surface-elevated">
      <div className="text-[48px] mb-4">🎉</div>
      <h2 className="text-[22px] font-semibold text-text-primary mb-2">
        {isZh ? "牌手创建成功!" : "Player Created!"}
      </h2>
      <p className="text-text-secondary text-[14px] mb-6">
        {isZh ? `ID: ${createdAgentId}` : `ID: ${createdAgentId}`}
      </p>
      <button
        onClick={onCreated}
        className="bg-accent hover:bg-accent-hover text-white px-8 py-3 rounded-full font-medium text-[15px] transition-colors"
      >
        {isZh ? "回到大厅" : "Back to Lobby"}
      </button>
    </div>
  );
}
