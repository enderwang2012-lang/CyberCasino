"use client";

import { useState, useEffect } from "react";
import type { AgentConfig, WebhookPingResult } from "@cybercasino/shared";
import { useLanguage } from "@/contexts/LanguageContext";
import { useHeader } from "@/contexts/HeaderContext";

const EMOJI_PRESETS = ["🦈", "🐺", "🦊", "🐉", "🤖", "👾", "🎭", "🔥", "💀", "🌙", "⚡", "🃏"];

type WizardStep = "interview" | "review" | "configure";

const ARCHETYPES = [
  { id: "tag", emoji: "🎯", labelZh: "紧凶 (TAG)", labelEn: "Tight-Aggressive (TAG)", descZh: "只打好牌，但一旦出手就很凶", descEn: "Only play premium hands, but play them hard" },
  { id: "lag", emoji: "🔥", labelZh: "松凶 (LAG)", labelEn: "Loose-Aggressive (LAG)", descZh: "什么牌都玩，持续施加压力", descEn: "Play many hands, apply constant pressure" },
  { id: "rock", emoji: "🪨", labelZh: "岩石 (Rock)", labelEn: "Rock", descZh: "极度保守，只玩坚果，等待时机", descEn: "Ultra-tight, only play the nuts" },
  { id: "maniac", emoji: "🤪", labelZh: "疯子 (Maniac)", labelEn: "Maniac", descZh: "什么牌都加注，高频率诈唬", descEn: "Raise everything, bluff constantly" },
  { id: "balanced", emoji: "⚖️", labelZh: "均衡 (Balanced)", labelEn: "Balanced", descZh: "攻守平衡，难以被看穿", descEn: "Balanced approach, hard to read" },
];

const QUESTIONS = [
  {
    id: "marginal",
    zh: "翻牌前拿到边缘牌（如 KJo），你倾向？",
    en: "Pre-flop with a marginal hand (e.g. KJo), you tend to?",
    options: [
      { id: "raise", zh: "加注抢盲", en: "Raise to steal blinds" },
      { id: "call", zh: "平跟看看", en: "Call and see" },
      { id: "fold", zh: "直接弃牌", en: "Fold" },
    ],
  },
  {
    id: "pressure",
    zh: "对手连续下注，你手里有中对，你会？",
    en: "Opponent keeps betting, you have middle pair. You?",
    options: [
      { id: "reraise", zh: "反加回去", en: "Re-raise" },
      { id: "call", zh: "跟注观望", en: "Call and observe" },
      { id: "fold", zh: "果断弃牌", en: "Fold decisively" },
    ],
  },
  {
    id: "river",
    zh: "河牌圈什么都没中，你会？",
    en: "River brought nothing, you missed everything. You?",
    options: [
      { id: "bluff", zh: "演一手，开诈", en: "Run a bluff" },
      { id: "giveup", zh: "放弃这一局", en: "Give up the hand" },
    ],
  },
];

function generateStylePrompt(archetype: string, answers: Record<string, string>, language: "zh" | "en"): string {
  const isZh = language === "zh";

  const archetypeLines: Record<string, { zh: string; en: string }> = {
    tag: {
      zh: "紧凶型选手。起手牌范围较窄，只玩优质手牌。但一旦入池，打法激进，加注尺度偏大。",
      en: "Tight-Aggressive player. Narrow starting hand range, only plays premium hands. But once in the pot, plays aggressively with larger raise sizing.",
    },
    lag: {
      zh: "松凶型选手。起手牌范围很宽，几乎任何两张牌都可能入池。频繁加注和再加注，持续给对手压力。",
      en: "Loose-Aggressive player. Wide starting hand range, can enter with almost any two cards. Frequently raises and re-raises, constantly applying pressure.",
    },
    rock: {
      zh: "岩石型选手。极度保守，只玩坚果牌。不轻易下注，但中了大牌会慢打引诱对手。",
      en: "Rock player. Ultra-conservative, only plays the nuts. Rarely bets, but slow-plays big hands to trap opponents.",
    },
    maniac: {
      zh: "疯子型选手。几乎每手牌都加注，诈唬频率极高，打法不可预测。享受高风险高波动的游戏。",
      en: "Maniac player. Raises almost every hand, bluffs at very high frequency, unpredictable. Enjoys high-risk, high-variance play.",
    },
    balanced: {
      zh: "均衡型选手。攻守平衡，根据不同局面灵活调整。有时紧有时松，让对手难以判断你的范围。",
      en: "Balanced player. Well-rounded offense and defense, adjusts flexibly to situations. Alternates between tight and loose, making your range hard to read.",
    },
  };

  const parts: string[] = [archetypeLines[archetype]?.[isZh ? "zh" : "en"] ?? ""];

  if (answers.marginal === "raise") parts.push(isZh ? "面对边缘牌倾向于加注抢主动权。" : "Prefers to raise and seize initiative with marginal hands.");
  else if (answers.marginal === "fold") parts.push(isZh ? "面对边缘牌会果断弃牌，不纠结。" : "Decisively folds marginal hands, no hesitation.");
  else parts.push(isZh ? "面对边缘牌倾向于先跟注看翻牌。" : "Prefers to call and see the flop with marginal hands.");

  if (answers.pressure === "reraise") parts.push(isZh ? "面对压力不退缩，敢于反加回去。" : "Doesn't fold under pressure, dares to re-raise.");
  else if (answers.pressure === "fold") parts.push(isZh ? "面对持续压力会选择止损离场。" : "Cuts losses and exits under sustained pressure.");
  else parts.push(isZh ? "面对压力耐心跟注，等待时机。" : "Patiently calls under pressure, waits for the right moment.");

  if (answers.river === "bluff") parts.push(isZh ? "善于在河牌圈发动诈唬，即使没中牌也能演。" : "Skilled at river bluffs, can represent strong hands even when missing.");
  else parts.push(isZh ? "河牌没中就不强求，稳扎稳打。" : "Doesn't force it when missing on the river, plays steady.");

  return parts.join(" ");
}

const CF_WORKER_CODE = `// CyberCasino Webhook - Cloudflare Worker
// Deploy: npx wrangler deploy

export default {
  async fetch(request: Request): Promise<Response> {
    const body = await request.json() as any;

    // Ping check
    if (body.type === "ping") {
      return Response.json({ status: "ok" });
    }

    // Decision request
    if (body.type === "decision") {
      const { gameView, validActions, callAmount, stylePrompt } = body;
      const myCards = gameView.myCards;
      const phase = gameView.phase;
      const communityCards = gameView.communityCards;

      // TODO: Call your own LLM here with stylePrompt + game state
      // const response = await fetch("https://api.openai.com/v1/chat/completions", { ... })
      // Then parse the LLM response into action/amount/thought

      // Simple fallback: always call if possible
      const action = validActions.includes("call") ? "call" : validActions[0];
      const thought = "Let me think about this hand...";

      return Response.json({ action, thought });
    }

    return Response.json({ error: "Unknown request type" }, { status: 400 });
  },
};`;

interface AgentSetupProps {
  agentConfig: AgentConfig | null;
  webhookPingResult: WebhookPingResult | null;
  onSave: (config: Omit<AgentConfig, "id" | "userId" | "webhookVerified">) => void;
  onTestWebhook: (url: string) => void;
  onBack: () => void;
}

export function AgentSetup({ agentConfig, webhookPingResult, onSave, onTestWebhook, onBack }: AgentSetupProps) {
  const { t, language } = useLanguage();
  const { setVisible } = useHeader();
  useEffect(() => {
    setVisible(false);
    return () => setVisible(true);
  }, [setVisible]);

  const isZh = language === "zh";

  // Wizard state
  const [step, setStep] = useState<WizardStep>("interview");
  const [archetype, setArchetype] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [stylePrompt, setStylePrompt] = useState(agentConfig?.stylePrompt ?? "");

  // Config state
  const [name, setName] = useState(agentConfig?.name ?? "");
  const [avatar, setAvatar] = useState(agentConfig?.avatar ?? "🤖");
  const [webhookUrl, setWebhookUrl] = useState(agentConfig?.webhookUrl ?? "");
  const [showTemplate, setShowTemplate] = useState(false);
  const [copied, setCopied] = useState(false);

  function handleInterviewComplete() {
    const prompt = generateStylePrompt(archetype, answers, language);
    setStylePrompt(prompt);
    setStep("review");
  }

  function handleSave() {
    if (name.length < 2 || name.length > 20) return;
    onSave({
      name,
      avatar,
      stylePrompt,
      webhookUrl: webhookUrl || undefined,
    });
  }

  function handleCopyTemplate() {
    navigator.clipboard.writeText(CF_WORKER_CODE);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const currentQuestion = (() => {
    const unanswered = QUESTIONS.find((q) => answers[q.id] === undefined);
    return unanswered ?? null;
  })();

  // ── Step 1: Interview ──
  if (step === "interview") {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center p-6 pt-[max(3rem,env(safe-area-inset-top))] bg-surface-elevated">
        <button onClick={onBack} className="absolute top-[max(1.5rem,env(safe-area-inset-top))] left-5 text-accent text-[15px] min-h-[44px] flex items-center">
          {t("common.back")}
        </button>

        <div className="w-full max-w-md">
          <h2 className="text-[24px] font-semibold text-text-primary mb-1 tracking-tight">
            {isZh ? "定制你的 Agent" : "Customize Your Agent"}
          </h2>
          <p className="text-text-secondary text-[15px] mb-8">
            {isZh ? "回答几个问题，AI 帮你生成策略" : "Answer a few questions, AI generates your strategy"}
          </p>

          {/* Archetype selection */}
          {!archetype ? (
            <>
              <p className="text-text-secondary text-[13px] mb-3 font-medium">
                {isZh ? "第一步：选择风格原型" : "Step 1: Choose a style archetype"}
              </p>
              <div className="space-y-2 mb-6">
                {ARCHETYPES.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setArchetype(a.id)}
                    className="w-full text-left bg-white hover:bg-white/80 rounded-xl p-4 transition-colors shadow-sm flex items-center gap-3"
                  >
                    <span className="text-[28px]">{a.emoji}</span>
                    <div className="flex-1">
                      <div className="text-text-primary text-[15px] font-medium">
                        {isZh ? a.labelZh : a.labelEn}
                      </div>
                      <div className="text-text-tertiary text-[13px]">
                        {isZh ? a.descZh : a.descEn}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : currentQuestion ? (
            <>
              <p className="text-text-secondary text-[13px] mb-2 font-medium">
                {isZh ? `第二步：场景问答 (${Object.keys(answers).length + 1}/${QUESTIONS.length})` : `Step 2: Scenarios (${Object.keys(answers).length + 1}/${QUESTIONS.length})`}
              </p>
              <div className="bg-white rounded-2xl p-6 shadow-sm mb-6">
                <p className="text-text-primary text-[16px] font-medium mb-5">
                  {isZh ? currentQuestion.zh : currentQuestion.en}
                </p>
                <div className="space-y-2">
                  {currentQuestion.options.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setAnswers((prev) => ({ ...prev, [currentQuestion.id]: opt.id }))}
                      className="w-full text-left bg-surface-elevated hover:bg-surface-deep rounded-xl px-4 py-3 text-text-primary text-[15px] transition-colors"
                    >
                      {isZh ? opt.zh : opt.en}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-8">
              <div className="text-[40px] mb-4">{isZh ? "✅" : "✅"}</div>
              <p className="text-text-primary text-[17px] font-medium mb-2">
                {isZh ? "策略分析完成" : "Strategy analysis complete"}
              </p>
              <p className="text-text-secondary text-[14px] mb-6">
                {isZh ? "点击查看 AI 为你生成的策略" : "Click to see your generated strategy"}
              </p>
              <button
                onClick={handleInterviewComplete}
                className="bg-accent hover:bg-accent-hover text-white px-8 py-3 rounded-full font-medium text-[15px] transition-colors"
              >
                {isZh ? "查看策略 →" : "View Strategy →"}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Step 2: Review generated stylePrompt ──
  if (step === "review") {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center p-6 pt-[max(3rem,env(safe-area-inset-top))] bg-surface-elevated">
        <button onClick={() => setStep("interview")} className="absolute top-[max(1.5rem,env(safe-area-inset-top))] left-5 text-accent text-[15px] min-h-[44px] flex items-center">
          {t("common.back")}
        </button>

        <div className="w-full max-w-md">
          <h2 className="text-[24px] font-semibold text-text-primary mb-2 tracking-tight">
            {isZh ? "确认策略" : "Confirm Strategy"}
          </h2>
          <p className="text-text-secondary text-[15px] mb-6">
            {isZh ? "以下是 AI 生成的风格描述，你可以直接使用或修改" : "Here's your AI-generated style description. Use as-is or edit."}
          </p>

          <div className="bg-white rounded-2xl p-5 shadow-sm mb-6">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[20px]">{ARCHETYPES.find((a) => a.id === archetype)?.emoji}</span>
              <span className="text-text-primary font-semibold text-[15px]">
                {isZh ? ARCHETYPES.find((a) => a.id === archetype)?.labelZh : ARCHETYPES.find((a) => a.id === archetype)?.labelEn}
              </span>
            </div>
            <textarea
              value={stylePrompt}
              onChange={(e) => setStylePrompt(e.target.value)}
              rows={5}
              className="w-full bg-surface-elevated rounded-xl px-4 py-3 text-text-primary text-[14px] focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none"
            />
          </div>

          <button
            onClick={() => setStep("configure")}
            className="w-full bg-accent hover:bg-accent-hover text-white py-3.5 rounded-full font-medium text-[17px] transition-colors"
          >
            {isZh ? "继续配置 →" : "Continue →"}
          </button>
        </div>
      </div>
    );
  }

  // ── Step 3: Name + Avatar + Webhook URL + Template + Save ──
  const canSave = name.length >= 2 && name.length <= 20;

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center p-6 pt-[max(3rem,env(safe-area-inset-top))] bg-surface-elevated">
      <button onClick={() => setStep("review")} className="absolute top-[max(1.5rem,env(safe-area-inset-top))] left-5 text-accent text-[15px] min-h-[44px] flex items-center">
        {t("common.back")}
      </button>

      <div className="w-full max-w-md">
        <h2 className="text-[24px] font-semibold text-text-primary mb-6 tracking-tight">
          {isZh ? "配置 Agent" : "Configure Agent"}
        </h2>

        <div className="space-y-5">
          {/* Name */}
          <div>
            <label className="text-text-secondary text-[13px] block mb-2">{t("agentSetup.name")}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("agentSetup.namePlaceholder")}
              maxLength={20}
              className="w-full bg-white rounded-xl px-4 py-3 text-text-primary text-[15px] focus:outline-none focus:ring-2 focus:ring-accent/50 placeholder:text-text-tertiary shadow-sm"
            />
          </div>

          {/* Avatar */}
          <div>
            <label className="text-text-secondary text-[13px] block mb-2">{t("agentSetup.avatar")}</label>
            <div className="flex flex-wrap gap-2 mb-3">
              {EMOJI_PRESETS.map((e) => (
                <button
                  key={e}
                  onClick={() => setAvatar(e)}
                  className={`text-[22px] w-10 h-10 flex items-center justify-center rounded-xl transition-colors ${
                    avatar === e ? "bg-accent/10 ring-1.5 ring-accent" : "bg-white hover:bg-surface-elevated shadow-sm"
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={avatar}
              onChange={(e) => setAvatar(e.target.value)}
              placeholder={t("agentSetup.customAvatar")}
              maxLength={2}
              className="w-20 bg-white rounded-xl px-3 py-2 text-center text-[20px] focus:outline-none focus:ring-2 focus:ring-accent/50 shadow-sm"
            />
          </div>

          {/* Style Prompt (read-only summary from interview) */}
          <div>
            <label className="text-text-secondary text-[13px] block mb-2">
              {t("agentSetup.stylePrompt")}
              <span className="text-text-tertiary ml-1">{t("agentSetup.stylePromptHint")}</span>
            </label>
            <textarea
              value={stylePrompt}
              onChange={(e) => setStylePrompt(e.target.value)}
              rows={3}
              className="w-full bg-surface rounded-xl px-4 py-3 text-text-primary text-[15px] focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none placeholder:text-text-tertiary"
            />
          </div>

          {/* Webhook URL */}
          <div>
            <label className="text-text-secondary text-[13px] block mb-2">{t("agentSetup.webhookUrl")}</label>
            <div className="flex gap-2">
              <input
                type="url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://your-worker.workers.dev/"
                className="flex-1 bg-surface rounded-xl px-4 py-3 text-text-primary text-[15px] focus:outline-none focus:ring-2 focus:ring-accent/50 placeholder:text-text-tertiary"
              />
              <button
                onClick={() => onTestWebhook(webhookUrl)}
                disabled={!webhookUrl}
                className="bg-surface-elevated hover:bg-surface-deep text-accent px-4 py-3 rounded-xl text-[15px] font-medium disabled:opacity-50 whitespace-nowrap transition-colors"
              >
                {t("agentSetup.test")}
              </button>
            </div>
            {webhookPingResult && (
              <p className={`text-[13px] mt-2 ${webhookPingResult.success ? "text-success" : "text-danger"}`}>
                {webhookPingResult.success
                  ? t("agentSetup.connectionSuccess", { latency: webhookPingResult.latencyMs ?? 0 })
                  : webhookPingResult.error}
              </p>
            )}
          </div>

          {/* Cloudflare Worker Template */}
          <div className="bg-white rounded-xl overflow-hidden shadow-sm">
            <button
              onClick={() => setShowTemplate(!showTemplate)}
              className="w-full text-left px-4 py-3 text-text-secondary text-[13px] hover:text-text-primary transition-colors flex items-center gap-2"
            >
              <span className="text-lg">⚡</span>
              <span className="flex-1 font-medium">
                {isZh ? "一键部署：Cloudflare Workers 模板" : "One-click deploy: Cloudflare Workers Template"}
              </span>
              <span>{showTemplate ? "▾" : "▸"}</span>
            </button>
            {showTemplate && (
              <div className="px-4 pb-4">
                <div className="flex gap-2 mb-3">
                  <div className="flex-1 bg-[#F48120]/10 rounded-lg px-3 py-2 text-[12px] text-text-secondary">
                    <span className="font-semibold text-text-primary">Cloudflare Workers</span>
                    {" · "}{isZh ? "免费 10万次/天" : "Free 100k req/day"}
                  </div>
                </div>
                <p className="text-text-tertiary text-[12px] mb-3">
                  {isZh
                    ? "1. 安装 wrangler：npm i -g wrangler"
                    : "1. Install wrangler: npm i -g wrangler"}
                  <br />
                  {isZh
                    ? "2. 复制下方代码到 index.ts"
                    : "2. Copy the code below to index.ts"}
                  <br />
                  {isZh
                    ? "3. 运行 npx wrangler deploy"
                    : "3. Run npx wrangler deploy"}
                  <br />
                  {isZh
                    ? "4. 把得到的 URL 填入上方 Webhook URL"
                    : "4. Paste the URL into the Webhook URL field above"}
                </p>
                <div className="relative">
                  <pre className="bg-surface-elevated rounded-xl p-4 text-text-secondary text-[11px] overflow-auto max-h-64 whitespace-pre-wrap">
                    {CF_WORKER_CODE}
                  </pre>
                  <button
                    onClick={handleCopyTemplate}
                    className="absolute top-2 right-2 bg-white hover:bg-white/80 text-text-secondary px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors shadow-sm"
                  >
                    {copied ? t("agentSetup.copied") : t("agentSetup.copy")}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Save */}
          <button
            onClick={handleSave}
            disabled={!canSave}
            className={`w-full py-3.5 rounded-full font-medium text-[17px] transition-colors ${
              canSave
                ? "bg-accent hover:bg-accent-hover text-white"
                : "bg-surface-deep text-text-tertiary cursor-not-allowed"
            }`}
          >
            {t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}