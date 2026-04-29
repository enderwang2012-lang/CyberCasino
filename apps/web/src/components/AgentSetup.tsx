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
      <div className="min-h-screen flex flex-col items-center justify-center p-8">
        <button onClick={onBack} className="absolute top-6 left-6 text-gray-500 hover:text-gray-300 text-sm">
          ← 返回大厅
        </button>
        <h2 className="text-2xl font-bold text-cyan-400 mb-2">选择 Agent 模式</h2>
        <p className="text-gray-500 text-sm mb-8">你的 Agent 将代表你在牌桌上征战</p>

        <div className="flex gap-4 max-w-2xl w-full">
          <button
            onClick={() => setMode("smart")}
            className="flex-1 text-left bg-gray-900/50 hover:bg-gray-800/50 border border-cyan-700/30 hover:border-cyan-500/50 rounded-lg p-6 transition-all"
          >
            <div className="text-3xl mb-3">🎰</div>
            <h3 className="text-cyan-300 font-bold text-lg mb-1">AI 代打</h3>
            <p className="text-gray-400 text-sm mb-3">平台 AI 帮你上桌</p>
            <ul className="text-gray-500 text-xs space-y-1">
              <li>· 零部署，设完即打</li>
              <li>· 风格 Prompt 自由调教</li>
              <li>· 默认 Haiku 模型思考</li>
            </ul>
            <p className="text-gray-600 text-xs mt-3">适合：想快速上桌的玩家</p>
          </button>

          <button
            onClick={() => setMode("custom")}
            className="flex-1 text-left bg-gray-900/50 hover:bg-gray-800/50 border border-fuchsia-700/30 hover:border-fuchsia-500/50 rounded-lg p-6 transition-all"
          >
            <div className="text-3xl mb-3">🔧</div>
            <h3 className="text-fuchsia-300 font-bold text-lg mb-1">自研 Agent</h3>
            <p className="text-gray-400 text-sm mb-3">接入你自己的 AI</p>
            <ul className="text-gray-500 text-xs space-y-1">
              <li>· 完全自定义决策逻辑</li>
              <li>· 用你自己的模型和策略</li>
              <li>· Webhook URL 接入</li>
              <li>· 附带 Prompt 生成教程</li>
            </ul>
            <p className="text-gray-600 text-xs mt-3">适合：想深度定制的开发者</p>
          </button>
        </div>
      </div>
    );
  }

  const isCustom = mode === "custom";
  const accentColor = isCustom ? "fuchsia" : "cyan";
  const canSave = name.length >= 2 && name.length <= 20 && (!isCustom || webhookUrl);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8">
      <button onClick={onBack} className="absolute top-6 left-6 text-gray-500 hover:text-gray-300 text-sm">
        ← 返回大厅
      </button>

      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-6">
          <span className="text-2xl">{isCustom ? "🔧" : "🎰"}</span>
          <h2 className={`text-xl font-bold ${isCustom ? "text-fuchsia-400" : "text-cyan-400"}`}>
            {isCustom ? "自研 Agent" : "AI 代打"} 设置
          </h2>
          <button onClick={() => setMode(null)} className="ml-auto text-gray-600 hover:text-gray-400 text-xs">
            切换模式
          </button>
        </div>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="text-gray-400 text-xs block mb-1">Agent 名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="2-20 个字符"
              maxLength={20}
              className="w-full bg-gray-900/50 border border-gray-700/50 rounded px-3 py-2 text-gray-200 text-sm focus:outline-none focus:border-cyan-600"
            />
          </div>

          {/* Avatar */}
          <div>
            <label className="text-gray-400 text-xs block mb-1">头像</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {EMOJI_PRESETS.map((e) => (
                <button
                  key={e}
                  onClick={() => setAvatar(e)}
                  className={`text-xl p-1.5 rounded ${avatar === e ? "bg-gray-700 ring-1 ring-cyan-500" : "hover:bg-gray-800"}`}
                >
                  {e}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={avatar}
              onChange={(e) => setAvatar(e.target.value)}
              placeholder="或输入自定义 emoji"
              maxLength={2}
              className="w-24 bg-gray-900/50 border border-gray-700/50 rounded px-3 py-1 text-center text-lg focus:outline-none focus:border-cyan-600"
            />
          </div>

          {/* Style Prompt */}
          <div>
            <label className="text-gray-400 text-xs block mb-1">
              风格 Prompt
              {isCustom && <span className="text-gray-600 ml-1">(会随决策请求发送给你的 Webhook)</span>}
            </label>
            <textarea
              value={stylePrompt}
              onChange={(e) => setStylePrompt(e.target.value)}
              placeholder={isCustom
                ? "描述你的 Agent 风格，会传给 Webhook..."
                : "沉稳老道，只在有把握时出手，喜欢用沉默给对手压力"
              }
              rows={3}
              className="w-full bg-gray-900/50 border border-gray-700/50 rounded px-3 py-2 text-gray-200 text-sm focus:outline-none focus:border-cyan-600 resize-none"
            />
          </div>

          {/* Smart mode: model info */}
          {!isCustom && (
            <div className="text-gray-600 text-xs bg-gray-900/30 rounded px-3 py-2">
              思考模型：Haiku（默认）
            </div>
          )}

          {/* Custom mode: Webhook URL */}
          {isCustom && (
            <>
              <div>
                <label className="text-gray-400 text-xs block mb-1">Webhook URL</label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder="https://your-webhook.com/"
                    className="flex-1 bg-gray-900/50 border border-gray-700/50 rounded px-3 py-2 text-gray-200 text-sm focus:outline-none focus:border-fuchsia-600"
                  />
                  <button
                    onClick={() => onTestWebhook(webhookUrl)}
                    disabled={!webhookUrl}
                    className="bg-fuchsia-900/50 hover:bg-fuchsia-800/50 border border-fuchsia-700/50 text-fuchsia-300 px-3 py-2 rounded text-sm disabled:opacity-50 whitespace-nowrap"
                  >
                    测试
                  </button>
                </div>
                {webhookPingResult && (
                  <p className={`text-xs mt-1 ${webhookPingResult.success ? "text-green-500" : "text-red-500"}`}>
                    {webhookPingResult.success
                      ? `✅ 连接成功，延迟 ${webhookPingResult.latencyMs}ms`
                      : `❌ ${webhookPingResult.error}`}
                  </p>
                )}
              </div>

              {/* Tutorial panel */}
              <div className="border border-gray-800 rounded">
                <button
                  onClick={() => setShowPrompt(!showPrompt)}
                  className="w-full text-left px-3 py-2 text-gray-500 text-xs hover:text-gray-300"
                >
                  {showPrompt ? "▾" : "▸"} 不知道怎么创建 Webhook？点此获取 Prompt 教程
                </button>
                {showPrompt && (
                  <div className="px-3 pb-3">
                    <p className="text-gray-500 text-xs mb-2">
                      复制下面的 Prompt，发给你的 AI（Claude / GPT / Cursor 等），它会帮你生成完整的 Webhook 服务代码和部署方案。
                    </p>
                    <div className="relative">
                      <pre className="bg-black/50 border border-gray-800 rounded p-3 text-gray-400 text-xs overflow-auto max-h-48 whitespace-pre-wrap">
                        {WEBHOOK_PROMPT}
                      </pre>
                      <button
                        onClick={handleCopyPrompt}
                        className="absolute top-2 right-2 bg-gray-800 hover:bg-gray-700 text-gray-400 px-2 py-1 rounded text-xs"
                      >
                        {copied ? "已复制 ✓" : "复制"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Save */}
          <button
            onClick={handleSave}
            disabled={!canSave}
            className={`w-full py-2.5 rounded font-medium text-sm transition-colors ${
              canSave
                ? isCustom
                  ? "bg-fuchsia-600 hover:bg-fuchsia-500 text-white"
                  : "bg-cyan-600 hover:bg-cyan-500 text-white"
                : "bg-gray-800 text-gray-600 cursor-not-allowed"
            }`}
          >
            保存并准备上桌
          </button>
        </div>
      </div>
    </div>
  );
}
