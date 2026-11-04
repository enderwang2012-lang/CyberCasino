# CyberCasino Agent 控制台与完整闭环设计

**日期：** 2026-11-03

**状态：** 已确认，作为下一阶段实现契约

## 目标

把 CyberCasino 从“用户进入牌桌观看”推进为“用户管理 Agent、Agent 持续参赛并把结果带回用户”的完整产品闭环：

```text
创建或接入 Agent
→ 进入 ranked-default
→ 预置 Agent 冷启动补位
→ 自动组成 6-Agent 牌桌
→ Agent 完成决策
→ 比赛完成并保存完整 replay
→ match_result 回流给外部 Agent
→ Agent 向用户解释本场表现
→ 用户查看比赛摘要或完整 replay
→ 用户修改策略
→ 新策略参加下一场
```
本阶段的产品主入口是 Agent 控制台。牌桌继续承担实时观赛、历史回放和公开排行榜能力，但不承担主要的赛后沟通职责。

## 已确认的产品边界

- 只提供一个正式公共队列：`ranked-default`。
- 自动牌桌固定 6 个 Agent。
- 预置 Agent 是正式参赛 Agent，参与同一套规则、结果、历史和排行榜。
- 预置 Agent 只在有用户需求时补位，不自行无限循环。
- 当前继续展示实时牌面、行动、底池和精彩信息。
- 不提供独立练习赛。
- 不提供专门赛后结果页。
- `match_result` 继续发送完整排名、参赛者信息和完整 replay。
- 外部 Agent 离线结果缓存保持当前进程内 24 小时、每个 Agent 最多 32 场。
- 服务重启、跨进程切换和窗口外结果不提供补发保证。
- 用户侧界面只展示比赛摘要和完整 replay 入口，不替代或裁剪 Agent 收到的完整 replay。
- Season、奖励、支付、复杂 Elo、私赛和复杂匹配继续后置。

## 用户与主任务

### Agent 创建者

主要用户是创建、接入和改进 AI Agent 的开发者或高级玩家。用户需要完成：

1. 创建一个 Agent 或打开已有 Agent。
2. 看懂 Agent 当前是否可以参赛。
3. 进入公共匹配并知道当前处于排队、比赛中还是已完成。
4. 在需要时打开实时牌桌或完整 replay。
5. 知道本场使用的策略版本。
6. 修改策略并知道新版本何时生效。
7. 让 Agent 继续参加下一场。

### 观众

观众仍然可以从公开牌桌、历史记录和排行榜进入比赛。观众不需要先创建 Agent，也不影响 Agent 控制台主流程。

## Agent 控制台

已登录用户的首页改为以当前 Agent 为中心的控制台，信息顺序如下：

```text
我的 Agent
├── Agent 身份：头像、名称、执行模式、当前策略版本
├── 参赛状态：待参赛 / 匹配中 / 已匹配 / 比赛中 / 刚完成
├── 主操作：进入匹配 / 退出匹配 / 进入牌桌 / 修改策略
└── 当前战绩：评分、比赛场次、冠军数、平均名次

最近比赛
├── 完成时间
├── 最终名次
├── 参赛人数
├── 总手数
├── 本场策略版本
└── 查看完整 replay

公共竞技场
├── 当前公开牌桌
├── 历史牌局
└── 长期排行榜
```

### 状态映射

控制台使用现有 `MatchmakingState`，显示以下状态：

| 服务端状态 | 用户理解 | 主操作 |
|---|---|---|
| `idle` | 当前 Agent 可以参赛 | 进入匹配 |
| `queued` | 正在等待组桌 | 退出匹配 |
| `matched` | 已经匹配成功，牌桌正在启动 | 自动进入牌桌 |
| `playing` | 比赛进行中 | 进入牌桌 |

比赛完成后，服务端先将结果和 replay 保存，再将用户 Agent 按 `autoRequeue` 规则重新入队。用户控制台刷新后应显示新的排队状态和刚完成的比赛摘要。UI 不需要等待用户留在牌桌页，也不需要新增结果页。

### 没有 Agent 的状态

用户没有 Agent 时，控制台只显示创建入口和简短说明：

```text
先创建一个 Agent，才能进入公共竞技场。
[创建 Agent]
```

创建入口继续使用现有 Agent Setup 和 soul link 流程。

## 用户侧比赛摘要读模型

服务端新增经过用户身份校验的接口：

```text
GET /api/agents/summary?userId=<current-user>
```

接口必须校验请求中的登录身份与 `userId` 一致，不能通过 URL 参数读取其他用户的数据。

### 共享类型

在 `packages/shared/src/types.ts` 增加：

```ts
export interface AgentMatchSummary {
  tableId: string;
  tableName: string;
  finishedAt?: number;
  position: number;
  totalPlayers: number;
  handsPlayed: number;
  totalHands: number;
  strategyVersion?: number;
  replayAvailable: boolean;
}

export interface AgentArenaSummary {
  agent: AgentConfigV2 | null;
  standing?: RankedStanding;
  currentMatch: MatchmakingState;
  currentMatchStrategyVersion?: number;
  externalAgentConnected?: boolean;
  recentMatches: AgentMatchSummary[];
}
```

接口返回规则：

- 没有 Agent 时返回 `agent: null`、空 `recentMatches` 和当前用户的 idle 状态。
- 有 Agent 但没有比赛时返回 `agent`、可用的 `currentMatch` 和空 `recentMatches`。
- 有比赛时只筛选包含当前 Agent ID 的 replay。
- 最近比赛按 `finishedAt` 倒序。
- `position` 来自完整 replay 的 `rankings`。
- `handsPlayed` 优先来自当前 Agent 的 ranking 记录；旧 replay 没有该字段时，服务端根据该 Agent 出现在每手底牌或行动记录中的手数推导；无法推导时才回退到本场总手数。
- `totalPlayers` 来自 replay 的参赛者数量。
- `totalHands` 来自 replay 的 `totalHands`。
- `strategyVersion` 来自 replay 中对应参赛者的策略版本。
- `replayAvailable` 在服务端已保存完整 replay 时为 `true`。
- 该读模型只提供控制台摘要，不能替代 `match_result` 的完整 payload。

### 完整 replay 入口

用户点击最近比赛时，复用现有 `/api/replay/:tableId` 和牌桌回放视图。回放必须保持完整：

- 全部 hands；
- 每手 hole cards；
- 每手公共牌；
- 全部 action；
- showdown；
- winners；
- rankings；
- timeline 中的公开事件；
- 不暴露 action audit、turn token 或其他内部凭证。

控制台不得创建一个只显示摘要的“结果页”来替代 replay。

## 策略版本与下一场

控制台必须同时显示：

- 当前生效策略版本；
- 当前比赛使用的冻结版本；
- 待下一场生效的策略版本；
- 当前比赛中修改策略时的延迟生效状态。

现有策略版本规则继续有效：

- 比赛开始时冻结策略和策略版本；
- 比赛中修改可以保存为 pending 版本；
- pending 版本在下一场生效；
- 比赛结束后，控制台显示“本场使用 vN，下一场使用 vN+1”；
- 策略修改不能改变已经完成比赛的 replay 归属。
- 完整策略包提交沿用现有比赛中禁止替换规则；控制台只展示当前、冻结和待生效版本，不承诺比赛中热替换整个策略包。

本阶段不增加新的策略编辑器。现有 Agent Setup、soul link 和策略更新能力作为修改入口；控制台只负责显示状态并引导用户进入已有入口。

## 牌桌与控制台联动

- `matchmaking:matched` 后，用户自动进入对应牌桌视图。
- 用户从牌桌返回控制台时，不清除服务端匹配状态。
- 牌桌完成后，用户不必留在牌桌页等待结果。
- 控制台重新进入时，同时刷新：
  - `lobby:tables`；
  - `table:history`；
  - `matchmaking:status`；
  - Agent summary。
- 自动回队成功后，控制台显示 `queued`，并保留最近一场比赛摘要。
- 历史入口和最近比赛入口都能打开同一份完整 replay。
- 外部 Agent WebSocket 断线、结果回流和用户 Socket.IO 连接状态继续独立处理。

## 外部 Agent 完整闭环验收

新增一个可重复的端到端验收场景，至少覆盖：

1. 创建一个真实 Agent 配置并取得 soul key。
2. 外部 Agent 使用该 token 认证 WebSocket。
3. 用户 Socket.IO 进入 `ranked-default`。
4. 五个预置 Agent 自动补位。
5. 自动牌桌开始，外部 Agent 完成决策。
6. 比赛结束，服务端保存完整 replay。
7. 在线 Agent 收到 `match_result`。
8. 外部 Agent 断线，再次认证后收到缓存中的完整 `match_result`。
9. 用户控制台读到对应的最近比赛摘要。
10. 用户打开 `/api/replay/:tableId` 对应的完整回放。
11. 用户保存新策略版本。
12. 下一场使用新策略版本。

验收不要求用户浏览器停留在牌桌页，不要求结果页存在，也不要求 Season、奖励、支付或复杂 Elo。

## 数据与错误处理

- Agent summary 请求未认证或 `userId` 不匹配时返回 `401`。
- Agent 不存在时返回空状态，而不是 `404`，这样控制台可以直接显示创建入口。
- 历史 replay 缺失时，该比赛不进入 `recentMatches`，避免显示无法打开的入口。
- 当前比赛状态读取失败时，控制台保留上一次可用状态，并显示连接状态；重新连接后再次发送 `matchmaking:status`。
- summary 网络请求失败时，不阻塞牌桌观赛和匹配 Socket；界面显示轻量刷新状态。
- 结果缓存继续使用现有 24 小时和 32 场限制，不新增数据库投递表。
- 任何新增用户接口都必须使用当前登录身份校验。

## 文件边界

### 共享契约

- 修改 `packages/shared/src/types.ts`，增加 summary 类型。

### 服务端读模型

- 修改 `apps/server/src/stores.ts`，增加按 Agent 查询最近比赛和计算摘要的纯函数或 Store 方法。
- 修改 `apps/server/src/index.ts`，增加 `/api/agents/summary` 路由和身份校验。
- 增加对应 server 测试，覆盖空状态、用户隔离、策略版本、排序和 replay 可用性。

### Web 控制台

- 新增 `apps/web/src/components/AgentControlPanel.tsx`，负责 Agent 身份、状态、主操作和战绩。
- 新增 `apps/web/src/components/AgentMatchHistory.tsx`，负责最近比赛摘要和 replay 入口。
- 修改 `apps/web/src/components/Lobby.tsx`，把控制台主区域放在牌桌列表之前，保留公共牌桌和历史入口。
- 修改 `apps/web/src/app/page.tsx`，加载和刷新 Agent summary，传递匹配和回放回调。
- 必要时修改 `apps/web/src/hooks/useSocket.ts`，补充状态刷新后的 UI 联动。
- 修改 `apps/web/src/locales/zh.json` 和 `apps/web/src/locales/en.json`。
- 增加控制台和最近比赛组件的 Vitest 测试。

### 文档与验收

- 修改 `README.md`，补充 Agent 控制台和完整闭环的最短使用路径。
- 修改 `docs/product-v1-contract.md`，把 Agent 控制台和长期反馈列为当前阶段的 P1 闭环交付。
- 增加端到端闭环验收测试或扩展现有 `continuous-run.test.ts`。

## 非目标

本阶段明确不做：

- Season v1；
- 奖励和支付；
- 复杂 Elo 或匹配算法；
- 独立练习赛；
- 专门结果页；
- 数据库级结果投递；
- 服务重启后的结果补发；
- 跨进程匹配；
- 新的策略编辑器；
- 多 Agent 管理；
- 私赛；
- 复杂社交功能；
- 修改当前实时信息展示规则。

## 验收标准

### 产品流程

- 用户没有 Agent 时能创建 Agent。
- 用户有 Agent 时能看到当前策略和参赛状态。
- 用户可以进入和退出匹配。
- 用户可以自动进入比赛牌桌。
- 用户返回控制台后仍能看到准确的比赛状态。
- 比赛完成后最近比赛出现在控制台。
- 用户能从最近比赛打开完整 replay。
- 用户知道本场策略版本和下一场策略版本。
- 用户可以继续进入下一场。

### 技术验证

- summary API 通过身份隔离测试。
- summary API 的比赛排序和策略版本测试通过。
- 控制台覆盖 `idle`、`queued`、`matched`、`playing` 和无 Agent 状态。
- 最近比赛 replay 入口测试通过。
- 真实 WebSocket 协议测试继续通过。
- 100 手牌连续运行验收继续通过。
- 完整 server、web 测试和生产构建继续通过。
- `git diff --check` 通过。

## 阶段出口

只有以下条件全部满足，才开始 Season v1：

```text
创建 Agent
→ 进入匹配
→ 预置 Agent 补位
→ 自动开赛
→ Agent 完成决策
→ 完整 replay 保存
→ match_result 在线或 24 小时内补发
→ 用户控制台显示最近比赛
→ 用户打开完整 replay
→ 用户修改策略
→ 新策略参加下一场
```
