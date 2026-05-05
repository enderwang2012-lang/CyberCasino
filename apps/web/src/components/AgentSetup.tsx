"use client";

import { useState } from "react";
import type { AgentConfig, AgentMode, WebhookPingResult } from "@cybercasino/shared";

const EMOJI_PRESETS = ["🦈", "🐺", "🦊", "🐉", "🤖", "👾", "🎭", "🔥", "💀", "🌙", "⚡", "🃏"];

const WEBHOOK_PROMPT = `帮我创建一个 HTTP Webhook 服务，用于接入 CyberCasino 平台的 AI 德州扑克对战，你将化身 poker 高手替我征战。

## 平台协议

平台会向你的 Webhook URL 发送 HTTP POST 请求，Content-Type 为 application/json。

### 1. 心跳检测（ping）
请求：{ "type": "ping", "timestamp": 1714300000000 }
期望响应：{ "status": "ok" }

### 2. 决策请求（decision）
请求字段：
{
  "type": "decision",
  "stylePrompt": "你的风格描述...",
  "gameView": {
    "myId": "agent-1",
    "myCards": [{ "rank": 14, "suit": "s" }, { "rank": 13, "suit": "h" }],
    "communityCards": [...],
    "phase": "flop",
    "pots": [{ "amount": 600 }],
    "players": [...],
    "currentBet": 200,
    "bigBlind": 100,
    "dealerSeatIndex": 0
  },
  "validActions": ["fold", "call", "raise"],
  "callAmount": 100,
  "minRaise": 100
}

关键：stylePrompt 是用户在平台上自定义的风格描述，你的决策逻辑必须参考这个字段来调整打法风格。

期望响应：
{ "action": "raise", "amount": 400, "thought": "你的内心独白" }

- action 必须是 validActions 中的一个
- amount 仅 raise 时需要，金额 ≥ currentBet + minRaise
- thought 用第一人称自然表达，像真实牌手的内心独白
- 超时 15 秒

牌面编码：rank 2-14（11=J, 12=Q, 13=K, 14=A），suit h♥ d♦ c♣ s♠

## 技术要求
- 无技术栈限制，建议零依赖方便快速部署
- 必须读取并使用 stylePrompt 动态调整决策风格

## 最终交付
1. 完整代码（可直接运行）
2. 启动命令
3. 获取公网 URL 的方案（本地 + ngrok/cloudflared，或云部署）
4. 最终告诉我：把 URL 填入 CyberCasino 平台即可对战`;

interface AgentSetupProps {
  agentConfig: AgentConfig | null;
  webhookPingResult: WebhookPingResult | null;
  onSave: (config: Omit<AgentConfig, "id" | "userId" | "webhookVerified">) => void;
  onTestWebhook: (url: string) => void;
  onBack: () => void;
}

export function AgentSetup({ agentConfig, webhookPingResult, onSave, onTestWebhook, onBack }: AgentSetupProps) {
  const [mode, setMode] = useState<AgentMode | null>(agentConfig?.mode ?? null);
  const [name, setName] = useState(agentConfig?.name ?? "");
  const [avatar, setAvatar] = useState(agentConfig?.avatar ?? "🤖");
  const [stylePrompt, setStylePrompt] = useState(agentConfig?.stylePrompt ?? "");
  const [webhookUrl, setWebhookUrl] = useState(agentConfig?.webhookUrl ?? "");
  const [showPrompt, setShowPrompt] = useState(false);
  const [copied, setCopied] = useState(false);

  function handleSave() {
    if (!mode || name.length < 2 || name.length > 20) return;
    if (mode === "custom" && !webhookUrl) return;

    onSave({
      name,
      avatar,
      mode,
      stylePrompt,
      webhookUrl: mode === "custom" ? webhookUrl : undefined,
    });
  }

  function handleCopyPrompt() {
    navigator.clipboard.writeText(WEBHOOK_PROMPT);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!mode) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center p-6 pt-[max(3rem,env(safe-area-inset-top))] bg-surface-elevated">
        <button onClick={onBack} className="absolute top-[max(1.5rem,env(safe-area-inset-top))] left-5 text-accent text-[15px] min-h-[44px] flex items-center">
          ‹ 返回
        </button>
        <h2 className="text-[28px] font-semibold text-text-primary mb-2 tracking-tight">选择模式</h2>
        <p className="text-text-secondary text-[15px] mb-8">你的 Agent 将代表你在牌桌上征战</p>

        <div className="flex flex-col sm:flex-row gap-3 max-w-lg w-full">
          <button
            onClick={() => setMode("smart")}
            className="flex-1 text-left bg-white hover:bg-white/80 rounded-2xl p-6 transition-colors shadow-sm"
          >
            <div className="text-[32px] mb-3">🎰</div>
            <h3 className="text-text-primary font-semibold text-[17px] mb-1">AI 代打</h3>
            <p className="text-text-secondary text-[15px] mb-3">平台 AI 帮你上桌</p>
            <ul className="text-text-tertiary text-[13px] space-y-1">
              <li>零部署，设完即打</li>
              <li>风格 Prompt 自由调教</li>
              <li>默认模型思考</li>
            </ul>
          </button>

          <button
            onClick={() => setMode("custom")}
            className="flex-1 text-left bg-white hover:bg-white/80 rounded-2xl p-6 transition-colors shadow-sm"
          >
            <div className="text-[32px] mb-3">🔧</div>
            <h3 className="text-text-primary font-semibold text-[17px] mb-1">自研 Agent</h3>
            <p className="text-text-secondary text-[15px] mb-3">接入你自己的 AI</p>
            <ul className="text-text-tertiary text-[13px] space-y-1">
              <li>完全自定义决策逻辑</li>
              <li>用你自己的模型和策略</li>
              <li>Webhook URL 接入</li>
            </ul>
          </button>
        </div>
      </div>
    );
  }

  const isCustom = mode === "custom";
  const canSave = name.length >= 2 && name.length <= 20 && (!isCustom || webhookUrl);

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center p-6 pt-[max(3rem,env(safe-area-inset-top))] bg-surface-elevated">
      <button onClick={onBack} className="absolute top-[max(1.5rem,env(safe-area-inset-top))] left-5 text-accent text-[15px] min-h-[44px] flex items-center">
        ‹ 返回
      </button>

      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8">
          <span className="text-[28px]">{isCustom ? "🔧" : "🎰"}</span>
          <h2 className="text-[22px] font-semibold text-text-primary tracking-tight">
            {isCustom ? "自研 Agent" : "AI 代打"}
          </h2>
          <button onClick={() => setMode(null)} className="ml-auto text-accent text-[13px]">
            切换模式
          </button>
        </div>

        <div className="space-y-5">
          <div>
            <label className="text-text-secondary text-[13px] block mb-2">名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="2-20 个字符"
              maxLength={20}
              className="w-full bg-white rounded-xl px-4 py-3 text-text-primary text-[15px] focus:outline-none focus:ring-2 focus:ring-accent/50 placeholder:text-text-tertiary shadow-sm"
            />
          </div>

          <div>
            <label className="text-text-secondary text-[13px] block mb-2">头像</label>
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
              placeholder="自定义"
              maxLength={2}
              className="w-20 bg-white rounded-xl px-3 py-2 text-center text-[20px] focus:outline-none focus:ring-2 focus:ring-accent/50 shadow-sm"
            />
          </div>

          <div>
            <label className="text-text-secondary text-[13px] block mb-2">
              风格 Prompt
              {isCustom && <span className="text-text-tertiary ml-1">(随决策请求发送)</span>}
            </label>
            <textarea
              value={stylePrompt}
              onChange={(e) => setStylePrompt(e.target.value)}
              placeholder={isCustom
                ? "描述你的 Agent 风格，会传给 Webhook..."
                : "沉稳老道，只在有把握时出手，喜欢用沉默给对手压力"
              }
              rows={3}
              className="w-full bg-surface rounded-xl px-4 py-3 text-text-primary text-[15px] focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none placeholder:text-text-tertiary"
            />
          </div>

          {!isCustom && (
            <div className="text-text-tertiary text-[13px] bg-white rounded-xl px-4 py-3 shadow-sm">
              思考模型：DeepSeek（默认）
            </div>
          )}

          {isCustom && (
            <>
              <div>
                <label className="text-text-secondary text-[13px] block mb-2">Webhook URL</label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder="https://your-webhook.com/"
                    className="flex-1 bg-surface rounded-xl px-4 py-3 text-text-primary text-[15px] focus:outline-none focus:ring-2 focus:ring-accent/50 placeholder:text-text-tertiary"
                  />
                  <button
                    onClick={() => onTestWebhook(webhookUrl)}
                    disabled={!webhookUrl}
                    className="bg-surface-elevated hover:bg-surface-deep text-accent px-4 py-3 rounded-xl text-[15px] font-medium disabled:opacity-50 whitespace-nowrap transition-colors"
                  >
                    测试
                  </button>
                </div>
                {webhookPingResult && (
                  <p className={`text-[13px] mt-2 ${webhookPingResult.success ? "text-success" : "text-danger"}`}>
                    {webhookPingResult.success
                      ? `连接成功，延迟 ${webhookPingResult.latencyMs}ms`
                      : webhookPingResult.error}
                  </p>
                )}
              </div>

              <div className="bg-white rounded-xl overflow-hidden shadow-sm">
                <button
                  onClick={() => setShowPrompt(!showPrompt)}
                  className="w-full text-left px-4 py-3 text-text-secondary text-[13px] hover:text-text-primary transition-colors"
                >
                  {showPrompt ? "▾" : "▸"} Webhook 创建教程
                </button>
                {showPrompt && (
                  <div className="px-4 pb-4">
                    <p className="text-text-tertiary text-[13px] mb-3">
                      复制下面的 Prompt 发给 AI 助手，它会帮你生成完整的 Webhook 服务。
                    </p>
                    <div className="relative">
                      <pre className="bg-surface-elevated rounded-xl p-4 text-text-secondary text-[12px] overflow-auto max-h-48 whitespace-pre-wrap">
                        {WEBHOOK_PROMPT}
                      </pre>
                      <button
                        onClick={handleCopyPrompt}
                        className="absolute top-2 right-2 bg-white hover:bg-white/80 text-text-secondary px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors shadow-sm"
                      >
                        {copied ? "已复制" : "复制"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          <button
            onClick={handleSave}
            disabled={!canSave}
            className={`w-full py-3.5 rounded-full font-medium text-[17px] transition-colors ${
              canSave
                ? "bg-accent hover:bg-accent-hover text-white"
                : "bg-surface-deep text-text-tertiary cursor-not-allowed"
            }`}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
