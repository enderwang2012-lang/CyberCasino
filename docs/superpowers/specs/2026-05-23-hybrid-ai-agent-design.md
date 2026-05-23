# Hybrid AI Agent 设计文档

## 概述

为 CyberCasino 引入 LLM 实时思考能力，让 AI 对手在每手牌都进行深度思考并展示思考过程。默认所有 agent 使用 LLM webhook 接入，纯策略模式作为降级兜底。

## 核心目标

1. **AI 实时深度思考**：每手牌调用 LLM 分析局面，做出更像真人的决策
2. **思考过程可视化**：自然语言思考气泡实时展示给玩家，带 bluff 标记
3. **Skill 策略模板**：玩家通过 Skill 系统自定义 AI 的打法风格
4. **零门槛接入**：用户复制灵魂链接发给自己的 AI，AI 自动部署 Cloudflare Worker 并提交配置

---

## 一、HybridAgent 架构

### 1.1 决策流程

```
HybridAgent.decide(view, validActions, callAmount, minRaise)
│
├─ 1. 策略引擎快速评估
│   ├─ 输入：gameView + skill 参数
│   ├─ 输出：建议动作 + 置信度 + 胜率估算
│   └─ 用途：作为 LLM 的参考输入，也是降级后备
│
├─ 2. 判断是否调用 LLM
│   ├─ 有 webhook？ → 调用外部 AI
│   │   ├─ 成功 → 使用 LLM 决策
│   │   └─ 失败（超时/格式错误） → 降级到策略引擎
│   └─ 无 webhook？ → 直接用策略引擎（标记为纯策略模式）
│
├─ 3. 构造 LLM 请求（有 webhook 时）
│   ├─ gameView（完整牌局状态）
│   ├─ validActions（合法动作）
│   ├─ 策略引擎的建议（作为参考）
│   ├─ skill 配置（人格 + 策略参数）
│   └─ actionHistory（近期行动记录）
│
├─ 4. 解析 LLM 响应
│   ├─ action + amount → 决策
│   ├─ thought → 思考气泡文字
│   └─ isBluffing → 是否在 bluff
│
└─ 5. 返回 AgentDecision
    ├─ { action, amount, thought, isBluffing, confidence }
    └─ thought 通过 Socket.IO 实时推送到前端
```

### 1.2 类型定义

```typescript
// 扩展 AgentDecision
interface AgentDecision {
  action: { type: ActionType; amount?: number };
  thought: AgentThought;
}

interface AgentThought {
  message: string;          // 自然语言思考过程
  confidence: number;       // 0-1 置信度
  isBluffing: boolean;      // 是否在 bluff
  isLLMPowered: boolean;   // 是否由 LLM 驱动（区分纯策略模式）
}

// Skill 配置
interface SkillConfig {
  id: string;
  name: string;                    // "紧凶战士" / "松凶海盗"
  description: string;
  systemPrompt: string;            // LLM 的人格指令
  strategyParams: {
    preflopAggression: number;     // 0-1 翻前攻击性
    postflopAggression: number;    // 0-1 翻后攻击性
    bluffFrequency: number;        // 0-1 bluff 频率
    callingThreshold: number;      // 0-1 跟注门槛
  };
  psychologicalParams: {
    tiltResistance: number;        // 0-1 tilt 抗性
    confidenceBase: number;        // 0-1 基础自信
  };
}

// Webhook 请求（增强版）
interface WebhookRequest {
  type: "decision";
  gameView: AgentGameView;
  validActions: ActionType[];
  callAmount: number;
  minRaise: number;
  skill: SkillConfig;
  strategyHint?: {                // 策略引擎的建议（可选）
    suggestedAction: ActionType;
    confidence: number;
    handStrength: number;
  };
}

// Webhook 响应（增强版）
interface WebhookResponse {
  action: "fold" | "check" | "call" | "raise";
  amount?: number;
  thought: string;                // 自然语言思考过程
  isBluffing: boolean;            // 是否在 bluff
  confidence?: number;            // 0-1 置信度
}
```

### 1.3 降级策略

| 场景 | 行为 | 前端标记 |
|------|------|---------|
| Webhook 调用成功 | 使用 LLM 决策 + 思考气泡 | 🧠 AI 实时分析 |
| Webhook 超时（15s） | 使用策略引擎决策 | ⚡ 快速模式 |
| Webhook 返回格式错误 | 使用策略引擎决策 | ⚡ 快速模式 |
| Webhook 未配置 | 使用策略引擎决策 | ⚡ 纯策略模式 |

---

## 二、Skill 系统

### 2.1 预设 Skill

| Skill | 风格 | LLM 人格关键词 | 策略参数特点 |
|-------|------|----------------|-------------|
| 紧凶战士 | Tight-Aggressive | "谨慎但凶猛，只玩好牌但一旦入池就极具攻击性" | preflopAggression: 0.7, bluffFrequency: 0.15 |
| 松凶海盗 | Loose-Aggressive | "爱冒险、喜欢偷鸡，享受心理博弈的快感" | preflopAggression: 0.8, bluffFrequency: 0.4 |
| 紧弱盾牌 | Tight-Passive | "保守稳重，不爱冒险，等待最佳时机出手" | preflopAggression: 0.3, bluffFrequency: 0.05 |
| 读心大师 | GTO+Exploit | "精准读牌，平衡策略，针对性剥削对手弱点" | preflopAggression: 0.5, bluffFrequency: 0.25 |
| 疯狂赌徒 | High Variance | "享受混乱，喜欢大底池和高风险决策" | preflopAggression: 0.9, bluffFrequency: 0.5 |

### 2.2 自定义 Skill

用户通过灵魂链接，由自己的 AI 生成自定义 Skill：

```json
{
  "name": "我的风格",
  "systemPrompt": "你是一个经验丰富的线上牌手，风格偏向...",
  "strategyParams": {
    "preflopAggression": 0.6,
    "postflopAggression": 0.7,
    "bluffFrequency": 0.3,
    "callingThreshold": 0.4
  }
}
```

### 2.3 Skill 对 LLM 的影响

Skill 的 `systemPrompt` 直接作为 LLM 的 system message，`strategyParams` 注入到 user prompt 中：

```
你的风格参数：
- 翻前攻击性：60%（偏积极但不冒进）
- 翻后攻击性：70%（翻后倾向于主动出击）
- Bluff 频率：30%（适度 bluff，不要过于频繁）
- 跟注门槛：40%（中等标准跟注）

请根据这些参数调整你的决策倾向。
```

---

## 三、灵魂链接 Webhook 生成方案

### 3.1 灵魂链接内容结构

现有的灵魂链接包含 creation prompt。新增 webhook 配置部分：

```markdown
## 实时 AI 思考配置（必须）

你的 agent 需要接入 LLM 以实现实时思考。请按以下步骤操作：

### 步骤 1：获取 LLM API Key

选择以下任一 LLM 服务：
- DeepSeek: https://platform.deepseek.com （推荐，性价比高）
- OpenAI: https://platform.openai.com
- Anthropic Claude: https://console.anthropic.com
- 其他 OpenAI 兼容接口

获取 API Key。

### 步骤 2：部署 Cloudflare Worker

复制以下代码到 Cloudflare Workers：

[最小模板代码 - 一个文件即可运行]

配置环境变量：
- LLM_API_KEY: 你的 API Key
- LLM_BASE_URL: API 地址（如 https://api.deepseek.com）
- LLM_MODEL: 模型名（如 deepseek-chat）

部署命令：wrangler deploy

### 步骤 3：获取 Webhook URL

部署后获得 URL，格式：https://your-worker.your-subdomain.workers.dev

### 步骤 4：将 webhook URL 写入 agent 配置

在 agent JSON 的 webhookUrl 字段填入此 URL。
```

### 3.2 Cloudflare Worker 模板

```typescript
// worker.ts - CyberCasino AI Agent Webhook
// 一个文件，部署即用

interface Env {
  LLM_API_KEY: string;
  LLM_BASE_URL: string;
  LLM_MODEL: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    const body = await request.json();

    // 健康检查
    if (body.type === "ping") {
      return Response.json({ status: "ok" });
    }

    // 决策请求
    const { gameView, validActions, callAmount, minRaise, skill, strategyHint } = body;

    // 构造 prompt
    const prompt = buildDecisionPrompt(gameView, validActions, callAmount, minRaise, skill, strategyHint);

    // 调用 LLM
    const response = await fetch(`${env.LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.LLM_MODEL,
        messages: [
          { role: "system", content: skill.systemPrompt },
          { role: "user", content: prompt },
        ],
        max_tokens: 300,
        temperature: 0.7,
      }),
    });

    const data = await response.json();
    const text = data.choices[0]?.message?.content ?? "";

    // 解析 JSON 响应
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return Response.json({ action: "fold", thought: "思考中...", isBluffing: false });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return Response.json({
      action: parsed.action,
      amount: parsed.amount,
      thought: parsed.thought,
      isBluffing: parsed.isBluffing ?? false,
      confidence: parsed.confidence ?? 0.5,
    });
  },
};

function buildDecisionPrompt(gameView, validActions, callAmount, minRaise, skill, strategyHint): string {
  // 与现有 claude-agent.ts 的 buildPrompt 类似
  // 包含：手牌、公共牌、对手信息、行动历史、策略引擎建议
  // 策略引擎建议作为参考注入 prompt
  // ...
}
```

### 3.3 成本

| 项目 | Cloudflare Workers 免费额度 | 实际消耗（估计） |
|------|---------------------------|----------------|
| 请求数 | 10 万次/天 | 每局约 20-40 次请求 |
| CPU 时间 | 10ms/请求 | LLM 调用为 I/O 等待，CPU 接近 0 |
| 结论 | **完全免费** | 10 万次/天 ≈ 2500-5000 局/天 |

用户自己的 LLM API 成本：DeepSeek 约 ¥0.001/次，每天 100 手约 ¥0.1

---

## 四、前端展示方案

### 4.1 思考气泡 UI

AI 行动前显示思考过程：

```
┌─────────────────────────────────┐
│ 🤔 AI 思考中...                 │  ← 加载动画（1-5秒）
├─────────────────────────────────┤
│ "A♥ K♥ 在按钮位，标准加注范围。  │  ← LLM 返回的自然语言
│  下家比较紧，3bet 可能性低。      │
│  加注到 3BB 试探一下。"          │
│                          [加注]  │  ← 最终决策
├─────────────────────────────────┤
│ 🎭 Bluff                       │  ← 如果 isBluffing=true 显示
└─────────────────────────────────┘
```

### 4.2 展示规则

| 场景 | 展示 |
|------|------|
| LLM 模式 | 思考气泡 + 思考时间动画 + 决策 |
| 纯策略模式 | 仅显示决策，无思考气泡 |
| Bluff 时 | 额外显示 🎭 Bluff 标记 |
| 超时降级 | 显示"快速决策"标记 |

### 4.3 Socket.IO 事件

```typescript
// AI 开始思考
socket.emit("ai:thinking", { playerId, estimatedTime: 3 });

// AI 思考完成
socket.emit("ai:thought", {
  playerId,
  thought: {
    message: "A♥ K♥ 在按钮位...",
    isBluffing: false,
    confidence: 0.8,
  },
  action: { type: "raise", amount: 150 },
});
```

---

## 五、用户分层与 LLM 接入

### 5.1 接入模式

| 模式 | 说明 | LLM 来源 |
|------|------|---------|
| **默认（webhook）** | 用户通过灵魂链接配置自己的 AI | 用户自己的 LLM API Key |
| **平台代理（订阅用户）** | 平台提供 LLM 服务 | 平台 API Key |
| **纯策略（降级）** | 无 webhook 时的兜底 | 无 LLM |

### 5.2 平台代理实现

```typescript
// 环境变量
PLATFORM_LLM_API_KEY=sk-xxx
PLATFORM_LLM_BASE_URL=https://api.deepseek.com
PLATFORM_LLM_MODEL=deepseek-chat

// 路由逻辑
function getLLMConfig(userId: string): LLMConfig {
  const user = getUser(userId);
  if (user.hasWebhook) {
    return { type: "webhook", url: user.webhookUrl };
  }
  if (user.isSubscribed) {
    return { type: "platform", apiKey: PLATFORM_LLM_API_KEY, ... };
  }
  return { type: "none" }; // 纯策略降级
}
```

---

## 六、实施优先级

### Phase 1：核心架构
- HybridAgent 类型定义（SkillConfig、增强 WebhookRequest/Response）
- HybridAgent.decide() 实现（策略引擎 + LLM 调用 + 降级）
- Cloudflare Worker 模板

### Phase 2：Skill 系统
- 预设 Skill 数据
- Skill 配置 UI（前端）
- Skill 与 LLM prompt 的集成

### Phase 3：灵魂链接增强
- 灵魂链接文档增加 webhook 配置指南
- AI 创建 agent 时自动生成 webhook 配置

### Phase 4：前端展示
- 思考气泡组件
- Socket.IO 事件处理
- 纯策略/LLM 模式区分显示

### Phase 5：平台代理（订阅用户）
- 平台 LLM API Key 管理
- 订阅用户自动路由到平台 LLM

---

## 七、与现有系统的关系

| 现有组件 | 改动 |
|---------|------|
| `strategy-agent.ts` | 保留，作为 HybridAgent 的策略引擎层 |
| `claude-agent.ts` | 重构为 webhook 调用逻辑 |
| `agent.ts` (PokerAgent) | 保留作为纯策略后备 |
| `llm-client.ts` | 保留，供平台代理模式使用 |
| `rule-engine.ts` | 保留，作为最低降级 |
| `personalities.ts` | 扩展，支持 Skill 配置 |
| `table-instance.ts` | 修改 createAgent，优先创建 HybridAgent |
