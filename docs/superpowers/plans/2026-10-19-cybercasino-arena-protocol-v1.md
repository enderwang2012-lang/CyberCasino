# CyberCasino Arena Protocol v1 Implementation Plan

> **For agentic workers:** Use the product contract and protocol specification below when continuing this implementation. Checkbox state records verified local work, not deployment.

**Goal:** 落地产品 v1 契约、安全的外部动作协议和可重复运行的 100 手牌验收。

**Architecture:** 保留现有 WebSocket manager、TableInstance 和引擎。用牌桌/牌局/回合上下文隔离 pending，以短期 ACK 缓存处理重试；通过真实 WebSocket 客户端验证引擎、审计与回放。

**Tech Stack:** Bun、TypeScript、ws、bun:test；前端沿用 Vitest/jsdom。

**Spec:** `docs/product-v1-contract.md`、`docs/external-agent-protocol-v1.md`

## Global Constraints

- 新动作必须携带 `table_id / hand_id / turn_id / turn_token / client_action_id`。
- 重连使用原截止时间；拒绝请求不能消耗合法 pending 或删除已接受动作的 ACK。
- `roomId / handIndex` 仅为旧展示字段；不接受无上下文 action。
- 牌桌取消后不能再接受或执行 pending 动作。
- 本次不实现 lobby、Season、支付、私赛或 UI 重设计。
- 保留工作区已有的 `.DS_Store`、`.codex/`、`AGENTS.md`。
- 测试只使用本地临时端口，不使用浏览器或外部 LLM。

## Task 1: 产品边界与协议

- [x] `docs/product-v1-contract.md` 固定主用户、主循环、阶段边界和优化 checklist。
- [x] `packages/shared/src/types.ts` 定义上下文、action、ACK、拒绝原因及审计关联。
- [x] `docs/external-agent-protocol-v1.md` 说明金额语义、兼容边界、截止时间和 ACK 保留窗口。

## Task 2: 动作校验与幂等

Files: `apps/server/src/agents/external-agent-protocol.ts`、
`apps/server/src/agents/websocket-agent-manager.ts`、
`apps/server/src/agents/__test__/protocol-v1.test.ts`。

- [x] 对包含分隔符的 ID 采用结构化复合 key，避免跨桌冲突。
- [x] 同一 Agent 同一桌不允许 pending 覆盖，不同桌独立等待。
- [x] 校验合法动作、整数 raise-to 范围、短筹码全下和元数据格式。
- [x] 相同 payload 重试返回同一 ACK；冲突 payload 不删除原缓存。
- [x] 缓存按 5 分钟和每 Agent 1024 条限制；定期清理。

验证命令：`bun run test:protocol`。

回归曾复现并修复：复合 key 碰撞、小数金额被接受、缺失协议版本、冲突重试删除原 ACK、同桌 pending 覆盖和到期窗口动作被接受。

## Task 3: 重连与取消

Files: WebSocket manager、`apps/server/src/agents/websocket-agent.ts`、
`apps/server/src/table-instance.ts`。

- [x] 认证后发送原 pending payload，保留 token 和 deadline。
- [x] 新连接替换旧连接后，旧 socket 的缓冲动作不再有效。
- [x] 动作处理时检查截止时间，不仅依赖 timer 是否已经触发。
- [x] table.stop 取消 pending，取消不触发平台 fallback 出牌。
- [x] 服务关闭清理 pending、ACK 缓存和 heartbeat timer。

验证命令：`bun run test:protocol`、`bun run test:acceptance`。

## Task 4: 100 手牌联合验收

Files: `apps/server/src/continuous-run.test.ts`、
`apps/server/src/test-utils/ws-agent-client.ts`、
`apps/server/src/agents/action-audit.ts`、TableInstance、shared types。

- [x] 3 个真实 WS 客户端执行 check/call 基线，不依赖 LLM。
- [x] 第 50 手断线恢复，第 51 手拒绝旧回合动作，每 17 手重复发送。
- [x] 验证 100 手 / 1200 次执行 / 1200 条审计 / 60 次重复发送。
- [x] 每手结算筹码合计 15000；每手有回放，每次动作有回合 ID。
- [x] 内部审计关联策略版本和客户端动作 ID，公开回放不输出 token。
- [x] 通过可选 handLimit、零延迟和 rule commentary 配置实现快速本地验收。

有限场是当前验收工具，默认现网仍为淘汰赛。手数上限结束时，对存活者按筹码排序（同筹码按座次稳定排序），已淘汰者保留淘汰名次；不据此制定 Season 积分。

## Task 5: 接入文档与测试入口

- [x] 更新 README、旧接入文档、灵魂链接内联说明和 Agent 创建 prompt。
- [x] Python 基线示例支持 pending_decision、上下文回传、ACK 和重连重试。
- [x] 为 server 添加 test 脚本，使 `bun run test` 同时运行服务端回归。
- [x] root 增加 `test:protocol` 和 `test:acceptance`。
- [x] 根据既有提交 `ed0b9a2` 更新旧 live-event 测试断言；保持当前 hand-highlight 产品行为，仍断言不发布原始 cards-dealt。

不要在仓库根直接使用 `bun test` 代替 workspace test：前端 React 测试需要 Vitest/jsdom。

## Task 6: 最终验收

- [x] `bun run test`：引擎 24、服务端 64、前端 31，共 119 项通过；各自使用正确 runner。
- [x] `bun run build`：shared/engine 类型构建、server bundle、Next 生产构建全部通过。
- [x] server、shared、engine 的 `bun run lint`：TypeScript 检查通过。
- [x] `git diff --check` 及最终代码/文档一致性复核通过。

前端现有 `next lint` 首次运行会进入 ESLint 配置交互，不能把该命令描述为通过。前端构建的类型检查和 Vitest 回归独立记录。

验证日期：2026-10-19。Vitest 有 jsdom 未实现 canvas getContext 的提示，但 31 项测试通过；没有浏览器视觉验收。本次所有代码留在本地工作区，未提交或部署。

联合验收实际输出：

```text
hands=100 actions=1200 audits=1200 reconnects=1 retries=60 stale_rejected=1 chips=15000
```

## 下一阶段

1. 统一权威牌桌快照、事件序列与 resync，覆盖非行动者和过期回合。
2. 自动 lobby、开局、离线规则、补位与回队列。
3. Season 资格、积分、冻结与换季。
4. Agent 长期页和复盘反馈。

这些项仍未实施；当前测试也未覆盖注册流程、数据库持久化、服务重启、多实例部署或长期线上压力。
