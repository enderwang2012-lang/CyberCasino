# CyberCasino 自动 Lobby 与匹配 v1 设计

**日期：** 2026-11-02  
**状态：** 已确认，作为下一阶段实现契约

## 目标

把当前需要用户手动入座、填充 AI、点击开始的公共竞技主路径，收敛为一条可持续运行的流程：

```text
选择已配置 Agent
→ 加入公共排名队列
→ 6 个 Agent 自动组成牌桌
→ 自动开始比赛
→ 比赛结束后归档
→ 仍然参赛的 Agent 自动回到队列
```

这一阶段只实现单进程内的默认公共队列和一桌 6 人的自动组桌。已有手动牌桌、观赛、回放和外部 Agent WebSocket 协议继续可用。

## 产品边界

### 队列

- 只提供一个队列：`ranked-default`。
- 每桌固定需要 6 个 Agent。
- 入队对象是用户拥有的已保存 `AgentConfigV2`。
- 入队时冻结身份、执行模式、策略版本和比赛所需的策略配置。
- 同一个 `userId` 或 `agentId` 不能重复排队。
- 已经在进行中的牌桌中的 Agent 不能再次入队。
- 用户主动退出队列后，该 Agent 不参与下一次自动回队。
- 队列状态保存在进程内；服务重启后队列清空。

### 匹配

- 当队列达到 6 个不同 Agent 时，服务端一次性取出前 6 个入队项。
- 取出和创建牌桌必须在同一个事件循环操作中完成，不能重复消费同一入队项。
- 创建的牌桌使用现有 `TableInstance` 和 `ranked` 模式。
- 6 个 Agent 全部以 custom seat 入座，不自动补充 house bot。
- 牌桌创建完成后立即调用 `start()`。
- 牌桌使用入队时冻结的配置，不读取比赛中途更新的策略版本。

### 连接与离线

- Socket.IO Lobby 连接只负责控制队列和展示状态。
- 外部 Agent WebSocket 连接状态继续与参赛状态分离。
- 外部 Agent 断线时，现有 `WebSocketAgent` fallback 规则继续生效。
- Socket.IO 用户断开时，当前比赛继续；已经选择持续参赛的 Agent 可以继续完成当前比赛和下一场排队。
- 用户显式发送 `matchmaking:leave` 时：
  - 排队中的 Agent 立即移出队列。
  - 比赛中的 Agent 完成本场，但不会在比赛结束后重新入队。

### 比赛结束

- 自动牌桌复用现有 `archiveFinishedTable()`，先保存回放和审计，再从活动牌桌中移除。
- 归档完成后，对仍处于自动参赛状态的 Agent 重新入队。
- 重入队时使用上一场结束后当前可用的 Agent 配置快照；比赛中的配置更新仍由现有 pending strategy 规则处理。
- 归档失败时不回队列，并向关联 Socket.IO 用户发送稳定错误。

## Socket.IO 契约

### Client -> Server

```ts
matchmaking:join: (agentId?: string) => void;
matchmaking:leave: () => void;
matchmaking:status: () => void;
```

`agentId` 为空时，服务端选择当前用户最后保存的 Agent。当前产品只支持一个活跃 Agent，因此显式传入主要用于恢复和测试。

### Server -> Client

```ts
interface MatchmakingState {
  queue: "ranked-default";
  status: "idle" | "queued" | "matched" | "playing";
  agentId?: string;
  position?: number;
  queueSize: number;
  requiredPlayers: 6;
  tableId?: string;
  enteredAt?: number;
  autoRequeue: boolean;
}

matchmaking:state: (state: MatchmakingState) => void;
matchmaking:matched: (data: { tableId: string; agentId: string }) => void;
matchmaking:error: (data: { code: MatchmakingErrorCode; message: string }) => void;
```

错误码固定为：

```ts
type MatchmakingErrorCode =
  | "not_registered"
  | "agent_not_found"
  | "already_queued"
  | "already_playing"
  | "queue_not_found"
  | "invalid_agent";
```

用户重新连接并发送 `matchmaking:status` 后，服务端返回该用户 Agent 的当前状态。服务端在状态改变时向 Lobby 房间和对应用户推送更新。

## 服务边界

新增 `MatchmakingService` 负责纯队列状态和匹配决策：

```ts
interface MatchEntry {
  userId: string;
  agent: Pick<AgentConfigV2, "id" | "userId" | "name" | "avatar"
    | "executionMode" | "strategy" | "strategyPackage"
    | "strategyVersion" | "strategyPackage">;
  enteredAt: number;
  autoRequeue: boolean;
  tableId?: string;
}
```

服务提供：

```ts
join(entry: MatchEntry): MatchResult;
leave(userId: string): LeaveResult;
setAutoRequeue(userId: string, enabled: boolean): MatchEntry | undefined;
getState(userId: string): MatchmakingState;
getQueueSnapshot(): MatchEntry[];
completeTable(tableId: string): MatchEntry[];
```

`MatchmakingService` 不直接依赖 Socket.IO、文件数据库或 `TableInstance`。`index.ts` 负责将 `MatchResult` 转换为建桌、入座、启动和推送事件。

## 前端行为

- Lobby 的 Agent 配置区域显示当前 Agent 和匹配状态。
- Agent 已配置且处于 `idle` 时显示“进入匹配”操作。
- `queued` 状态显示队列位置和当前人数，并提供“退出匹配”。
- `matched` / `playing` 状态自动进入对应牌桌视图，保留返回大厅入口。
- Agent 未配置时继续引导到 Agent Setup。
- 现有手动牌桌和历史入口保留，避免影响观赛和回放。

## 验收

服务端测试必须覆盖：

1. 5 个 Agent 入队后保持等待，第 6 个 Agent 入队后只创建一桌。
2. 同一用户或 Agent 重复入队返回稳定错误，队列不会增加重复项。
3. 正在比赛中的 Agent 不能再次入队。
4. `matchmaking:leave` 可以移除排队项，并阻止该 Agent 自动回队。
5. 一场自动牌桌完成后，保持 `autoRequeue` 的 Agent 会按原顺序重新入队。
6. 牌桌归档失败时，Agent 不会错误回队。
7. Socket.IO 用户断开不改变当前比赛和自动回队意愿。
8. 6 个 Agent 的配置在建桌时被冻结，比赛中修改只作为下一场 pending 配置。

前端测试必须覆盖：

1. idle、queued、matched、playing 四种状态的 Lobby 渲染。
2. 加入和退出匹配按钮发送正确 Socket.IO 事件。
3. `matchmaking:matched` 后切换到对应牌桌。

本阶段不覆盖服务重启后的队列恢复、跨进程匹配、Season 计分、支付、私赛和复杂匹配算法。
