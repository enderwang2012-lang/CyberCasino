# CyberCasino Automatic Matchmaking v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Execution status (2026-11-02):** Tasks 1-6 implementation and focused verification are complete in the current working tree. The separate commit steps remain unchecked because this branch also contains the preceding Protocol v1 and Snapshot / Resync work, which is intentionally being kept together for local development.

**Decision update (2026-11-03):** The queue is the single formal ranked path. Preset Agents fill cold-start seats, participate in the same matches and leaderboard, and do not auto-requeue. There is no separate practice mode or post-match result page; complete results return through the Agent protocol. Season, rewards, payments and complex Elo remain later work.

**Goal:** Add one in-memory six-Agent ranked queue that automatically creates, starts, archives, returns complete results to Agents, and requeues eligible user Agents while exposing stable Socket.IO and Lobby state.

**Architecture:** A dedicated `MatchmakingService` owns queue entries, active table membership, explicit leave intent, and the synchronous six-entry batch boundary. `TableManager` creates automatic ranked tables from frozen `AgentConfigV2` entries, while `index.ts` owns Socket.IO authorization, table wiring, broadcasts, and archive callbacks. The React Lobby consumes a typed matchmaking state and keeps manual table/history viewing available during the migration.

**Tech Stack:** Bun, TypeScript, Socket.IO, `bun:test`, React, Next.js, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-02-cybercasino-automatic-matchmaking-v1-design.md`

## Global Constraints

- Use only the `ranked-default` queue and require exactly 6 Agents per automatic table.
- Freeze Agent identity, execution mode, strategy, and strategy version at queue entry.
- Keep Socket.IO Lobby connection state separate from external Agent WebSocket participation state.
- A disconnected external Agent continues through the existing fallback behavior and reconnects through the existing protocol.
- Preset Agents are formal ranked participants used to fill a table when user demand exists; they do not self-start or auto-requeue.
- A user leaving the queue disables automatic requeue after the current table, if any.
- Queue state is process-local and is cleared on server restart.
- Preserve the existing manual table, live viewing, replay, audit, Snapshot / Resync, and Season boundary.
- Keep live table information visible for the current stage; revisit fairness filtering only after real user feedback.
- Send complete `match_result` payloads to external Agents and buffer offline delivery in process memory.
- Do not add Season scoring, rewards, payments, private matches, database queue persistence, cross-process locks, or complex Elo / matching rules.
- Use the repository test entrypoints; local WebSocket tests require the approved escalated localhost test command.

---

### Task 1: Shared matchmaking wire types

**Files:**

- Modify: `packages/shared/src/types.ts`
- Test: `apps/server/src/matchmaking-service.test.ts`

**Interfaces:**

- Produces `MatchmakingQueueName`, `MatchmakingStatus`, `MatchmakingErrorCode`, and `MatchmakingState`.
- Extends `ServerToClientEvents` with `matchmaking:state`, `matchmaking:matched`, and `matchmaking:error`.
- Extends `ClientToServerEvents` with `matchmaking:join`, `matchmaking:leave`, and `matchmaking:status`.

- [x] **Step 1: Write the failing type and state-shape test**

  Add a focused test that constructs:

  ```ts
  const state: MatchmakingState = {
    queue: "ranked-default",
    status: "queued",
    agentId: "agent-1",
    position: 2,
    queueSize: 5,
    requiredPlayers: 6,
    enteredAt: 123,
    autoRequeue: true,
  };
  expect(state.requiredPlayers).toBe(6);
  ```

  Also assert that `MatchmakingErrorCode` accepts `"already_playing"` and rejects no required field at compile time through the typed service usage added in Task 2.

- [x] **Step 2: Run the test to verify the type contract fails**

  Run:

  ```bash
  bun test apps/server/src/matchmaking-service.test.ts
  ```

  Expected: TypeScript failure because the matchmaking shared types do not exist.

- [x] **Step 3: Add the shared types and event signatures**

  Add:

  ```ts
  export type MatchmakingQueueName = "ranked-default";
  export type MatchmakingStatus = "idle" | "queued" | "matched" | "playing";
  export type MatchmakingErrorCode =
    | "not_registered"
    | "agent_not_found"
    | "already_queued"
    | "already_playing"
    | "queue_not_found"
    | "invalid_agent";

  export interface MatchmakingState {
    queue: MatchmakingQueueName;
    status: MatchmakingStatus;
    agentId?: string;
    position?: number;
    queueSize: number;
    requiredPlayers: 6;
    tableId?: string;
    enteredAt?: number;
    autoRequeue: boolean;
  }

  export interface MatchmakingError {
    code: MatchmakingErrorCode;
    message: string;
  }
  ```

  Add the three server events and three client events with the exact payloads in the spec. Make `matchmaking:join` accept an optional `agentId`.

- [x] **Step 4: Run the focused test to verify it passes**

  Run:

  ```bash
  bun test apps/server/src/matchmaking-service.test.ts
  ```

  Expected: the type-shape test passes once Task 2's test file compiles against the new declarations.

- [ ] **Step 5: Commit the shared contract**

  ```bash
  git add packages/shared/src/types.ts apps/server/src/matchmaking-service.test.ts
  git commit -m "feat: define matchmaking socket contract"
  ```

### Task 2: In-memory MatchmakingService

**Files:**

- Create: `apps/server/src/matchmaking-service.ts`
- Modify: `apps/server/src/matchmaking-service.test.ts`

**Interfaces:**

- Consumes `AgentConfigV2` and the shared matchmaking types.
- Produces `MatchEntry`, `MatchBatch`, `MatchmakingService.join`, `leave`, `startBatch`, `cancelBatch`, `completeTable`, `getState`, and `getQueueSnapshot`.

- [x] **Step 1: Write failing queue behavior tests**

  Add tests for:

  ```ts
  const service = new MatchmakingService({ requiredPlayers: 6, now: () => 1000 });
  const entries = agents.slice(0, 5).map((agent) => entry(agent));

  for (const item of entries) {
    expect(service.join(item)).toMatchObject({ accepted: true, batch: undefined });
  }

  const sixth = service.join(entry(agents[5]));
  expect(sixth.accepted).toBe(true);
  expect(sixth.batch?.entries).toHaveLength(6);
  expect(service.getQueueSnapshot()).toHaveLength(0);
  ```

  Cover duplicate `userId`, duplicate `agent.id`, `leave` removing a queued entry, `leave` disabling auto-requeue for an active table, and `getState` returning queue position.

- [x] **Step 2: Run the service tests to verify they fail**

  Run:

  ```bash
  bun test apps/server/src/matchmaking-service.test.ts
  ```

  Expected: FAIL because `MatchmakingService` and its result types do not exist.

- [x] **Step 3: Implement the minimal queue state machine**

  Implement:

  ```ts
  export interface MatchEntry {
    userId: string;
    agent: AgentConfigV2;
    enteredAt: number;
    autoRequeue: boolean;
    tableId?: string;
  }

  export interface MatchBatch {
    batchId: string;
    entries: MatchEntry[];
  }

  export class MatchmakingService {
    constructor(options?: { requiredPlayers?: number; now?: () => number });
    join(entry: MatchEntry): { accepted: true; state: MatchmakingState; batch?: MatchBatch }
      | { accepted: false; code: MatchmakingErrorCode; state: MatchmakingState };
    leave(userId: string): { state: MatchmakingState; removed: boolean };
    startBatch(batchId: string, tableId: string): MatchEntry[];
    cancelBatch(batchId: string): MatchEntry[];
    completeTable(tableId: string): { requeued: MatchEntry[]; batch?: MatchBatch };
    getState(userId: string): MatchmakingState;
    getQueueSnapshot(): MatchEntry[];
  }
  ```

  Keep queue mutation synchronous. When a batch is claimed, remove exactly the first six entries and put them in a pending batch until `startBatch` or `cancelBatch`. `cancelBatch` restores entries in their original order. `completeTable` removes active entries, requeues only entries whose `autoRequeue` remains true, and immediately claims the next six if available.

- [x] **Step 4: Run the service tests to verify they pass**

  Run:

  ```bash
  bun test apps/server/src/matchmaking-service.test.ts
  ```

  Expected: all pure queue tests pass.

- [ ] **Step 5: Commit the service**

  ```bash
  git add apps/server/src/matchmaking-service.ts apps/server/src/matchmaking-service.test.ts
  git commit -m "feat: add in-memory ranked matchmaking service"
  ```

### Task 3: Automatic table creation and lifecycle callbacks

**Files:**

- Modify: `apps/server/src/table-manager.ts`
- Modify: `apps/server/src/table-manager.test.ts`
- Modify: `apps/server/src/table-instance.ts`

**Interfaces:**

- `TableManager.createMatchedTable(entries: MatchEntry[]): TableInstance` creates a ranked table, seats all six frozen Agents, and stores their frozen configs.
- `TableManager.getActiveTableInfos(): TableInfo[]` exposes active automatic tables for the Lobby.
- `TableInstance` keeps its current automatic start, stop, and Snapshot / Resync behavior.

- [x] **Step 1: Write failing table factory tests**

  Add a test with six distinct `AgentConfigV2` fixtures that asserts:

  ```ts
  const table = manager.createMatchedTable(entries);
  expect(table.config.mode).toBe("ranked");
  expect(table.getOccupiedCount()).toBe(6);
  expect(table.getSeats().every((seat) => seat.agent?.type === "custom")).toBe(true);
  expect(manager.getAgentV2Configs(table.id)?.get("user-1")).toEqual(entries[0].agent);
  ```

  Assert that `getActiveTableInfos()` includes the new waiting table and that `removeTable` removes it.

- [x] **Step 2: Run the focused test to verify it fails**

  Run:

  ```bash
  bun test apps/server/src/table-manager.test.ts
  ```

  Expected: FAIL because automatic table creation and active table listing do not exist.

- [x] **Step 3: Implement the table factory**

  Add a `createMatchedTable` method that:

  1. Generates a unique `table-${nextId++}` id.
  2. Copies the existing default ranked config and assigns a casino name.
  3. Creates a `TableInstance`.
  4. Calls `sit` once per entry using `remote_agent` unless the frozen config explicitly uses `verified_package`.
  5. Stores the full frozen `AgentConfigV2` in `agentV2ConfigsForTable`.
  6. Throws if a seat cannot be placed, so the caller can cancel and restore the batch.

  Add `getActiveTableInfos()` and include active automatic tables in the Lobby list without changing the existing finished history behavior.

- [x] **Step 4: Run the focused test to verify it passes**

  Run:

  ```bash
  bun test apps/server/src/table-manager.test.ts apps/server/src/table-mode.test.ts
  ```

  Expected: existing table behavior and new table factory tests pass.

- [ ] **Step 5: Commit the table lifecycle seam**

  ```bash
  git add apps/server/src/table-manager.ts apps/server/src/table-manager.test.ts apps/server/src/table-instance.ts
  git commit -m "feat: create ranked tables from matched agents"
  ```

### Task 4: Socket.IO matchmaking controller and automatic requeue

**Files:**

- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/src/table-manager.ts`
- Create: `apps/server/src/matchmaking-controller.test.ts`

**Interfaces:**

- Consumes `MatchmakingService`, `TableManager.createMatchedTable`, and the shared Socket.IO event types.
- Produces `matchmaking:join`, `matchmaking:leave`, and `matchmaking:status` behavior.
- Produces `matchmaking:state`, `matchmaking:matched`, and `matchmaking:error` broadcasts.

- [x] **Step 1: Write failing controller tests around a testable controller**

  Extract a small `MatchmakingController` from `index.ts` with injected `AgentStore`, `TableManager`, `MatchmakingService`, and callbacks for emitting user state, joining a Socket.IO room, and starting a table. Test:

  - An unregistered user receives `not_registered`.
  - A missing Agent receives `agent_not_found`.
  - Six valid users produce one table and six matched notifications.
  - A duplicate Agent receives `already_queued`.
  - Leaving a queued user removes the entry.
  - Completing a table calls `completeTable` and starts the returned next batch.

- [x] **Step 2: Run the controller tests to verify they fail**

  Run:

  ```bash
  bun test apps/server/src/matchmaking-controller.test.ts
  ```

  Expected: FAIL because the controller and injected lifecycle seams do not exist.

- [x] **Step 3: Implement the controller and wire it into `index.ts`**

  Add a controller that:

  1. Resolves the requested Agent from `AgentStore.getV2ByUserId` or `getAllV2ByUserId`.
  2. Rejects missing user registration, missing Agent, duplicate queue membership, and `tableManager.isAgentPlaying`.
  3. Builds a deep-enough JSON snapshot of the selected `AgentConfigV2` so later edits do not alter a live match.
  4. Calls `matchmaking.join`.
  5. When a batch is returned, calls `tableManager.createMatchedTable`, marks the batch active with `startBatch`, joins each user socket to `table:${tableId}`, emits `matchmaking:matched`, broadcasts states, emits `table:started`, and calls `table.start`.
  6. On table creation or start failure, calls `cancelBatch`, restores the entries, emits `matchmaking:error`, and leaves no partial table.
  7. On `matchmaking:leave`, calls `service.leave`; for an active table this only clears `autoRequeue`.
  8. On `matchmaking:status` and `user:register`, emits the current state.

  Update `wireTableEvents` so automatic tables archive through the existing store, then call `completeTable`. Any returned batch goes through the same automatic table start path. Manual preset table behavior remains unchanged.

- [x] **Step 4: Run the controller and server regression tests**

  Run:

  ```bash
  bun test apps/server/src/matchmaking-controller.test.ts apps/server/src/table-manager.test.ts apps/server/src/table-mode.test.ts
  ```

  Expected: all controller, table, and existing ranked table tests pass.

- [ ] **Step 5: Commit the server integration**

  ```bash
  git add apps/server/src/index.ts apps/server/src/table-manager.ts apps/server/src/matchmaking-controller.test.ts
  git commit -m "feat: wire automatic matchmaking into ranked tables"
  ```

### Task 5: Lobby queue state and user controls

**Files:**

- Modify: `apps/web/src/hooks/useSocket.ts`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/components/Lobby.tsx`
- Modify: `apps/web/src/locales/zh.json`
- Modify: `apps/web/src/locales/en.json`
- Modify: `apps/web/src/components/__tests__/sanity.test.ts`

**Interfaces:**

- Consumes the shared matchmaking Socket.IO events.
- Produces typed hook state and callbacks: `joinMatchmaking`, `leaveMatchmaking`, and `refreshMatchmaking`.

- [x] **Step 1: Write failing Lobby state tests**

  Add component tests for:

  - An idle Agent shows the join-match action.
  - A queued Agent shows position and a leave action.
  - A playing Agent shows the table id/status.
  - Clicking join and leave calls the supplied callbacks once.

- [x] **Step 2: Run the frontend test to verify it fails**

  Run:

  ```bash
  bunx vitest run apps/web/src/components/__tests__/sanity.test.ts
  ```

  Expected: FAIL because Lobby has no matchmaking props or queue controls.

- [x] **Step 3: Implement hook and Lobby integration**

  In `useSocket.ts`:

  - Track `matchmakingState` and `matchmakingError`.
  - Listen for `matchmaking:state`, `matchmaking:matched`, and `matchmaking:error`.
  - Emit `matchmaking:status` after Socket.IO connect and expose join/leave callbacks.

  In `page.tsx`:

  - Pass matchmaking state and callbacks to Lobby.
  - On `matchmaking:matched`, set `activeTableId`, call `joinTable`, and switch to `table-live`.
  - Keep manual `table-waiting` navigation unchanged.

  In `Lobby.tsx`:

  - Make the current Agent area the primary matchmaking control.
  - Render idle, queued, matched, and playing states from the typed state.
  - Show queue position and current queue size while queued.
  - Keep Agent Setup, table list, history, and leaderboard visible.

  Add Chinese and English strings for the four states, actions, queue position, errors, and automatic match copy.

- [x] **Step 4: Run frontend tests and build**

  Run:

  ```bash
  bunx vitest run apps/web/src/components/__tests__/sanity.test.ts
  bun run build
  ```

  Expected: frontend tests and all workspace builds pass.

- [ ] **Step 5: Commit the Lobby integration**

  ```bash
  git add apps/web/src/hooks/useSocket.ts apps/web/src/app/page.tsx apps/web/src/components/Lobby.tsx apps/web/src/locales/zh.json apps/web/src/locales/en.json apps/web/src/components/__tests__/sanity.test.ts
  git commit -m "feat: add automatic matchmaking controls to lobby"
  ```

### Task 6: End-to-end acceptance and documentation

**Files:**

- Create: `apps/server/src/matchmaking-acceptance.test.ts`
- Modify: `README.md`
- Modify: `docs/product-v1-contract.md`
- Modify: `docs/external-agent-protocol-v1.md`
- Modify: `docs/superpowers/specs/2026-11-02-cybercasino-automatic-matchmaking-v1-design.md`

**Interfaces:**

- Verifies the complete six-Agent queue-to-table-to-requeue cycle.
- Documents the implemented process-local boundary and the explicit leave rule.

- [x] **Step 1: Write the failing acceptance test**

  Use six frozen fixtures and the service plus table manager seams to assert:

  ```text
  5 queued
  -> 6th joins
  -> one table created
  -> six custom seats
  -> table starts once
  -> table completes
  -> six entries return to the queue
  ```

  Also set one entry's `autoRequeue` to false through `leave` while active and assert that only five entries return.

- [x] **Step 2: Run the acceptance test to verify it fails**

  Run:

  ```bash
  bun test apps/server/src/matchmaking-acceptance.test.ts
  ```

  Expected: FAIL until the complete lifecycle is wired.

- [x] **Step 3: Implement the acceptance harness and documentation**

  Keep this acceptance process-local and deterministic. Document:

  - the new Socket.IO events;
  - the one-queue six-Agent rule;
  - the distinction between Agent connection and match participation;
  - automatic requeue and explicit leave;
  - process restart clearing queue state;
  - the remaining Season, persistence, and cross-process limits.

- [x] **Step 4: Run all required verification**

  Run:

  ```bash
  bun test apps/server/src/matchmaking-service.test.ts apps/server/src/table-manager.test.ts apps/server/src/matchmaking-controller.test.ts apps/server/src/matchmaking-acceptance.test.ts
  bun run test
  bun run build
  bun run lint
  git diff --check
  ```

  For WebSocket acceptance that opens localhost ports, use the approved escalated command:

  ```bash
  bun test apps/server/src/agents/__test__/protocol-v1.test.ts apps/server/src/continuous-run.test.ts
  ```

  Expected: all applicable checks pass; existing frontend jsdom canvas warnings remain non-failing.

  Actual verification on 2026-11-02:

  - Passed: focused matchmaking/table suite, 23 tests and 80 expectations.
  - Passed: server TypeScript check, frontend Vitest, frontend build, workspace build, and `git diff --check`.
  - Passed: Protocol v1 WebSocket suite when run alone with the approved localhost-port environment, 22 tests and 49 expectations.
  - Not completed in this environment: the 100-hand WebSocket acceptance because the escalated localhost permission review failed twice; the sandbox run reproduced the existing `port 0` startup failure.
  - Known suite limitation: `bun run test` currently runs the global WebSocket manager tests concurrently, producing `WebSocket server already attached`; this does not occur in the focused matchmaking suite or the isolated Protocol v1 run.

- [ ] **Step 5: Commit documentation and final acceptance**

  ```bash
  git add README.md docs/product-v1-contract.md docs/external-agent-protocol-v1.md docs/superpowers/specs/2026-11-02-cybercasino-automatic-matchmaking-v1-design.md apps/server/src/matchmaking-acceptance.test.ts
  git commit -m "docs: define automatic matchmaking v1 boundary"
  ```
