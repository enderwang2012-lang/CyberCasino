# CyberCasino Agent Control Loop Implementation Plan

> **For agentic workers:** Execute this plan in the current `feat/pixel-table` worktree. Preserve unrelated user changes. Do not reset, clean, publish, merge, or push.

**Spec:** `docs/superpowers/specs/2026-11-03-cybercasino-agent-control-loop-design.md`

**Goal:** Complete the approved Agent-centered product loop:

```text
Agent identity
→ ranked-default queue
→ preset Agents fill only on demand
→ six-Agent match
→ saved full replay
→ full match_result delivery or 24-hour in-process queue
→ Agent control console summary
→ full replay entry
→ strategy version for the next match
→ optional automatic requeue
```

## Global Constraints

- Work in the existing `feat/pixel-table` branch and preserve all pre-existing dirty changes.
- Keep one formal queue, `ranked-default`, with exactly six participants.
- Preset Agents are formal ranked participants and must never create an autonomous no-user match loop.
- Keep live cards, actions, pots, commentary, public tables, history, and leaderboard behavior available.
- Do not add a result page, practice mode, Season, rewards, payments, private matches, complex Elo, durable result delivery, or a new strategy editor.
- User Socket.IO state and external Agent WebSocket state remain separate.
- Save the completed replay and history successfully before attempting `match_result` delivery.
- The control console may show only state supported by server evidence. Do not claim an external Agent read or acknowledged a result without an ACK protocol.
- Replay links must use the existing full replay route and must sanitize internal audit and turn credentials.
- Offline result retention remains process-local, 24 hours, and at most 32 matches per Agent.
- Use ASCII for new source and documentation unless an existing file requires otherwise.
- Use the repository test entry points. Web tests run with `bun run test` from `apps/web`; root lint may remain blocked by the repository's existing Next ESLint setup and must be reported honestly.
- No browser browsing or browser-based visual verification. Use terminal, unit tests, HTTP, Socket.IO, and raw WebSocket checks.

## Preflight Scan

| Task | Shared output or dependency | Consumer | Finding and ruling |
|---|---|---|---|
| 1 Summary contract and pure read model | `AgentArenaSummary`, replay-to-summary builder | Task 4 API and Task 5 UI | Add only fields with evidence from current stores and replay. Derive `handsPlayed` from replay participation where ranking data is absent. |
| 2 Lifecycle and replay correctness | archive-before-delivery, sanitized replay, cleanup | Task 4 API and Task 6 e2e | Archive is authoritative. Delivery receives the same full replay after archive succeeds. |
| 3 Matchmaking demand and stop control | no-user fill guard, active leave intent | Task 4 API state and Task 5 controls | `fillQueue` must require at least one user-demand entry; user leave disables auto-requeue for the current table. |
| 4 Authenticated summary API and integration fixtures | `/api/agents/summary` | Task 5 UI and Task 6 e2e | Enforce session identity. Missing Agent returns idle empty state. |
| 5 Control console and refresh wiring | Agent panel, history, queue actions | User workflow | UI consumes authoritative summary and matchmaking state. It never invents delivery confirmation. |
| 6 External reference client and docs | protocol client, prompts, acceptance | Full loop | Reference client exercises reconnect and full replay; it does not add product behavior or claim third-party LLM verification. |
| 7 Verification | full focused and regression suites | Release gate | Existing protocol and continuous-run evidence remains required. |

| Task | Internal consistency check |
|---|---|
| 1 | Types, builder, and tests use the same replay/ranking fields and preserve optional strategy versions. |
| 2 | Archive order, result payload, and cleanup all use the same table lifecycle callback. |
| 3 | Controller tests cover both demand and no-demand completion paths, including preset cleanup. |
| 4 | API tests cover missing Agent, current-user isolation, ordering, and replay availability without production data. |
| 5 | Component props match page/hook state and all queue states have a visible action or explanatory state. |
| 6 | Reference client uses the already documented protocol IDs and handles full `match_result`; documentation matches actual behavior. |
| 7 | Commands match package scripts and do not use production secrets or the default persistent data directory. |

## Status

All seven implementation tasks are complete on the existing `feat/pixel-table` worktree.

- Tasks 1-5: implemented and covered by focused server/web tests.
- Task 6: implemented with the reference Agent client, full replay delivery, offline result queue, creation prompt and product documentation.
- Task 7: release gate passed. Server: `126 pass, 0 fail, 4178 assertions`; Web: `52 pass, 0 fail`; server TypeScript check passed; four-workspace build passed; `git diff --check` passed.
- Full HTTP + Socket.IO + WebSocket control-loop acceptance passed: `1 pass, 0 fail, 44 assertions`. It used an isolated temporary data directory and verified archive-before-delivery, replay availability, strategy version activation, disconnect/reconnect result delivery, leaderboard and persisted history.
- Remaining validation is outside this local gate: third-party LLM behavior, real user comprehension, production database/multi-instance behavior, and long-running deployment operations.

## Tasks

### Task 1: Add shared control-console contracts and a pure match-summary reader

**Files:**

- Modify: `packages/shared/src/types.ts`
- Modify: `apps/server/src/stores.ts`
- Create or modify focused tests near the store/replay code

Implement:

1. Add `AgentMatchSummary` and `AgentArenaSummary`.
2. Add a pure helper or store method that accepts an Agent ID and completed replay/history records, filters only matching replays, sorts by `finishedAt` descending, and derives:
   - final position;
   - total players;
   - hands played from ranking data when present, otherwise actual hand participation, otherwise total hands;
   - total hands;
   - frozen strategy version from the matching replay player;
   - replay availability.
3. Keep missing replay records out of `recentMatches`.
4. Keep the helper independent from HTTP and global singleton state.

Tests:

- no Agent match;
- multiple matches sorted newest first;
- ranking strategy version and position;
- eliminated Agent with fewer actual participating hands;
- replay missing or malformed for the Agent.

### Task 2: Make table completion authoritative and delivery truthful

**Files:**

- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/src/table-manager.ts`
- Modify: `apps/server/src/table-instance.ts`
- Modify: `apps/server/src/agents/match-result-message.ts` if needed
- Add focused tests where the existing lifecycle tests belong

Implement:

1. On tournament completion, obtain the replay and ranking payload, archive and persist the finished table, then send `match_result` only after archive succeeds.
2. Reuse one public replay sanitizer for HTTP replay/history and `match_result`. Strip audit records, turn tokens, and other internal credentials while preserving all hands, cards, actions, showdown, winners, rankings, and timeline.
3. Ensure automatic queue completion only runs after archive success.
4. Remove per-table frozen Agent configuration after archive and failed cleanup.
5. Make `handsPlayed` truthful when possible. If the engine cannot expose per-Agent participation without changing replay shape, add a narrow optional field rather than changing existing wire compatibility.
6. Keep result delivery status limited to queued/sent behavior already backed by the manager; do not add a fake read receipt.

Tests:

- archive failure does not deliver or complete the queue;
- archive success stores the replay before delivery;
- public replay and match result contain complete public replay with no audit/credential fields;
- table configuration cleanup occurs after archive.

### Task 3: Close matchmaking demand and stop-after-current behavior

**Files:**

- Modify: `apps/server/src/matchmaking-controller.ts`
- Modify: `apps/server/src/matchmaking-controller.test.ts`
- Modify: `apps/server/src/matchmaking-service.ts` only if required by tests
- Modify: `apps/server/src/index.ts` only for the minimal state/action bridge
- Modify: `packages/shared/src/types.ts` only if an existing event needs a typed action

Implement:

1. Prevent `fillQueue()` from adding preset Agents when no user Agent is queued or actively opted into a match.
2. Ensure leftover preset entries cannot remain as a self-starting queue after all user demand has left.
3. Preserve user auto-requeue after completion only when the user has not selected stop-after-current-match.
4. Expose a clear Socket.IO action for stopping after the current match if the server already supports the state internally; otherwise add the smallest typed event needed.
5. Keep immediate starts authoritative: a queue state may become `matched` or `playing` without an intermediate visible `queued` state.

Tests:

- no queued user means `completeTable` cannot start a preset-only table;
- a user who leaves during play is not requeued;
- preset entries are removed after a user cancellation;
- normal opted-in users requeue and can start the next table;
- start failure returns a visible error and stable idle state.

### Task 4: Add authenticated Agent summary API and isolated integration coverage

**Files:**

- Modify: `apps/server/src/index.ts`
- Add server API tests in the existing API test area
- Add a test-only data directory/configuration seam if needed

Implement:

1. Add `GET /api/agents/summary?userId=<current-user>`.
2. Require the same authenticated identity as `userId`; reject missing or mismatched identity with `401`.
3. Return `{ agent: null, currentMatch: idle, recentMatches: [] }` for an authenticated user without an Agent.
4. Return Agent identity, current matchmaking state, standing, and replay-backed recent summaries for an existing Agent.
5. Keep summary failures isolated from Socket.IO table viewing.
6. Ensure tests do not read or write the real `apps/server/data` directory or use external LLM credentials.

Tests:

- unauthenticated request;
- mismatched `userId`;
- authenticated missing Agent;
- authenticated Agent with two replay records and correct order/version/position;
- summary excludes a replay that is not available.

### Task 5: Build the Agent control console and complete refresh loop

**Files:**

- Create: `apps/web/src/components/AgentControlPanel.tsx`
- Create: `apps/web/src/components/AgentMatchHistory.tsx`
- Modify: `apps/web/src/components/Lobby.tsx`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/hooks/useSocket.ts`
- Modify: `apps/web/src/locales/zh.json`
- Modify: `apps/web/src/locales/en.json`
- Add component tests under `apps/web/src/components/__tests__`

Implement:

1. Make the Agent control console the first authenticated surface.
2. Show Agent identity, execution mode, current strategy version, current match state, primary action, ranking record, recent matches, and replay links.
3. Cover no Agent, idle, queued, matched, and playing states.
4. Provide stop-after-current-match while playing when the server supports it; keep the user in the current match until completion.
5. Display frozen/current/pending strategy versions only when those values are backed by the existing Agent config and style-update behavior. Scope copy accurately when full package edits cannot be deferred during play.
6. Refresh summary, lobby tables, history, and matchmaking state when returning to the console and after archive/requeue events.
7. Treat historical tables as finished even when they are absent from active `tables`; key `TableView` by table ID so replay state resets between matches.
8. Preserve public tables, history, leaderboard, and live table viewing below the Agent controls.
9. Keep styling consistent with the current application, remove negative letter spacing from touched UI, and use clear text actions for existing commands.

Tests:

- no Agent panel;
- idle join action;
- queued leave action and position;
- playing open-table and stop-after-current action;
- recent replay link;
- pending strategy copy and current strategy version;
- refresh calls after returning from a table.

### Task 6: Add a repeatable external-Agent loop check and align documentation

**Files:**

- Create or modify a reference client under `apps/server` test/support paths
- Modify: `apps/server/src/prompts/agent-creation-prompt.md`
- Modify: `docs/external-agent-design.md`
- Modify: `README.md`
- Modify: `docs/product-v1-contract.md`

Implement:

1. Add a reference external Agent client/harness that can authenticate, respond to `your_turn`, reconnect, handle retry/resync behavior already in Protocol v1, and receive the full `match_result` replay.
2. Exercise one online match and one reconnect/offline delivery path.
3. Exercise summary API and full replay retrieval.
4. Exercise strategy update and verify the next match uses the new version.
5. Update creation/external-Agent instructions to explain `match_result` and that the Agent should summarize the replay for its user.
6. Correct stale documentation about hidden live information and heartbeat step numbering.
7. Keep docs aligned with the no-result-page, process-local 24-hour result cache, and no-Season boundary.

Do not claim that a real third-party LLM consumed the result; the acceptance is protocol and application behavior.

### Task 7: Run the release gate

Run focused tests after each implementation task, then:

```bash
bun run test
bun run build
git diff --check
```

Also run:

```bash
bun test apps/server/src/agents/__test__/protocol-v1.test.ts
bun test apps/server/src/continuous-run.test.ts
```

Run web tests from `apps/web`:

```bash
bun run test
```

If the root lint command fails because the existing Next.js ESLint setup is incomplete, record the exact failure and complete TypeScript/build validation instead. Do not expand scope into unrelated tooling changes.

Before completion, verify:

- no accidental secrets or production data files were modified;
- the work remains on `feat/pixel-table`;
- no commit, push, merge, or deployment was performed;
- final report separates implemented behavior, verified behavior, and remaining external-user/LLM validation.
