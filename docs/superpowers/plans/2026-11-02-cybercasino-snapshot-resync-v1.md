# CyberCasino Snapshot Resync v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让外部 Agent 在任意牌局阶段通过权威快照和单调桌面序列恢复可信状态，同时保持当前回合 token 和隐藏信息隔离。

**Architecture:** `TableInstance` 维护当前桌面的可恢复状态和单调 `table_seq`，每次桌面事件推进序列并更新状态。`WebSocketAgentManager` 注册桌面快照提供器，处理 `resync` 请求，并把快照裁剪成当前 Agent 可见的信息；当前 pending decision 的 token、deadline 和合法动作只由 Manager 合并到对应 Agent 的响应中。第一版始终返回完整快照，不实现增量事件重放或跨进程持久化。

**Tech Stack:** Bun、TypeScript、`ws`、`bun:test`、Node `crypto`.

**Spec:** `docs/product-v1-contract.md`、`docs/external-agent-protocol-v1.md`

## Global Constraints

- 所有快照都包含 `protocol_version: 1`、`table_id`、单调递增 `table_seq` 和稳定 `state_hash`。
- Agent 只能看到自己的手牌；其他玩家的 hole cards 永远不出现在 snapshot/resync 响应。
- 只有当前 Agent 的 pending decision 可以获得 `turn_token`、`turn_id` 和 `deadline_at`。
- resync 不会创建、替换或延长 pending decision。
- 第一版只返回完整快照，不实现事件增量、数据库持久化、服务重启恢复或多实例共享。
- 保留当前工作区已有未提交修改和 `.DS_Store`、`.codex/`、`AGENTS.md`。
- 使用真实临时 localhost WebSocket 验收，不使用浏览器或外部 LLM。

---

### Task 1: Shared protocol types and parser

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `apps/server/src/agents/external-agent-protocol.ts`
- Test: `apps/server/src/agents/__test__/protocol-v1.test.ts`

**Interfaces:**
- Produces `ExternalAgentTableSnapshot`, `ProtocolResyncMessage`, and `ProtocolResyncRejected` wire types.
- Produces `parseResyncMessage(message)` with stable `missing_context` and `invalid_sequence` results.

- [ ] **Step 1: Write failing parser and wire-shape tests**

  Add cases for a valid resync request, missing `table_id`, non-integer `last_seen_seq`, negative sequence, and a snapshot type whose fields are snake_case and protocol version 1.

- [ ] **Step 2: Run the focused test and verify it fails**

  Run: `bun test apps/server/src/agents/__test__/protocol-v1.test.ts`

  Expected: FAIL because the resync parser and shared wire types do not exist.

- [ ] **Step 3: Add the shared wire types and minimal parser**

  Keep the parser side-effect free. Accept omitted `last_seen_seq`; accept only safe non-negative integers when present.

- [ ] **Step 4: Run the focused test and verify it passes**

  Run: `bun test apps/server/src/agents/__test__/protocol-v1.test.ts`

  Expected: PASS for the parser and type-shape cases.

### Task 2: Table authoritative snapshot state

**Files:**
- Modify: `apps/server/src/table-instance.ts`
- Test: `apps/server/src/continuous-run.test.ts`
- Test: `apps/server/src/table-mode.test.ts`

**Interfaces:**
- Produces `registerSnapshotSource` compatible data for `WebSocketAgentManager`.
- Produces a table snapshot with players, public board, pots, current actor, current legal actions, action history, sequence, and hash input.

- [ ] **Step 1: Write failing table snapshot tests**

  Assert that a waiting table has sequence zero, no private cards, and stable state hash; a live hand advances `table_seq`; a snapshot for one Agent contains that Agent's cards but never another player's cards; and a resync during a pending turn exposes the current actor without creating another decision.

- [ ] **Step 2: Run the focused test and verify it fails**

  Run: `bun test apps/server/src/table-mode.test.ts apps/server/src/continuous-run.test.ts`

  Expected: FAIL because `TableInstance` does not expose authoritative snapshot data.

- [ ] **Step 3: Implement minimal snapshot tracking**

  Track state at existing engine event boundaries and at the existing decision-view boundary. Increment the table sequence once per emitted event. Compute a SHA-256 hash from the privacy-safe state core, excluding transport metadata.

- [ ] **Step 4: Run focused tests and verify they pass**

  Run: `bun test apps/server/src/table-mode.test.ts apps/server/src/continuous-run.test.ts`

  Expected: PASS for sequence, state hash, and hidden-information assertions.

### Task 3: WebSocket resync and reconnect delivery

**Files:**
- Modify: `apps/server/src/agents/websocket-agent-manager.ts`
- Modify: `apps/server/src/test-utils/ws-agent-client.ts`
- Test: `apps/server/src/agents/__test__/protocol-v1.test.ts`

**Interfaces:**
- Adds `registerSnapshotSource(tableId, source)` and `unregisterSnapshotSource(tableId)`.
- Handles Agent → Server `resync`.
- Sends Server → Agent `table_snapshot` or stable `resync_rejected`.

- [ ] **Step 1: Write failing real-WebSocket tests**

  Cover an explicit resync, same-sequence idempotent resync, stale sequence recovery, unknown table, reconnect snapshot delivery, and the rule that a non-current Agent receives no turn token.

- [ ] **Step 2: Run the focused test and verify it fails**

  Run: `bun test apps/server/src/agents/__test__/protocol-v1.test.ts`

  Expected: FAIL because the manager does not recognize `resync` or know any snapshot source.

- [ ] **Step 3: Implement manager integration**

  On authentication, preserve existing pending-decision replay and additionally send registered snapshots for the Agent's tables. On `resync`, validate the request, ask the table source for an Agent-scoped state, merge only that Agent's pending decision, and send a full snapshot. Never use resync to resolve or replace a pending promise.

- [ ] **Step 4: Run focused tests and verify they pass**

  Run: `bun test apps/server/src/agents/__test__/protocol-v1.test.ts`

  Expected: PASS for all resync and reconnect cases.

### Task 4: 100-hand resync acceptance and documentation

**Files:**
- Modify: `apps/server/src/continuous-run.test.ts`
- Modify: `docs/external-agent-protocol-v1.md`
- Modify: `docs/product-v1-contract.md`
- Modify: `README.md`
- Modify: `apps/server/src/prompts/agent-creation-prompt.md`

**Interfaces:**
- Documents `resync`, `table_snapshot`, `table_seq`, `state_hash`, and privacy rules.
- Produces a repeatable acceptance run with mid-hand resync from both current and non-current Agents.

- [ ] **Step 1: Write the failing acceptance assertions**

  During the existing 100-hand run, request snapshots after disconnect, before retry, and from a non-current Agent; assert monotonically increasing sequences, stable repeated hashes, no opponent cards, and unchanged action counts.

- [ ] **Step 2: Run the acceptance test and verify it fails**

  Run: `bun test apps/server/src/continuous-run.test.ts`

  Expected: FAIL because no snapshot response exists.

- [ ] **Step 3: Implement the acceptance harness and documentation**

  Keep the existing 100-hand metrics intact. Add only the snapshot/resync metrics and explicitly document that full resync is process-local and non-persistent.

- [ ] **Step 4: Run targeted and full verification**

  Run:

  ```bash
  bun run test:protocol
  bun run test:acceptance
  bun run test
  bun run build
  bun run lint --cwd apps/server
  bun run lint --cwd packages/shared
  bun run lint --cwd packages/engine
  git diff --check
  ```

  Expected: all applicable checks pass; the existing frontend jsdom canvas warning and interactive `next lint` limitation remain documented if present.

## Completion Evidence

- [x] Protocol parser and wire-shape tests pass.
- [x] Table snapshot tests prove sequence advancement, stable hash, and hidden-information isolation.
- [x] Real WebSocket tests prove explicit resync, reconnect delivery, same-sequence idempotence, stale sequence recovery, and no unauthorized turn token.
- [x] 100-hand acceptance still completes with exactly one engine execution per accepted action.
- [x] Documentation describes the implemented boundary and remaining limits.
