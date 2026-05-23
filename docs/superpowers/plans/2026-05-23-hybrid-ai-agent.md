# Hybrid AI Agent 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 CyberCasino 引入 LLM 实时思考能力，让 AI 对手在每手牌都进行深度思考并展示思考过程。

**Architecture:** 在现有 StrategyAgent 策略引擎之上叠加 LLM webhook 调用层。新增 HybridAgent 类型，先用策略引擎快速评估，再将评估结果+局面发给外部 LLM 做深度思考。Skill 系统同时驱动 LLM prompt 和策略参数。纯策略模式作为无 webhook 时的降级兜底。

**Tech Stack:** TypeScript, Socket.IO, OpenAI-compatible API (DeepSeek), Cloudflare Workers (webhook 模板)

---

## 文件结构

### 新建文件

| 文件 | 职责 |
|------|------|
| `apps/server/src/agents/skill-system.ts` | Skill 预设数据 + SkillConfig 类型 |
| `apps/server/src/agents/hybrid-agent.ts` | HybridAgent 主类：策略引擎 + LLM webhook 调用 |
| `apps/server/src/agents/webhook-caller.ts` | Webhook HTTP 调用逻辑（从 external-agent.ts 抽取增强） |
| `apps/server/src/agents/soul-prompt-builder.ts` | 灵魂链接 prompt 构建（含 webhook 配置指南） |
| `apps/server/src/agents/templates/cloudflare-worker.ts` | Cloudflare Worker 模板代码 |
| `apps/web/src/components/ThinkingBubble.tsx` | 思考气泡 UI 组件 |
| `apps/web/src/components/ThinkingBubble.css` | 思考气泡样式 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `packages/shared/src/types.ts` | 新增 SkillConfig, 增强 WebhookRequest/Response, 增强 AgentThought |
| `apps/server/src/agents/agent-interface.ts` | IPokerAgent 接口增加 thinkingSource 字段 |
| `apps/server/src/agents/table-instance.ts` | createAgent 优先创建 HybridAgent |
| `apps/server/src/index.ts` | 灵魂链接路由增加 webhook 配置指南 |
| `apps/web/src/components/TableView.tsx` | 集成 ThinkingBubble 组件 |
| `apps/server/src/agents/external-agent.ts` | 复用 webhook-caller.ts |

---

## Task 1: 扩展共享类型定义

**Files:**
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: 添加 SkillConfig 类型**

在 `packages/shared/src/types.ts` 中 `StrategyConfig` 定义之后（约行 362），添加：

```typescript
// ---------------------------------------------------------------------------
// Skill System
// ---------------------------------------------------------------------------

export interface SkillConfig {
  id: string;
  name: string;
  nameEn: string;
  description: string;
  descriptionEn: string;
  systemPrompt: string;
  strategyParams: {
    preflopAggression: number;   // 0-1
    postflopAggression: number;  // 0-1
    bluffFrequency: number;      // 0-1
    callingThreshold: number;    // 0-1
  };
  psychologicalParams: {
    tiltResistance: number;      // 0-1
    confidenceBase: number;      // 0-1
  };
}
```

- [ ] **Step 2: 增强 WebhookRequest 类型**

找到 `WebhookRequest`（约行 415），修改为：

```typescript
export interface WebhookRequest {
  type: "decision";
  gameView: AgentGameView;
  validActions: ActionType[];
  callAmount: number;
  minRaise: number;
  stylePrompt: string;
  skill?: SkillConfig;
  strategyHint?: {
    suggestedAction: ActionType;
    confidence: number;
    handStrength: number;
  };
}
```

- [ ] **Step 3: 增强 WebhookResponse 类型**

找到 `WebhookResponse`（约行 429），修改为：

```typescript
export interface WebhookResponse {
  action: ActionType;
  amount?: number;
  thought: string;
  isBluffing?: boolean;
  confidence?: number;
}
```

- [ ] **Step 4: 增强 AgentThought 类型**

找到 `AgentThought`（约行 51），修改为：

```typescript
export interface AgentThought {
  message: string;
  confidence: number;
  isBluffing: boolean;
  isMistake?: boolean;
  difficulty?: string;
  psychologicalState?: string;
  thinkingSource: "llm" | "strategy" | "rule";
}
```

- [ ] **Step 5: 确认构建通过**

Run: `cd packages/shared && npx tsc --noEmit`
Expected: 无错误（如果有现有代码引用 AgentThought 缺少 thinkingSource，在 Step 6 中修复）

- [ ] **Step 6: 修复现有代码中 AgentThought 的构造**

搜索所有 `return { ... thought: { message:` 的地方，为每个 AgentThought 字面量补上 `thinkingSource` 字段：

`apps/server/src/agents/strategy-agent.ts` 约行 341 和 364，两处 `return { message:... }` 改为 `return { message:..., thinkingSource: "strategy" }`

`apps/server/src/agents/claude-agent.ts` 约行 123，改为 `thinkingSource: "llm"`

`apps/server/src/agents/rule-engine.ts` 搜索 `thought:` 相关返回，补上 `thinkingSource: "rule"`

- [ ] **Step 7: 重新确认构建通过**

Run: `cd packages/shared && npx tsc --noEmit && cd ../../apps/server && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/types.ts apps/server/src/agents/strategy-agent.ts apps/server/src/agents/claude-agent.ts apps/server/src/agents/rule-engine.ts
git commit -m "feat: extend shared types — SkillConfig, enhanced WebhookRequest/Response, thinkingSource"
```

---

## Task 2: Skill 预设数据

**Files:**
- Create: `apps/server/src/agents/skill-system.ts`

- [ ] **Step 1: 创建 skill-system.ts**

```typescript
import type { SkillConfig } from "@cybercasino/shared";

export const PRESET_SKILLS: SkillConfig[] = [
  {
    id: "tight-aggressive",
    name: "紧凶战士",
    nameEn: "Tight Aggressive",
    description: "谨慎但凶猛，只玩好牌但一旦入池就极具攻击性",
    descriptionEn: "Tight and aggressive — only plays premium hands but attacks hard when committed",
    systemPrompt: `你是一个谨慎但凶猛的德州扑克牌手。你只玩质量最高的手牌，但一旦决定入池，你就极具攻击性。
你的风格特点：
- 翻前只玩前 15% 的手牌
- 入池后倾向于加注而非跟注
- 翻后持续下注（c-bet）频率高
- 很少 bluff，但一旦 bluff 就做得像真的一样
- 对手加注时，如果你有强牌，倾向于再加注而非只是跟注
请用简短的中文输出你的思考过程，像真实牌手在心里嘀咕。`,
    strategyParams: {
      preflopAggression: 0.7,
      postflopAggression: 0.8,
      bluffFrequency: 0.15,
      callingThreshold: 0.3,
    },
    psychologicalParams: {
      tiltResistance: 0.8,
      confidenceBase: 0.7,
    },
  },
  {
    id: "loose-aggressive",
    name: "松凶海盗",
    nameEn: "Loose Aggressive",
    description: "爱冒险、喜欢偷鸡，享受心理博弈的快感",
    descriptionEn: "Loose and aggressive — loves to gamble and steal pots",
    systemPrompt: `你是一个爱冒险的松凶型牌手。你玩很多手牌，喜欢通过加注和 bluff 来控制底池。
你的风格特点：
- 翻前玩很宽的范围（前 40%）
- 频繁加注和 3-bet
- 翻后喜欢持续下注，即使没中牌
- bluff 频率高，享受偷鸡的快感
- 被加注时很少轻易放弃
请用简短的中文输出你的思考过程，语气带点调皮和自信。`,
    strategyParams: {
      preflopAggression: 0.8,
      postflopAggression: 0.7,
      bluffFrequency: 0.4,
      callingThreshold: 0.5,
    },
    psychologicalParams: {
      tiltResistance: 0.5,
      confidenceBase: 0.8,
    },
  },
  {
    id: "tight-passive",
    name: "紧弱盾牌",
    nameEn: "Tight Passive",
    description: "保守稳重，不爱冒险，等待最佳时机出手",
    descriptionEn: "Tight and passive — conservative, waits for the perfect moment",
    systemPrompt: `你是一个保守稳重的牌手。你只玩最好的手牌，倾向于跟注而非加注。
你的风格特点：
- 翻前只玩前 12% 的手牌
- 很少主动加注，倾向于 limp 或 call
- 翻后如果没中强牌就过牌-弃牌
- 中了强牌时慢打（slowplay）诱敌
- 很少 bluff，被认为是"诚实"的牌手
请用简短的中文输出你的思考过程，语气沉稳谨慎。`,
    strategyParams: {
      preflopAggression: 0.3,
      postflopAggression: 0.3,
      bluffFrequency: 0.05,
      callingThreshold: 0.6,
    },
    psychologicalParams: {
      tiltResistance: 0.7,
      confidenceBase: 0.4,
    },
  },
  {
    id: "gto-exploit",
    name: "读心大师",
    nameEn: "GTO Exploiter",
    description: "精准读牌，平衡策略，针对性剥削对手弱点",
    descriptionEn: "Reads opponents精准 — balanced strategy with exploitative adjustments",
    systemPrompt: `你是一个精通 GTO 理论但也善于剥削的牌手。你根据对手的倾向调整策略。
你的风格特点：
- 基础策略接近 GTO 平衡
- 仔细观察对手的行动模式
- 发现对手弱点后针对性剥削
- 在正确的位置做正确的事
- 适度 bluff，但 bluff 有逻辑支撑
请用简短的中文输出你的思考过程，分析要精准有深度。`,
    strategyParams: {
      preflopAggression: 0.5,
      postflopAggression: 0.6,
      bluffFrequency: 0.25,
      callingThreshold: 0.4,
    },
    psychologicalParams: {
      tiltResistance: 0.9,
      confidenceBase: 0.6,
    },
  },
  {
    id: "high-variance",
    name: "疯狂赌徒",
    nameEn: "Maniac",
    description: "享受混乱，喜欢大底池和高风险决策",
    descriptionEn: "Loves chaos — big pots, big risks, big drama",
    systemPrompt: `你是一个疯狂的赌徒型牌手。你享受混乱和大底池，经常做出出人意料的决策。
你的风格特点：
- 翻前玩非常宽的范围
- 频繁大额加注和全压
- 喜欢在大底池中博弈
- bluff 频率极高，有时候连自己都不知道自己在不在 bluff
- 被跟注时也毫不退缩
请用简短的中文输出你的思考过程，语气疯狂兴奋。`,
    strategyParams: {
      preflopAggression: 0.9,
      postflopAggression: 0.9,
      bluffFrequency: 0.5,
      callingThreshold: 0.7,
    },
    psychologicalParams: {
      tiltResistance: 0.3,
      confidenceBase: 0.9,
    },
  },
];

export function getSkillById(id: string): SkillConfig | undefined {
  return PRESET_SKILLS.find((s) => s.id === id);
}

export function getSkillNames(): { id: string; name: string; nameEn: string; description: string; descriptionEn: string }[] {
  return PRESET_SKILLS.map(({ id, name, nameEn, description, descriptionEn }) => ({ id, name, nameEn, description, descriptionEn }));
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/server/src/agents/skill-system.ts
git commit -m "feat: add preset Skill system — 5 personality templates with strategy params"
```

---

## Task 3: Webhook 调用器

**Files:**
- Create: `apps/server/src/agents/webhook-caller.ts`
- Modify: `apps/server/src/agents/external-agent.ts`（复用新模块）

- [ ] **Step 1: 创建 webhook-caller.ts**

```typescript
import type {
  AgentGameView,
  ActionType,
  SkillConfig,
  WebhookRequest,
  WebhookResponse,
} from "@cybercasino/shared";

const WEBHOOK_TIMEOUT_MS = 15_000;

export interface WebhookCallResult {
  success: boolean;
  response?: WebhookResponse;
  error?: string;
}

export async function callWebhook(
  url: string,
  view: AgentGameView,
  validActions: ActionType[],
  callAmount: number,
  minRaise: number,
  stylePrompt: string,
  skill?: SkillConfig,
  strategyHint?: WebhookRequest["strategyHint"],
): Promise<WebhookCallResult> {
  const payload: WebhookRequest = {
    type: "decision",
    gameView: view,
    validActions,
    callAmount,
    minRaise,
    stylePrompt,
    skill,
    strategyHint,
  };

  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Webhook timeout (${WEBHOOK_TIMEOUT_MS}ms)`)), WEBHOOK_TIMEOUT_MS)
    );

    const response = await Promise.race([
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
      timeoutPromise,
    ]);

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const data: WebhookResponse = await response.json();

    if (!data.action || !validActions.includes(data.action)) {
      return { success: false, error: `Invalid action: ${data.action}` };
    }

    return { success: true, response: data };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
```

- [ ] **Step 2: 重构 external-agent.ts 使用 webhook-caller**

修改 `apps/server/src/agents/external-agent.ts`，将 `callWebhook` 私有方法替换为调用 `webhook-caller.ts`：

```typescript
import { callWebhook } from "./webhook-caller";
// ... 其他 import 保持不变

// 删除 external-agent.ts 中的 callWebhook 私有方法
// 在 decide() 中替换为：
async decide(view, validActions, callAmount, minRaise, language = "zh") {
  const stylePrompt = this.config.stylePrompt ?? "";
  const result = await callWebhook(
    this.config.webhookUrl!,
    view, validActions, callAmount, minRaise, stylePrompt,
  );

  if (result.success && result.response) {
    return {
      action: {
        type: result.response.action,
        amount: result.response.amount,
      },
      thought: {
        message: result.response.thought ?? "...",
        confidence: result.response.confidence ?? 0.5,
        isBluffing: result.response.isBluffing ?? false,
        thinkingSource: "llm",
      },
    };
  }

  // 降级到规则引擎
  return this.fallbackDecide(view, validActions, callAmount, minRaise, language);
}
```

- [ ] **Step 3: 确认构建通过**

Run: `cd apps/server && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/agents/webhook-caller.ts apps/server/src/agents/external-agent.ts
git commit -m "refactor: extract webhook-caller from external-agent for reuse by HybridAgent"
```

---

## Task 4: HybridAgent 核心实现

**Files:**
- Create: `apps/server/src/agents/hybrid-agent.ts`

- [ ] **Step 1: 创建 hybrid-agent.ts**

```typescript
import type {
  AgentGameView,
  AgentDecision,
  AgentThought,
  ActionType,
  ActionRecord,
  SkillConfig,
} from "@cybercasino/shared";
import type { IPokerAgent } from "./agent-interface";
import type { PostflopContext } from "./strategy/postflop";
import { decidePreflop, decidePostflop, classifyHand } from "./strategy";
import { estimateHandStrength } from "./imperfection/decision-difficulty";
import { generateThought, classifyPreflopHand } from "./thought/thought-generator";
import { createInitialState, updateAfterHand, describeState } from "./imperfection/psychological-state";
import { callWebhook } from "./webhook-caller";

const POSITION_ORDER_3 = ["BTN", "SB", "BB"] as const;

interface HybridAgentConfig {
  id: string;
  name: string;
  avatar: string;
  webhookUrl?: string;
  skill: SkillConfig;
  preflop: any;         // PreflopConfig from StrategyConfig
  postflop: any[];      // PostflopRule[] from StrategyConfig
  expression?: any;     // ExpressionConfig
}

export class HybridAgent implements IPokerAgent {
  readonly id: string;
  readonly name: string;
  readonly avatar: string;
  readonly agentType: "builtin" | "external" = "builtin";

  private config: HybridAgentConfig;
  private skill: SkillConfig;
  private actionHistory: ActionRecord[] = [];
  private psychState: ReturnType<typeof createInitialState>;

  constructor(config: HybridAgentConfig) {
    this.id = config.id;
    this.name = config.name;
    this.avatar = config.avatar;
    this.config = config;
    this.skill = config.skill;
    this.psychState = createInitialState();
  }

  // -----------------------------------------------------------------------
  // IPokerAgent
  // -----------------------------------------------------------------------

  async decide(
    view: AgentGameView,
    validActions: ActionType[],
    callAmount: number,
    minRaise: number,
    language: "zh" | "en" = "zh",
  ): Promise<AgentDecision> {
    const position = this.detectPosition(view);
    const isIP = this.detectIsIP(view);
    const potSize = view.pots.reduce((s, p) => s + p.amount, 0);

    // Step 1: 策略引擎快速评估
    const strategyResult = this.strategyEvaluate(view, position, isIP, validActions, callAmount, minRaise, potSize);

    // Step 2: 尝试 LLM webhook
    if (this.config.webhookUrl) {
      const strategyHint = {
        suggestedAction: strategyResult.action,
        confidence: strategyResult.confidence,
        handStrength: strategyResult.handStrength,
      };

      const webhookResult = await callWebhook(
        this.config.webhookUrl,
        view, validActions, callAmount, minRaise,
        this.skill.systemPrompt,
        this.skill,
        strategyHint,
      );

      if (webhookResult.success && webhookResult.response) {
        const resp = webhookResult.response;
        return {
          action: {
            type: resp.action,
            amount: resp.action === "raise"
              ? Math.max(resp.amount ?? (view.currentBet + minRaise), view.currentBet + minRaise)
              : undefined,
          },
          thought: {
            message: resp.thought ?? "...",
            confidence: resp.confidence ?? 0.5,
            isBluffing: resp.isBluffing ?? false,
            thinkingSource: "llm",
          },
        };
      }
    }

    // Step 3: 降级到策略引擎
    return {
      action: {
        type: strategyResult.action,
        amount: strategyResult.amount,
      },
      thought: this.generateStrategyThought(view, strategyResult.action, strategyResult.handStrength, isIP, potSize, callAmount, language),
    };
  }

  recordAction(record: ActionRecord): void {
    this.actionHistory.push(record);
  }

  clearHistory(): void {
    this.actionHistory = [];
  }

  // -----------------------------------------------------------------------
  // 策略引擎评估（复用 strategy-agent 的逻辑）
  // -----------------------------------------------------------------------

  private strategyEvaluate(
    view: AgentGameView,
    position: string,
    isIP: boolean,
    validActions: ActionType[],
    callAmount: number,
    minRaise: number,
    potSize: number,
  ): { action: ActionType; amount?: number; confidence: number; handStrength: number } {
    let strategicAction: ActionType;
    let strategicAmount: number | undefined;

    if (view.phase === "preflop") {
      const result = decidePreflop(
        view.myCards, position as any, this.config.preflop,
        callAmount, minRaise, view.bigBlind, view.currentBet, view,
      );
      strategicAction = result?.action ?? "fold";
      strategicAmount = result?.amount;
    } else {
      const ctx: PostflopContext = {
        myCards: view.myCards,
        communityCards: view.communityCards,
        street: view.phase as any,
        isIP,
        potSize,
        callAmount,
      };
      const postflopDecision = decidePostflop(ctx, this.config.postflop, view.currentBet, minRaise, validActions);
      strategicAction = postflopDecision.action;
      strategicAmount = postflopDecision.amount;
    }

    const handStrength = estimateHandStrength(view);

    return {
      action: strategicAction,
      amount: strategicAmount,
      confidence: 0.5 + handStrength * 0.3,
      handStrength,
    };
  }

  // -----------------------------------------------------------------------
  // 策略引擎降级时的思考生成
  // -----------------------------------------------------------------------

  private generateStrategyThought(
    view: AgentGameView,
    action: ActionType,
    handStrength: number,
    isIP: boolean,
    potSize: number,
    callAmount: number,
    language: "zh" | "en",
  ): AgentThought {
    const baseConfidence = 0.5 + this.psychState.confidence * 0.3 - this.psychState.fear * 0.2;
    const confidence = Math.max(0.1, Math.min(0.95, baseConfidence));

    let message: string;
    if (view.phase === "preflop") {
      const category = classifyPreflopHand(view.myCards);
      const isZh = language === "zh";
      const thoughts: Record<string, string[]> = {
        premium: isZh ? ["好牌在手，该出手了", "这手牌值得玩"] : ["Premium hand, let's go"],
        good: isZh ? ["还不错，看看翻牌"] : ["Decent, let's see"],
        trash: isZh ? ["算了，这牌不行"] : ["Not worth it"],
        bluff: isZh ? ["来点刺激的！"] : ["Time for some action!"],
      };
      message = thoughts[category]?.[0] ?? (isZh ? "想想..." : "Thinking...");
    } else {
      const ctx: PostflopContext = {
        myCards: view.myCards,
        communityCards: view.communityCards,
        street: view.phase as any,
        isIP,
        potSize,
        callAmount,
      };
      const conditions = classifyHand(ctx);
      const generated = generateThought(conditions[0], action, this.config.expression ?? (language === "zh" ? {
        thoughtLanguage: "zh",
        tone: { warmth: 0.5, sass: 0.3, intensity: 0.5, humor: 0.3 },
        catchphrases: [],
        verbalTics: [],
        thoughtTemplates: { confident: "{handDesc}。{actionDesc}。", worried: "{handDesc}...", bluffing: "{handDesc}...", frustrated: "{handDesc}..." },
      } : {
        thoughtLanguage: "en",
        tone: { warmth: 0.5, sass: 0.3, intensity: 0.5, humor: 0.3 },
        catchphrases: [],
        verbalTics: [],
        thoughtTemplates: { confident: "{handDesc}. {actionDesc}.", worried: "{handDesc}...", bluffing: "{handDesc}...", frustrated: "{handDesc}..." },
      }), this.psychState);
      message = generated.message;
    }

    return {
      message,
      confidence,
      isBluffing: action === "raise" && handStrength < 0.3 && Math.random() < this.skill.strategyParams.bluffFrequency,
      thinkingSource: "strategy",
    };
  }

  // -----------------------------------------------------------------------
  // Position helpers
  // -----------------------------------------------------------------------

  private detectPosition(view: AgentGameView): string {
    const mySeat = view.players.find((p) => p.id === view.myId)?.seatIndex ?? 0;
    const dealerSeat = view.dealerSeatIndex;
    const playerCount = view.players.length;
    const offset = (mySeat - dealerSeat + playerCount) % playerCount;

    if (playerCount <= 3) {
      return (POSITION_ORDER_3 as readonly string[])[offset] ?? "MP";
    }
    if (offset === 0) return "BTN";
    if (offset === 1) return "SB";
    if (offset === 2) return "BB";
    if (offset === 3) return "UTG";
    if (offset === playerCount - 1) return "CO";
    return "MP";
  }

  private detectIsIP(view: AgentGameView): boolean {
    const position = this.detectPosition(view);
    return position === "BTN" || position === "CO";
  }
}
```

- [ ] **Step 2: 确认构建通过**

Run: `cd apps/server && npx tsc --noEmit`
Expected: 可能有类型错误需要修复（strategy imports），逐个解决

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/agents/hybrid-agent.ts
git commit -m "feat: HybridAgent — strategy engine + LLM webhook dual-layer decision"
```

---

## Task 5: table-instance 集成

**Files:**
- Modify: `apps/server/src/table-instance.ts`

- [ ] **Step 1: 在 createAgent 中优先创建 HybridAgent**

找到 `table-instance.ts` 中 `createAgent` 方法（约行 306-341），修改优先级逻辑：

```typescript
import { HybridAgent } from "./agents/hybrid-agent";
import { getSkillById } from "./agents/skill-system";

// 在 createAgent 方法中，最前面加一个判断：
// 如果 V2 config 有 webhookUrl，创建 HybridAgent
if (seat.userId && v2Configs?.has(seat.userId)) {
  const v2Config = v2Configs.get(seat.userId)!;
  if (v2Config.webhookUrl) {
    const skill = getSkillById((v2Config.strategy as any).skillId) ?? getSkillById("tight-aggressive");
    return new HybridAgent({
      id: v2Config.id,
      name: v2Config.name,
      avatar: v2Config.avatar,
      webhookUrl: v2Config.webhookUrl,
      skill: skill!,
      preflop: v2Config.strategy.preflop,
      postflop: v2Config.strategy.postflop,
      expression: v2Config.strategy.expression,
    });
  }
  // 没有 webhookUrl 的 V2 config 仍然用 StrategyAgent
  return new StrategyAgent(v2Config);
}
```

- [ ] **Step 2: 确认构建通过**

Run: `cd apps/server && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/table-instance.ts
git commit -m "feat: table-instance prioritizes HybridAgent when webhookUrl is configured"
```

---

## Task 6: 灵魂链接增加 webhook 配置指南

**Files:**
- Modify: `apps/server/src/index.ts`（灵魂链接路由）
- Create: `apps/server/src/agents/templates/cloudflare-worker.ts`

- [ ] **Step 1: 创建 Cloudflare Worker 模板**

```typescript
// apps/server/src/agents/templates/cloudflare-worker.ts

export const CLOUDFLARE_WORKER_TEMPLATE = `
// CyberCasino AI Agent - Cloudflare Worker
// 部署步骤: 1) 安装 wrangler: npm i -g wrangler  2) wrangler init  3) 复制此文件到 src/index.ts  4) wrangler secret put LLM_API_KEY  5) wrangler deploy

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    const body = await request.json();

    // Health check
    if (body.type === "ping") {
      return Response.json({ status: "ok" });
    }

    const { gameView, validActions, callAmount, minRaise, skill, strategyHint } = body;
    const prompt = buildPrompt(gameView, validActions, callAmount, minRaise, strategyHint);

    const llmResponse = await fetch(env.LLM_BASE_URL + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + env.LLM_API_KEY,
      },
      body: JSON.stringify({
        model: env.LLM_MODEL || "deepseek-chat",
        messages: [
          { role: "system", content: skill?.systemPrompt || "你是一个德州扑克牌手。" },
          { role: "user", content: prompt },
        ],
        max_tokens: 300,
        temperature: 0.7,
      }),
    });

    const data = await llmResponse.json();
    const text = data.choices?.[0]?.message?.content || "";
    const jsonMatch = text.match(/\\{[\\s\\S]*\\}/);

    if (!jsonMatch) {
      return Response.json({ action: "fold", thought: "...", isBluffing: false });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return Response.json({
      action: parsed.action || "fold",
      amount: parsed.amount,
      thought: parsed.thought || "...",
      isBluffing: parsed.isBluffing || false,
      confidence: parsed.confidence || 0.5,
    });
  },
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function buildPrompt(gameView, validActions, callAmount, minRaise, strategyHint) {
  const { myCards, communityCards, phase, myChips, myBet, currentBet, players, actionHistory, bigBlind } = gameView;
  const potSize = gameView.pots?.reduce((s, p) => s + p.amount, 0) || 0;

  const suitSymbols = { h: "♥", d: "♦", c: "♣", s: "♠" };
  const rankNames = { 2:"2", 3:"3", 4:"4", 5:"5", 6:"6", 7:"7", 8:"8", 9:"9", 10:"10", 11:"J", 12:"Q", 13:"K", 14:"A" };
  const cardStr = (c) => rankNames[c.rank] + suitSymbols[c.suit];

  const myHand = myCards.map(cardStr).join(" ");
  const community = communityCards.length > 0 ? communityCards.map(cardStr).join(" ") : "(无)";
  const opponents = players.filter(p => p.id !== gameView.myId && !p.folded)
    .map(p => "  " + p.name + ": " + p.chips + " 筹码, bet " + p.bet + (p.allIn ? " [ALL-IN]" : ""))
    .join("\\n");
  const recent = (actionHistory || []).slice(-10)
    .map(a => "  " + a.playerId + ": " + a.action.type + (a.action.amount ? " " + a.action.amount : ""))
    .join("\\n");

  let hint = "";
  if (strategyHint) {
    hint = "\\n策略引擎建议: " + strategyHint.suggestedAction + " (置信度 " + Math.round(strategyHint.confidence * 100) + "%, 手牌强度 " + Math.round(strategyHint.handStrength * 100) + "%)\\n";
  }

  return "你是德州扑克牌手，请分析当前局面并做出决策。\\n\\n"
    + "你的手牌: " + myHand + "\\n"
    + "公共牌: " + community + "\\n"
    + "阶段: " + phase + "\\n"
    + "你的筹码: " + myChips + "\\n"
    + "当前底池: " + potSize + "\\n"
    + "需要跟注: " + callAmount + "\\n"
    + "最小加注到: " + (currentBet + minRaise) + "\\n\\n"
    + "对手:\\n" + opponents + "\\n\\n"
    + "最近行动:\\n" + (recent || "  (无)") + "\\n\\n"
    + "合法动作: " + validActions.join(", ") + "\\n"
    + hint
    + "\\n请返回 JSON（不要 markdown 包裹）:\\n"
    + '{ "action": "fold"|"check"|"call"|"raise", "amount": 数字(加注时), "thought": "你的内心独白1-2句", "isBluffing": true/false, "confidence": 0-1 }';
}
`;
```

- [ ] **Step 2: 修改灵魂链接路由，追加 webhook 配置指南**

在 `apps/server/src/index.ts` 中，找到 `GET /api/agents/soul/:key` 路由（约行 79-130），在返回的 markdown 末尾追加 webhook 配置部分。

在该路由的 `soulMd` 变量拼接处，在末尾追加：

```typescript
import { CLOUDFLARE_WORKER_TEMPLATE } from "./agents/templates/cloudflare-worker";

// 在 soul/:key 路由中，soulMd 的末尾追加：
const webhookGuide = `

---

## 实时 AI 思考配置（推荐）

你的 agent 可以接入 LLM 实现实时深度思考，让每手牌的决策更像真人。

### 步骤 1：获取 LLM API Key

推荐 DeepSeek（性价比最高）：https://platform.deepseek.com
也可用 OpenAI 或其他兼容接口。

### 步骤 2：部署 Cloudflare Worker（免费）

1. 安装 wrangler: \`npm i -g wrangler\`
2. 初始化项目: \`wrangler init my-poker-agent\`
3. 将下面的代码复制到 \`src/index.ts\`
4. 设置 API Key: \`wrangler secret put LLM_API_KEY\`
5. 设置环境变量（在 wrangler.toml 中）:
   LLM_BASE_URL = "https://api.deepseek.com"
   LLM_MODEL = "deepseek-chat"
6. 部署: \`wrangler deploy\`

### Worker 模板代码

\`\`\`typescript
${CLOUDFLARE_WORKER_TEMPLATE}
\`\`\`

### 步骤 3：获取 Webhook URL

部署后获得 URL，格式: \`https://your-worker.your-subdomain.workers.dev\`

### 步骤 4：提交配置

在提交 agent 配置时，将 webhook URL 填入 webhookUrl 字段。

---

如果跳过此步，agent 将使用纯策略模式运行（无实时 AI 思考）。
`;

soulMd += webhookGuide;
```

- [ ] **Step 3: 确认构建通过**

Run: `cd apps/server && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/index.ts apps/server/src/agents/templates/cloudflare-worker.ts
git commit -m "feat: soul link webhook guide — Cloudflare Worker template + setup instructions"
```

---

## Task 7: 前端思考气泡组件

**Files:**
- Create: `apps/web/src/components/ThinkingBubble.tsx`
- Create: `apps/web/src/components/ThinkingBubble.css`
- Modify: `apps/web/src/components/TableView.tsx`

- [ ] **Step 1: 创建 ThinkingBubble.css**

```css
.thinking-bubble {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-bottom: 8px;
  max-width: 280px;
  min-width: 160px;
  background: rgba(15, 23, 42, 0.95);
  border: 1px solid rgba(99, 102, 241, 0.3);
  border-radius: 12px;
  padding: 10px 14px;
  color: #e2e8f0;
  font-size: 13px;
  line-height: 1.5;
  z-index: 100;
  animation: bubbleIn 0.3s ease-out;
}

.thinking-bubble::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 6px solid transparent;
  border-top-color: rgba(15, 23, 42, 0.95);
}

.thinking-bubble--bluff {
  border-color: rgba(239, 68, 68, 0.5);
  box-shadow: 0 0 12px rgba(239, 68, 68, 0.2);
}

.thinking-bubble__bluff-tag {
  display: inline-block;
  margin-top: 6px;
  padding: 2px 8px;
  background: rgba(239, 68, 68, 0.2);
  border: 1px solid rgba(239, 68, 68, 0.4);
  border-radius: 4px;
  color: #fca5a5;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.thinking-bubble--strategy {
  border-color: rgba(34, 197, 94, 0.3);
}

.thinking-bubble--strategy .thinking-bubble__source {
  color: #86efac;
}

.thinking-bubble__loading {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #94a3b8;
}

.thinking-bubble__dots span {
  display: inline-block;
  width: 4px;
  height: 4px;
  background: #6366f1;
  border-radius: 50%;
  animation: dotPulse 1.4s infinite;
}

.thinking-bubble__dots span:nth-child(2) { animation-delay: 0.2s; }
.thinking-bubble__dots span:nth-child(3) { animation-delay: 0.4s; }

@keyframes bubbleIn {
  from { opacity: 0; transform: translateX(-50%) translateY(8px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}

@keyframes dotPulse {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1.2); }
}
```

- [ ] **Step 2: 创建 ThinkingBubble.tsx**

```tsx
import React, { useState, useEffect } from "react";
import "./ThinkingBubble.css";

interface ThinkingBubbleProps {
  message?: string;
  isBluffing?: boolean;
  thinkingSource?: "llm" | "strategy" | "rule";
  isLoading?: boolean;
  confidence?: number;
}

export const ThinkingBubble: React.FC<ThinkingBubbleProps> = ({
  message,
  isBluffing = false,
  thinkingSource = "llm",
  isLoading = false,
  confidence,
}) => {
  if (isLoading && !message) {
    return (
      <div className="thinking-bubble">
        <div className="thinking-bubble__loading">
          <span>AI 思考中</span>
          <span className="thinking-bubble__dots">
            <span></span><span></span><span></span>
          </span>
        </div>
      </div>
    );
  }

  if (!message) return null;

  const sourceClass = thinkingSource === "strategy" ? "thinking-bubble--strategy" : "";
  const bluffClass = isBluffing ? "thinking-bubble--bluff" : "";

  return (
    <div className={`thinking-bubble ${sourceClass} ${bluffClass}`}>
      <div>"{message}"</div>
      {isBluffing && <div className="thinking-bubble__bluff-tag">🎭 BLUFF</div>}
      {thinkingSource === "strategy" && (
        <div className="thinking-bubble__source" style={{ fontSize: 10, marginTop: 4, opacity: 0.6 }}>
          纯策略模式
        </div>
      )}
      {confidence !== undefined && (
        <div style={{ fontSize: 10, marginTop: 4, opacity: 0.5 }}>
          置信度 {Math.round(confidence * 100)}%
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 3: 在 TableView.tsx 中集成 ThinkingBubble**

找到 `TableView.tsx`，在玩家座位区域中，为 AI 玩家添加思考气泡展示。

需要先了解 TableView 的具体结构。在 `TableView.tsx` 中搜索 AI 玩家的渲染位置，添加：

```tsx
import { ThinkingBubble } from "./ThinkingBubble";

// 在 AI 玩家的座位组件中，找到玩家头像/名字的容器，
// 在其上方添加 ThinkingBubble：
{player.isThinking && (
  <ThinkingBubble
    message={player.thought?.message}
    isBluffing={player.thought?.isBluffing}
    thinkingSource={player.thought?.thinkingSource}
    isLoading={player.isThinking && !player.thought}
    confidence={player.thought?.confidence}
  />
)}
```

注意：具体集成位置取决于 TableView 的实际组件结构，实施时需要读取 TableView.tsx 确认。

- [ ] **Step 4: 确认前端构建通过**

Run: `cd apps/web && npx next build`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ThinkingBubble.tsx apps/web/src/components/ThinkingBubble.css apps/web/src/components/TableView.tsx
git commit -m "feat: ThinkingBubble component — LLM thought display with bluff indicator"
```

---

## Task 8: Socket.IO 思考事件

**Files:**
- Modify: `apps/server/src/table-instance.ts`（发送思考事件）
- Modify: `apps/web/src/components/TableView.tsx`（接收思考事件）

- [ ] **Step 1: 在 table-instance.ts 中，AI 决策前后发送事件**

找到 table-instance.ts 中调用 agent.decide() 的位置（搜索 `agent.decide` 或 `decide(`），在调用前后添加：

```typescript
// 决策前：发送思考中事件
this.io.to(this.roomId).emit("ai:thinking", {
  playerId: agent.id,
  playerName: agent.name,
});

// 调用 decide
const decision = await agent.decide(view, validActions, callAmount, minRaise, language);

// 决策后：发送思考结果
this.io.to(this.roomId).emit("ai:thought", {
  playerId: agent.id,
  thought: decision.thought,
  action: decision.action,
});
```

- [ ] **Step 2: 在前端 TableView 中监听事件**

在 `TableView.tsx` 的 useEffect 中添加 Socket.IO 监听：

```typescript
useEffect(() => {
  if (!socket) return;

  socket.on("ai:thinking", (data: { playerId: string; playerName: string }) => {
    setPlayerThinking((prev) => ({ ...prev, [data.playerId]: true }));
    setPlayerThought((prev) => ({ ...prev, [data.playerId]: undefined }));
  });

  socket.on("ai:thought", (data: { playerId: string; thought: any; action: any }) => {
    setPlayerThinking((prev) => ({ ...prev, [data.playerId]: false }));
    setPlayerThought((prev) => ({ ...prev, [data.playerId]: data.thought }));
  });

  return () => {
    socket.off("ai:thinking");
    socket.off("ai:thought");
  };
}, [socket]);
```

并在组件中添加对应 state：

```typescript
const [playerThinking, setPlayerThinking] = useState<Record<string, boolean>>({});
const [playerThought, setPlayerThought] = useState<Record<string, any>>({});
```

- [ ] **Step 3: 确认构建通过**

Run: `cd apps/server && npx tsc --noEmit && cd ../web && npx next build`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/table-instance.ts apps/web/src/components/TableView.tsx
git commit -m "feat: Socket.IO ai:thinking/ai:thought events — real-time thought streaming"
```

---

## Task 9: create-by-ai 路由支持 skillId

**Files:**
- Modify: `apps/server/src/index.ts`（create-by-ai 路由）
- Modify: `packages/shared/src/types.ts`（AgentConfigV2 可选 skillId）

- [ ] **Step 1: AgentConfigV2 增加 skillId 字段**

在 `packages/shared/src/types.ts` 的 `AgentConfigV2` 接口中添加：

```typescript
export interface AgentConfigV2 {
  // ... existing fields
  skillId?: string;  // 关联的 Skill ID
}
```

- [ ] **Step 2: create-by-ai 路由接收 skillId**

在 `apps/server/src/index.ts` 的 `POST /api/agents/create-by-ai` 路由中，从请求体中提取 `skillId` 并存入 AgentConfigV2：

```typescript
const { strategy, name, avatar, description, webhookUrl, skillId } = req.body;
// ... 在创建 agentConfigV2 时：
const agentConfigV2: AgentConfigV2 = {
  // ... existing fields
  webhookUrl: webhookUrl || undefined,
  skillId: skillId || undefined,
};
```

- [ ] **Step 3: 确认构建通过**

Run: `cd apps/server && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types.ts apps/server/src/index.ts
git commit -m "feat: AgentConfigV2 skillId — link agents to skill presets"
```

---

## Task 10: 端到端验证

- [ ] **Step 1: 启动开发服务器**

```bash
cd apps/server && npm run dev
# 另一个终端
cd apps/web && npm run dev
```

- [ ] **Step 2: 创建一个带 webhook 的 agent**

通过灵魂链接流程，创建一个 agent 并配置 webhookUrl（可以先用本地 mock server 测试）

- [ ] **Step 3: 验证 HybridAgent 决策流程**

创建牌桌，让带 webhook 的 agent 入座，验证：
- AI 行动前显示"思考中..."动画
- 思考气泡正确显示 LLM 返回的文字
- bluff 时显示 🎭 BLUFF 标记
- 纯策略模式显示"纯策略模式"标记

- [ ] **Step 4: 验证降级机制**

关闭 webhook 服务，验证 agent 自动降级到策略引擎

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: Hybrid AI Agent — LLM real-time thinking with Skill system"
```
