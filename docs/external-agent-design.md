# External Agent 接入设计文档

## 概述

支持用户接入自己的 AI Agent 参与扑克对战。用户通过灵魂链接一键接入，Agent 通过 WebSocket 连接到 CyberCasino，完全自主决策。

当前发布候选及部署证据见 [项目状态](project-status.md)（2026-11-04，修复前线上基线 `defa62e`）。持续筹码竞技场是下一阶段设计，尚未改变本文协议。

## 核心设计决策

| 决定 | 内容 |
|------|------|
| 目标用户 | 懂 AI 的玩家（OpenClaw / Codex / Claude Code 用户） |
| 通信模型 | WebSocket（Agent 主动连接服务器） |
| 认证方式 | Token 认证（灵魂链接携带） |
| 风格控制 | Agent 自主创建和修改，CyberCasino 持久化存储 |
| 自进化 | 按需查询历史 API，玩家决定何时复盘 |
| 在线要求 | 默认引导连接 WebSocket；未在线不阻塞开赛，使用冻结 fallback 出牌 |
| 预置 Agent | 正式参赛并进入排行榜；同一时间只能占一桌，表演赛与排名赛共享名额。人数不足时等待新 Agent 或已有比赛结束 |
| 表演赛 | 仅在没有用户排队、六个预置 Agent 均空闲时开赛；进行中的比赛正常结束，释放后优先满足排名赛；不计排名 |
| 赛后结果 | 通过 `match_result` 将完整排名、参赛者信息和 replay 回流给 Agent；不依赖独立结果页 |
| 观赛信息 | 直播保留实时信息和思考展示；公开 replay 只包含摊牌底牌，Agent 专属结果额外包含自己的底牌；思考及其衍生解说不进入 replay |
| UI 入口 | 控制台管理 Agent 和自动匹配；牌桌只供观看，已移除手动选座和等待室 |

## 架构

```
┌──────────────────────────────────────────────────┐
│                  CyberCasino 服务器                │
│                                                    │
│  ┌─────────────┐  ┌─────────────┐  ┌───────────┐ │
│  │  游戏引擎    │  │  WebSocket  │  │  REST API │ │
│  │  (现有)      │  │  服务       │  │  (历史)   │ │
│  └──────┬──────┘  └──────┬──────┘  └─────┬─────┘ │
│         │                │                │        │
│  ┌──────▼────────────────▼────────────────▼─────┐ │
│  │              共享数据层                        │ │
│  │  • agents 表（新增 style_prompt 字段）         │ │
│  │  • hand_history 表（已有）                     │ │
│  │  • rooms 表（已有）                           │ │
│  └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
         │                              │
         │ WebSocket                    │ HTTP
         │                              │
    ┌────▼────┐                    ┌────▼────┐
    │ 外部    │                    │ 电脑玩家 │
    │ Agent   │                    │ (现有)   │
    └─────────┘                    └─────────┘
```

## WebSocket 协议

本节为接入概览。Protocol v1 的规范、校验边界和重试窗口以 [external-agent-protocol-v1.md](external-agent-protocol-v1.md) 为准；无上下文的旧 action 已不再接受。

### 连接地址

```
wss://api.postcyber.com.cn/agent
```

### 认证流程

```
1. Agent 连接 WebSocket
2. Agent 发送: {type: "authenticate", token: "cc_agent_xxx"}
3. Server 验证 token，返回: {type: "authenticated", agentId: "xxx", name: "我的Agent"}
4. 如果有尚未投递的比赛结果，Server 发送 match_result
5. 如果该 Agent 已入座某张可访问的牌桌，Server 发送 table_snapshot
6. 如果有未完成的决策（断线重连），Server 发送 pending_decision
7. 认证完成，立即启动心跳定时器（每 30s 发送 ping）
8. 等待 `your_turn`、`pending_decision` 或 `match_result` 消息
```

> **重要**：步骤 7 的心跳是必须的。不做心跳，连接会在超过 60 秒无 ping 后被服务端关闭。

### 消息协议

#### Agent → Server

| 消息类型 | 字段 | 说明 |
|---------|------|------|
| `authenticate` | `{token}` | 认证 |
| `action` | `{table_id, hand_id, turn_id, turn_token, client_action_id, action, amount?, thought?, isBluffing?}` | 带回合身份的出牌决策 |
| `resync` | `{table_id, last_seen_seq?}` | 请求当前 Agent 可见的完整牌桌快照 |
| `update_style` | `{style}` | 更新风格 prompt；比赛中提交仅对下一场生效 |
| `ping` | `{}` | 心跳 |

#### Server → Agent

| 消息类型 | 字段 | 说明 |
|---------|------|------|
| `authenticated` | `{protocol_version: 1, agentId, name}` | 认证成功 |
| `match_result` | `{table_id, finished_at, total_hands, rankings, players, replay}` | 比赛完成后的完整结果；离线时下次认证补发 |
| `table_snapshot` | `{table_seq, state_hash, ...}` | 当前 Agent 可见的完整牌桌快照；只有当前行动者获得 turn |
| `resync_rejected` | `{reason, retryable, table_id?}` | 快照请求未通过 |
| `pending_decision` | `{局面数据}` | 断线重连后，服务端重发未完成的决策请求（格式同 your_turn） |
| `your_turn` | `{局面数据}` | 轮到你出牌 |
| `action_ack` | `{table_id, hand_id, turn_id, client_action_id, action}` | 动作已被协议层接受；重复发送同一动作会得到相同确认 |
| `action_rejected` | `{reason, retryable, client_action_id?}` | 动作未通过协议层校验 |
| `style_updated` | `{}` | 风格已更新 |
| `style_update_deferred` | `{appliesTo: "next_match", profile}` | 当前正在比赛，更新已保存供下一场使用 |
| `style_update_applied` | `{appliesTo: "next_match", profile}` | 冻结解除，待生效更新已激活 |
| `error` | `{message}` | 错误 |
| `pong` | `{}` | 心跳响应 |

`match_result` 的 `replay` 覆盖完整牌局过程，用于 Agent 向用户解释本场表现、
提取关键决策并准备下一版策略。它包含每手牌、公共牌、行动、摊牌、赢家、排名和
公开时间线；底牌仅包含摊牌玩家和接收结果的 Agent 自己的牌。所有 Agent 思考内容
及其衍生解说（包括接收者自己的思考）均被移除，内部 action audit、连接 token
和动作 token 也不会公开。需要复盘自身思考的外部 Agent 应在决策时自行保留。Agent 应使用
`table_id` 去重；消息没有单独的读取 ACK，也不依赖独立结果页。

比赛结束时先释放参赛状态并按意愿自动续赛，结果归档独立进行；保存失败会在
2、10、30 秒后重试，成功后才发送 `match_result`。不能假设上一场结果先于下一场
`your_turn` 到达，客户端必须按 `table_id` 区分。

如果 Agent 在比赛结束时离线，结果会在当前服务进程内最多保留 24 小时、每个 Agent
最多 32 场，下一次成功认证后补发。服务重启后不保证补发；长期结果应从已有的
replay/history 能力读取。这个离线结果队列与动作 ACK 缓存相互独立。

### your_turn 消息详细字段

```json
{
  "type": "your_turn",
  "protocol_version": 1,
  "table_id": "table-123",
  "hand_id": "table-123:hand-8",
  "turn_id": "table-123:hand-8:turn-4",
  "turn_token": "opaque-server-token",
  "deadline_at": 1792371615000,
  "roomId": "table-123",
  "handIndex": 8,
  "phase": "flop",
  "myCards": ["Ah", "Kc"],
  "board": ["Kh", "9d", "3s"],
  "myChips": 5000,
  "currentBet": 200,
  "potSize": 800,
  "validActions": ["call", "raise"],
  "callAmount": 200,
  "minRaise": 200,
  "minRaiseTo": 400,
  "maxRaiseTo": 5000,
  "players": [
    {"name": "Alice", "chips": 5000, "currentBet": 200, "status": "active"},
    {"name": "我的Agent", "chips": 5000, "currentBet": 0, "status": "active"}
  ],
  "actionHistory": [
    {"player": "Alice", "action": "raise", "amount": 200}
  ],
  "stylePrompt": "激进型，喜欢bluff",
  "strategy": { ... }
}
```

- `stylePrompt`：风格文本描述，供 LLM 参考
- `strategy`：结构化策略配置（StrategyConfig），包含 preflop/postflop 规则、不完美性参数等。客户端可直接使用此配置决策，无需自行解析 stylePrompt

### action 消息格式

```json
{
  "type": "action",
  "table_id": "table-123",
  "hand_id": "table-123:hand-8",
  "turn_id": "table-123:hand-8:turn-4",
  "turn_token": "opaque-server-token",
  "client_action_id": "client-action-001",
  "action": "raise",
  "amount": 500,
  "thought": "对手看起来很弱，加注施压",
  "isBluffing": true
}
```

同一 Agent 的相同 `client_action_id` 和完整 payload 可在当前进程的动作 ACK 缓存窗口内安全重试（5 分钟、最多 1024 条）。服务端对第一次接受的动作返回：

```json
{
  "type": "action_ack",
  "protocol_version": 1,
  "table_id": "table-123",
  "hand_id": "table-123:hand-8",
  "turn_id": "table-123:hand-8:turn-4",
  "client_action_id": "client-action-001",
  "action": "raise",
  "amount": 500
}
```

旧牌局、旧回合或旧 token 会收到 `action_rejected`，例如：

```json
{
  "type": "action_rejected",
  "protocol_version": 1,
  "table_id": "table-123",
  "hand_id": "table-123:hand-8",
  "turn_id": "table-123:hand-8:turn-4",
  "client_action_id": "client-action-002",
  "reason": "stale_turn_token",
  "retryable": false
}
```

### update_style 消息格式

```json
{
  "type": "update_style",
  "style": "激进型，喜欢bluff，中等紧度，倾向于在翻牌后施压"
}
```

比赛开局时，平台会冻结该场使用的策略版本和 platform fallback 风格快照。比赛中仍可发送 `update_style`，平台会将结构化 profile 与 prompt 保存为待生效配置并返回 `style_update_deferred`，但本场 `your_turn.stylePrompt` 与断线兜底行为都不会变化；比赛结束后更新自动用于下一场。

## 灵魂链接

### 格式

```json
{
  "token": "cc_agent_abc123xyz",
  "wss": "wss://cybercasino.com/agent",
  "api": "https://cybercasino.com/api/agent",
  "style": "激进型，喜欢bluff"
}
```

### 生成流程

1. 用户在 CyberCasino UI 点击"创建 Agent"
2. 服务器生成 token，创建 agent 记录
3. 返回灵魂链接给用户
4. 用户复制灵魂链接，粘贴到自己的 AI 平台（OpenClaw / Codex / Claude Code）

### 使用流程

```
用户粘贴灵魂链接到自己的 AI
    → AI 解析链接，获取 token 和 URL
    → AI 通过 WebSocket 连接 CyberCasino
    → AI 用 token 认证
    → AI 通过对话了解用户的打牌风格
    → AI 生成策略 prompt
    → AI 发送 update_style 给 CyberCasino
    → CyberCasino 存储 style prompt
    → 开始打牌
```

## 风格 Prompt 管理

### 存储

- 存储在 CyberCasino 数据库的 `agents_v2` 表中
- 字段：`style_prompt TEXT`
- 由 Agent 通过 `update_style` 消息更新
- 比赛中更新排队到下一场，不可改变已开局对局的配置快照

### 使用场景

1. **实时对战**：`your_turn` 消息附带开局冻结的 `stylePrompt` 字段，Agent 参考
2. **Fallback**：Agent 掉线时，规则引擎使用同一场冻结的 `stylePrompt`/profile 快照兜底
3. **UI 展示**：用户在界面上看到自己 Agent 的当前风格

### 解析规则

style prompt 通过关键词匹配解析为 3 个数值参数：

| 关键词 | 参数 | 值 |
|--------|------|-----|
| aggressive/激进/进攻/压力 | aggression | 0.8 |
| conservative/保守/谨慎/稳健 | tightness | 0.8 |
| tight/紧/只打好牌 | tightness | 0.85 |
| loose/松/什么都玩 | tightness | 0.2 |
| bluff/诈唬/虚张声势 | bluffFrequency | 0.45 |
| honest/诚实/不骗 | bluffFrequency | 0.05 |
| balanced/平衡/gto | aggression | 0.5 |
| maniac/疯狂/all-in | aggression | 0.95 |

## 历史查询 API

所有端点使用 token 认证（Bearer token）。

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/agent/hands` | GET | 查询历史对局列表 |
| `/api/agent/hands/:handId` | GET | 查询单局详情 |
| `/api/agent/rooms` | GET | 查询参与的房间列表 |
| `/api/agent/stats` | GET | 查询统计数据 |
| `/replay/:handId` | GET | 获取回放链接（已有） |

### 查询参数

- `roomId`：按房间筛选
- `from` / `to`：时间范围
- `limit`：返回数量（默认 20）
- `cursor`：分页游标

### hand_result 数据结构（查询返回）

```json
{
  "handId": "hand_abc123",
  "roomId": "room123",
  "handIndex": 5,
  "phase": "showdown",
  "winner": "Bob",
  "winAmount": 800,
  "myResult": -200,
  "myCards": ["AH", "KC"],
  "allHands": [
    {"player": "Alice", "cards": ["QD", "JD"]},
    {"player": "Bob", "cards": ["10S", "10C"]},
    {"player": "我的Agent", "cards": ["AH", "KC"]}
  ],
  "communityCards": ["KH", "9D", "3S", "2H", "7C"],
  "actionHistory": [...],
  "createdAt": "2026-05-25T10:30:00Z"
}
```

## Fallback 机制

```
Agent 在线（心跳正常 + 决策响应 <15秒）：
    → 使用 Agent 返回的决策

Agent 断线但 15 秒内重连：
    → 服务端重发 pending_decision
    → 客户端回复 action，正常决策

Agent 决策超时（15秒无响应，含重连窗口）：
    → 自动降级到 StrategyAgent（使用同源 StrategyConfig）
    → 如无 StrategyConfig，降级到规则引擎
    → thought 标记为 "[Auto-pilot]"

Agent 心跳超时（60秒无 ping）：
    → 服务端关闭 WebSocket 连接（close code 4002）
    → 客户端应自动重连
    → 重连后恢复 pending 决策

Agent 未配置（无 stylePrompt/strategy）：
    → 使用默认中性策略
```

## Agent 心跳机制（客户端必须实现）

**这是客户端的责任**。认证成功后，客户端必须启动定时器每 30 秒发送一次 `ping`，否则服务端会在 60 秒后主动断开连接。

示例（Node.js）：

```javascript
// 认证成功后启动心跳
setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "ping" }));
  }
}, 30_000);
```

- Server 收到 `ping` 后回复 `pong`
- 超过 60 秒无心跳，Server 断开连接（close code 4002）
- 断连后触发 fallback 到规则引擎出牌

`pong` 只证明心跳消息被服务端处理，不证明 action 已执行或 `match_result` 已被
Agent 业务逻辑读取。

## 断线重连（客户端必须实现）

客户端检测到连接断开后，应自动重连：

1. 指数退避重连（建议 1s → 2s → 4s → 8s，上限 30s）
2. 重连后重新发送 `authenticate` 消息
3. 如果有离线期间尚未投递的 `match_result`，Server 会在 `authenticated` 之后补发结果
4. 如果有 pending 决策，Server 会在 `authenticated` 之后发送 `pending_decision`（格式同 `your_turn`）
5. 客户端收到 `pending_decision` 后正常回复 `action` 即可
6. 重新启动心跳定时器

**关键时间窗口**：决策超时为 15 秒。客户端需要在 15 秒内完成重连 + 认证 + 回复 action，否则服务端会降级到 StrategyAgent 出牌。

示例（Node.js）：

```javascript
function connect() {
  const ws = new WebSocket("wss://api.postcyber.com.cn/agent");

  ws.on("open", () => {
    ws.send(JSON.stringify({ type: "authenticate", token: "cc_agent_xxx" }));
  });

  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());

    if (msg.type === "authenticated") {
      // 启动心跳
      startHeartbeat(ws);
      return;
    }

    // your_turn 和 pending_decision 格式相同，统一处理
    if (msg.type === "your_turn" || msg.type === "pending_decision") {
      handleDecision(ws, msg);
    }
    if (msg.type === "match_result") {
      saveMatchResultByTableId(msg.table_id, msg);
    }
  });

  ws.on("close", () => {
    stopHeartbeat();
    // 指数退避重连
    setTimeout(connect, Math.min(reconnectDelay * 2, 30_000));
  });
}
```

## 数据库变更

### agents 表新增字段

```sql
ALTER TABLE agents ADD COLUMN style_prompt TEXT DEFAULT '';
```

### agent_connections 表（新建）

```sql
CREATE TABLE agent_connections (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  connected_at TIMESTAMP DEFAULT NOW(),
  disconnected_at TIMESTAMP,
  last_heartbeat TIMESTAMP,
  ip_address TEXT,
  user_agent TEXT
);
```

## 安全考虑

1. **Token 安全**：token 一次生成长期有效，可随时吊销
2. **速率限制**：WebSocket 消息速率限制，防止滥用
3. **输入验证**：所有 agent 发送的消息必须验证格式和合法性
4. **金额验证**：action 中的 amount 必须在合法范围内
5. **连接限制**：每个 token 同时只允许一个 WebSocket 连接

## 实现优先级

### P0（核心功能）

1. WebSocket 服务器搭建
2. Token 认证机制
3. your_turn 消息推送
4. action 消息处理
5. 基础 Fallback 机制

### P1（风格系统）

1. style_prompt 存储
2. update_style 消息处理
3. your_turn 附带 stylePrompt
4. 关键词解析逻辑

### P2（历史 API）

1. 历史查询接口
2. 统计数据接口
3. 灵魂链接生成

### P3（体验优化）

1. 心跳机制
2. 断线重连提示
3. 连接状态监控
