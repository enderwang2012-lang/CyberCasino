# 像素牌桌可视化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 CyberCasino 现在的纯文字事件流升级为 6 人对等的像素风可视化牌桌（PixiJS 渲染），保持现有 Apple 风 UI 一致，色彩仅集中在表情和局部动画。

**Architecture:** 在 `apps/web/src/components/PixelTable/` 新增独立模块。`TableView.tsx` 重构为 Tab 路由壳：一级 Tab（集锦/排行榜）、集锦内二级 Tab（实况/文字）。"实况" 进入 `PixelTableView` —— 用 `@pixi/react` 在 Canvas 中渲染 6 座椭圆桌、公共牌、底池、emoji 气泡、All-in 火焰、赢家冠光等局部特效。事件流通过纯函数 `eventsToTableState` 累加为 `PixelTableState`，渲染层是状态的纯函数。底部新增 `TurnCard` 卡片（带打字机 + 历史回看）。

**Tech Stack:**
- **PixiJS v8** + **@pixi/react v8**（Canvas 渲染）
- **Next.js 15 + React 19 + TypeScript**（现状）
- **Tailwind CSS v4**（UI 部分）
- **Vitest** 单元测试（首次引入到 `apps/web`）
- 测试占位 sprite：纯色矩形 + Canvas 文字占位（M1-M5 不依赖真实美术）

**Spec:** `docs/superpowers/specs/2026-06-05-pixel-table-visualization-design.md`

**Mockup:** `.superpowers/brainstorm/80310-1780653736/content/layout-v3.html`

---

## File Structure

### 创建（New）

```
apps/web/src/components/PixelTable/
├── index.ts                              # 公共导出
├── PixelTableView.tsx                    # 容器组件（Stage 包裹 + 状态计算）
├── stage/
│   ├── PixiStage.tsx                     # @pixi/react Application 包裹（含尺寸自适应）
│   ├── Table.tsx                         # 椭圆桌面 sprite
│   ├── PotDisplay.tsx                    # 顶部底池数字（含 All-in 红光闪烁）
│   ├── CommunityCards.tsx                # 5 张公共牌
│   ├── PlayingCard.tsx                   # 单张牌（正反面 + flip 动画）
│   ├── Seat.tsx                          # 单座位（聚合下方 4 个子元素）
│   ├── Avatar.tsx                        # 头像 + 思考者描边脉冲 + folded/out 状态变体
│   ├── BetIndicator.tsx                  # 头像上方下注金额小标签
│   ├── HoleCards.tsx                     # 玩家手牌（默认背面，showdown 翻开）
│   └── ChipsLabel.tsx                    # 头像下方昵称 + 筹码（含数字滚动）
├── effects/
│   ├── EmojiBubble.tsx                   # 头顶 emoji 气泡（pop in/out）
│   ├── ThinkingHalo.tsx                  # 思考者金色脉冲描边
│   ├── AllInFire.tsx                     # All-in 火焰粒子（≤50 颗）
│   └── WinCelebration.tsx                # 赢家冠光 + 金币粒子（≤80 颗）
├── logic/
│   ├── types.ts                          # PixelTableState, SeatState
│   ├── events-to-state.ts                # GameEvent[] → PixelTableState（纯函数）
│   ├── emoji-pool.ts                     # 决策 → emoji 池抽取（含防重）
│   ├── seat-layout.ts                    # 6 人位坐标计算（响应式）
│   └── animation-scheduler.ts            # emoji 守卫期 + 排队
├── assets/
│   └── placeholders/                     # M1-M5 占位 sprite（纯色 + 文字）
└── __tests__/
    ├── events-to-state.test.ts
    ├── emoji-pool.test.ts
    ├── seat-layout.test.ts
    └── animation-scheduler.test.ts

apps/web/src/components/
├── TurnCard.tsx                          # 底部当前手卡片（打字机 + 左右箭头回看）
└── TurnCard/
    ├── Typewriter.tsx                    # 打字机文本子组件（30 字/秒）
    └── __tests__/
        └── Typewriter.test.tsx

apps/web/vitest.config.ts                 # Vitest 配置（首次引入）
apps/web/src/test-setup.ts                # vitest setup（jsdom + @testing-library）
```

### 修改（Modify）

```
apps/web/package.json                     # +pixi.js, @pixi/react, vitest, @testing-library/*
apps/web/src/components/TableView.tsx     # 重构 Tab 结构：一级 Tab + 二级 Tab
apps/web/src/components/TabBar.tsx        # 一级 Tab 改为 "集锦/排行榜"（去掉 live tab）
apps/web/src/components/ChatFeed.tsx      # 不改逻辑，移到 "📝 文字" 二级 tab 下
apps/web/src/locales/zh.json              # 新增 i18n 字符串
apps/web/src/locales/en.json              # 同上
docs/CREDITS.md                           # 新建：CC-BY 资源署名（M6 才填，先建空文件）
```

---

## 任务总览

| # | 任务 | 里程碑 | 预估 |
|---|---|---|---|
| 1 | 引入 Vitest + 测试基础设施 | M1 | 1h |
| 2 | 安装 PixiJS + @pixi/react，最小 Stage 跑通 | M1 | 1h |
| 3 | 定义 PixelTableState 类型 | M1 | 30m |
| 4 | events-to-state.ts：基础事件累加（hand-start / pot-updated / phase-change） | M1 | 2h |
| 5 | events-to-state.ts：决策事件累加（action-taken / action-required） | M1 | 2h |
| 6 | events-to-state.ts：showdown / hand-complete / 淘汰 | M1 | 1.5h |
| 7 | seat-layout.ts：6 人位响应式坐标 | M1 | 1h |
| 8 | Table + PotDisplay + CommunityCards 静态渲染 | M1 | 2h |
| 9 | PlayingCard：正反面 + flip 动画 | M1 | 1.5h |
| 10 | Seat 静态渲染（Avatar + BetIndicator + HoleCards + ChipsLabel） | M1 | 2h |
| 11 | TabBar 重构 + TableView Tab 路由（一级 + 二级） | M1 | 1.5h |
| 12 | PixelTableView 容器：连接事件流 → 渲染 | M2 | 2h |
| 13 | ChipsLabel 数字滚动动画 | M2 | 1h |
| 14 | ThinkingHalo：当前思考者金色脉冲 | M2 | 1h |
| 15 | Avatar 状态变体（FOLDED 半透明 / OUT 灰阶） | M2 | 1h |
| 16 | emoji-pool.ts：决策 → emoji 抽取（防重） | M3 | 1.5h |
| 17 | animation-scheduler.ts：守卫期 + 排队 | M3 | 1.5h |
| 18 | EmojiBubble：弹出/停留/淡出 | M3 | 1.5h |
| 19 | EmojiBubble 接入 Seat（决策触发 + idle 30% 概率） | M3 | 1h |
| 20 | TurnCard 静态渲染 + Typewriter 子组件 | M4 | 2h |
| 21 | TurnCard 历史回看左右箭头 | M4 | 1.5h |
| 22 | AllInFire 粒子特效 | M5 | 2h |
| 23 | PotDisplay All-in 红光闪烁 | M5 | 1h |
| 24 | WinCelebration：冠光 + 金币粒子 | M5 | 2h |
| 25 | i18n 字符串补全（zh + en） | M5 | 30m |
| 26 | 移动端 / iPad / 桌面三档断点验证 | M7 | 1h |

**美术替换（M6）和音效（v2）不在本计划。** 所有任务用占位 sprite 完成；M6 用真实美术替换是另一份小计划。

---

## Task 1: 引入 Vitest + 测试基础设施

**Files:**
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/src/test-setup.ts`
- Modify: `apps/web/package.json`
- Test: `apps/web/src/components/__tests__/sanity.test.ts`

- [ ] **Step 1: 安装依赖**

```bash
cd "/Users/mi/Claude Code/CyberCasino/apps/web"
bun add -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

- [ ] **Step 2: 创建 `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    globals: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

- [ ] **Step 3: 创建 `src/test-setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 4: 在 `package.json` 的 scripts 加 test**

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: 写一个 sanity 测试 `src/components/__tests__/sanity.test.ts`**

```ts
import { describe, it, expect } from "vitest";

describe("vitest setup", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: 运行测试**

Run: `bun run test`
Expected: 1 passed

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json apps/web/bun.lock apps/web/vitest.config.ts apps/web/src/test-setup.ts apps/web/src/components/__tests__/sanity.test.ts ../../bun.lock
git commit -m "chore(web): 引入 vitest + jsdom + @testing-library 作为前端测试基础"
```

---

## Task 2: 安装 PixiJS + @pixi/react，最小 Stage 跑通

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/src/components/PixelTable/stage/PixiStage.tsx`
- Create: `apps/web/src/components/PixelTable/__tests__/PixiStage.test.tsx`

- [ ] **Step 1: 安装 PixiJS**

```bash
cd "/Users/mi/Claude Code/CyberCasino/apps/web"
bun add pixi.js@^8 @pixi/react@^8
```

- [ ] **Step 2: 写测试 `__tests__/PixiStage.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@pixi/react", () => ({
  Application: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="pixi-app">{children}</div>
  ),
}));

import { PixiStage } from "../stage/PixiStage";

describe("PixiStage", () => {
  it("renders an Application root", () => {
    const { getByTestId } = render(
      <PixiStage width={300} height={400}>
        <div data-testid="child">child</div>
      </PixiStage>,
    );
    expect(getByTestId("pixi-app")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `bun run test PixiStage`
Expected: FAIL（PixiStage 还不存在）

- [ ] **Step 4: 实现 `stage/PixiStage.tsx`**

```tsx
"use client";

import { Application, extend } from "@pixi/react";
import { Container, Graphics, Sprite, Text } from "pixi.js";
import { ReactNode } from "react";

extend({ Container, Graphics, Sprite, Text });

interface PixiStageProps {
  width: number;
  height: number;
  children: ReactNode;
  background?: number;
}

export function PixiStage({ width, height, children, background = 0xf6f6f7 }: PixiStageProps) {
  return (
    <Application
      width={width}
      height={height}
      background={background}
      antialias={false}
      resolution={typeof window !== "undefined" ? window.devicePixelRatio : 1}
      autoDensity
    >
      {children}
    </Application>
  );
}
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `bun run test PixiStage`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json apps/web/src/components/PixelTable/stage/PixiStage.tsx apps/web/src/components/PixelTable/__tests__/PixiStage.test.tsx ../../bun.lock
git commit -m "feat(pixel-table): 引入 pixi.js + @pixi/react，落地 PixiStage 组件"
```

---

## Task 3: 定义 PixelTableState 类型

**Files:**
- Create: `apps/web/src/components/PixelTable/logic/types.ts`

- [ ] **Step 1: 写入 `logic/types.ts`**

```ts
import type { Card, GamePhase, ActionType, AgentThought } from "@cybercasino/shared";

export type SeatStatus = "active" | "thinking" | "folded" | "all-in" | "out";

export interface SeatState {
  playerId: string;
  seatIndex: number;        // 0..5
  name: string;
  avatar: string;
  chips: number;
  currentBet: number;
  status: SeatStatus;
  holeCards: Card[] | null; // showdown 后才填
  lastDecision: {
    action: ActionType;
    amount?: number;
    thought?: AgentThought;
    handNumber: number;
    timestamp: number;       // events 数组下标，用于历史回看
  } | null;
}

export interface PixelTableState {
  handNumber: number;
  phase: GamePhase | "idle";
  communityCards: Card[];
  potTotal: number;
  seats: SeatState[];
  currentThinkerId: string | null;
  winners: { playerId: string; amount: number }[];
  allInFlashAt: number | null;       // 时间戳；用于触发底池红光（>0 = 触发中）
  lastEventIndex: number;            // 已消费到的 events 下标
}

export const EMPTY_PIXEL_TABLE_STATE: PixelTableState = {
  handNumber: 0,
  phase: "idle",
  communityCards: [],
  potTotal: 0,
  seats: [],
  currentThinkerId: null,
  winners: [],
  allInFlashAt: null,
  lastEventIndex: -1,
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/PixelTable/logic/types.ts
git commit -m "feat(pixel-table): 定义 PixelTableState/SeatState 类型"
```

---

## Task 4: events-to-state — 基础事件累加（hand-start / pot-updated / phase-change）

**Files:**
- Create: `apps/web/src/components/PixelTable/logic/events-to-state.ts`
- Create: `apps/web/src/components/PixelTable/__tests__/events-to-state.test.ts`

- [ ] **Step 1: 写测试 `events-to-state.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import type { GameEvent, PlayerState } from "@cybercasino/shared";
import { eventsToTableState } from "../logic/events-to-state";
import { EMPTY_PIXEL_TABLE_STATE } from "../logic/types";

const player = (id: string, seat: number, chips = 1000): PlayerState => ({
  id, name: id, avatar: "🤖", chips, holeCards: null, bet: 0, folded: false, allIn: false, seatIndex: seat,
});

describe("eventsToTableState - basics", () => {
  it("returns empty state for empty events", () => {
    expect(eventsToTableState([])).toEqual(EMPTY_PIXEL_TABLE_STATE);
  });

  it("populates seats and handNumber on hand-start", () => {
    const events: GameEvent[] = [
      { type: "hand-start", handNumber: 1, players: [player("p1", 0), player("p2", 1)], dealerSeatIndex: 0 },
    ];
    const state = eventsToTableState(events);
    expect(state.handNumber).toBe(1);
    expect(state.seats).toHaveLength(2);
    expect(state.seats[0].playerId).toBe("p1");
    expect(state.seats[0].chips).toBe(1000);
    expect(state.seats[0].status).toBe("active");
  });

  it("updates pot total on pot-updated", () => {
    const events: GameEvent[] = [
      { type: "hand-start", handNumber: 1, players: [player("p1", 0)], dealerSeatIndex: 0 },
      { type: "pot-updated", pots: [{ amount: 300, eligiblePlayerIds: ["p1"] }, { amount: 100, eligiblePlayerIds: ["p1"] }] },
    ];
    expect(eventsToTableState(events).potTotal).toBe(400);
  });

  it("updates phase and community cards on phase-change", () => {
    const events: GameEvent[] = [
      { type: "hand-start", handNumber: 1, players: [player("p1", 0)], dealerSeatIndex: 0 },
      { type: "phase-change", phase: "flop", communityCards: [{ rank: 14, suit: "s" }, { rank: 13, suit: "h" }, { rank: 7, suit: "c" }] },
    ];
    const state = eventsToTableState(events);
    expect(state.phase).toBe("flop");
    expect(state.communityCards).toHaveLength(3);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `bun run test events-to-state`
Expected: FAIL（eventsToTableState 不存在）

- [ ] **Step 3: 实现 `logic/events-to-state.ts`**

```ts
import type { GameEvent } from "@cybercasino/shared";
import { EMPTY_PIXEL_TABLE_STATE, type PixelTableState, type SeatState } from "./types";

export function eventsToTableState(events: GameEvent[]): PixelTableState {
  let state: PixelTableState = { ...EMPTY_PIXEL_TABLE_STATE, seats: [] };

  for (let i = 0; i < events.length; i++) {
    state = applyEvent(state, events[i], i);
  }
  return state;
}

function applyEvent(state: PixelTableState, e: GameEvent, index: number): PixelTableState {
  const next = { ...state, lastEventIndex: index };
  switch (e.type) {
    case "hand-start":
      return {
        ...next,
        handNumber: e.handNumber,
        phase: "preflop",
        communityCards: [],
        potTotal: 0,
        currentThinkerId: null,
        winners: [],
        seats: e.players.map<SeatState>((p) => ({
          playerId: p.id,
          seatIndex: p.seatIndex,
          name: p.name,
          avatar: p.avatar,
          chips: p.chips,
          currentBet: 0,
          status: p.folded ? "folded" : "active",
          holeCards: null,
          lastDecision: null,
        })),
      };
    case "pot-updated":
      return { ...next, potTotal: e.pots.reduce((sum, pot) => sum + pot.amount, 0) };
    case "phase-change":
      return { ...next, phase: e.phase, communityCards: e.communityCards };
    default:
      return next;
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `bun run test events-to-state`
Expected: PASS（3 个测试）

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/PixelTable/logic/events-to-state.ts apps/web/src/components/PixelTable/__tests__/events-to-state.test.ts
git commit -m "feat(pixel-table): events-to-state 基础事件累加（hand-start/pot/phase）"
```

---

## Task 5: events-to-state — 决策事件累加（action-taken / action-required）

**Files:**
- Modify: `apps/web/src/components/PixelTable/logic/events-to-state.ts`
- Modify: `apps/web/src/components/PixelTable/__tests__/events-to-state.test.ts`

- [ ] **Step 1: 在测试文件追加 describe 块**

```ts
describe("eventsToTableState - decisions", () => {
  const baseEvents: GameEvent[] = [
    { type: "hand-start", handNumber: 1, players: [player("p1", 0), player("p2", 1)], dealerSeatIndex: 0 },
  ];

  it("sets currentThinkerId on action-required", () => {
    const events: GameEvent[] = [
      ...baseEvents,
      { type: "action-required", playerId: "p1", validActions: ["fold", "call", "raise"], currentBet: 50, minRaise: 100, callAmount: 50 },
    ];
    const state = eventsToTableState(events);
    expect(state.currentThinkerId).toBe("p1");
    expect(state.seats[0].status).toBe("thinking");
  });

  it("records lastDecision and updates bet/chips on action-taken (raise)", () => {
    const events: GameEvent[] = [
      ...baseEvents,
      { type: "action-required", playerId: "p1", validActions: ["fold", "call", "raise"], currentBet: 0, minRaise: 100, callAmount: 0 },
      { type: "action-taken", playerId: "p1", action: { type: "raise", amount: 200 }, thought: { message: "go", confidence: 0.9, isBluffing: false, thinkingSource: "rule" } },
    ];
    const state = eventsToTableState(events);
    expect(state.currentThinkerId).toBe(null);
    expect(state.seats[0].currentBet).toBe(200);
    expect(state.seats[0].chips).toBe(800);
    expect(state.seats[0].status).toBe("active");
    expect(state.seats[0].lastDecision?.action).toBe("raise");
    expect(state.seats[0].lastDecision?.amount).toBe(200);
  });

  it("marks seat folded on fold action", () => {
    const events: GameEvent[] = [
      ...baseEvents,
      { type: "action-taken", playerId: "p1", action: { type: "fold" }, thought: { message: "no", confidence: 0.5, isBluffing: false, thinkingSource: "rule" } },
    ];
    expect(eventsToTableState(events).seats[0].status).toBe("folded");
  });

  it("marks seat all-in and triggers allInFlashAt", () => {
    const events: GameEvent[] = [
      ...baseEvents,
      { type: "action-taken", playerId: "p1", action: { type: "raise", amount: 1000 }, thought: { message: "all", confidence: 0.6, isBluffing: false, thinkingSource: "rule" }, allIn: true },
    ];
    const state = eventsToTableState(events);
    expect(state.seats[0].status).toBe("all-in");
    expect(state.seats[0].chips).toBe(0);
    expect(state.allInFlashAt).not.toBe(null);
  });

  it("resets currentBet on phase-change", () => {
    const events: GameEvent[] = [
      ...baseEvents,
      { type: "action-taken", playerId: "p1", action: { type: "raise", amount: 200 }, thought: { message: "x", confidence: 0.5, isBluffing: false, thinkingSource: "rule" } },
      { type: "phase-change", phase: "flop", communityCards: [] },
    ];
    expect(eventsToTableState(events).seats[0].currentBet).toBe(0);
  });
});
```

- [ ] **Step 2: 运行测试，确认新增 5 项失败**

Run: `bun run test events-to-state`
Expected: FAIL（新增 5 项）

- [ ] **Step 3: 扩展 `applyEvent` switch（替换原文件）**

完整新版 `events-to-state.ts`：

```ts
import type { GameEvent } from "@cybercasino/shared";
import { EMPTY_PIXEL_TABLE_STATE, type PixelTableState, type SeatState } from "./types";

export function eventsToTableState(events: GameEvent[]): PixelTableState {
  let state: PixelTableState = { ...EMPTY_PIXEL_TABLE_STATE, seats: [] };
  for (let i = 0; i < events.length; i++) {
    state = applyEvent(state, events[i], i);
  }
  return state;
}

function applyEvent(state: PixelTableState, e: GameEvent, index: number): PixelTableState {
  const next = { ...state, lastEventIndex: index };
  switch (e.type) {
    case "hand-start":
      return {
        ...next,
        handNumber: e.handNumber,
        phase: "preflop",
        communityCards: [],
        potTotal: 0,
        currentThinkerId: null,
        winners: [],
        allInFlashAt: null,
        seats: e.players.map<SeatState>((p) => ({
          playerId: p.id,
          seatIndex: p.seatIndex,
          name: p.name,
          avatar: p.avatar,
          chips: p.chips,
          currentBet: 0,
          status: p.folded ? "folded" : "active",
          holeCards: null,
          lastDecision: null,
        })),
      };

    case "pot-updated":
      return { ...next, potTotal: e.pots.reduce((sum, pot) => sum + pot.amount, 0) };

    case "phase-change":
      return {
        ...next,
        phase: e.phase,
        communityCards: e.communityCards,
        seats: next.seats.map((s) => ({ ...s, currentBet: 0 })),
      };

    case "action-required":
      return {
        ...next,
        currentThinkerId: e.playerId,
        seats: next.seats.map((s) =>
          s.playerId === e.playerId && s.status === "active" ? { ...s, status: "thinking" } : s,
        ),
      };

    case "action-taken": {
      const seats = next.seats.map((s) => {
        if (s.playerId !== e.playerId) return s;
        const isFold = e.action.type === "fold";
        const isAllIn = e.allIn === true;
        const amount = e.action.amount ?? 0;
        const delta = amount - s.currentBet;  // 加注差值
        return {
          ...s,
          currentBet: isFold ? s.currentBet : Math.max(s.currentBet, amount),
          chips: isFold ? s.chips : Math.max(0, s.chips - Math.max(0, delta)),
          status: isFold ? "folded" : isAllIn ? "all-in" : "active",
          lastDecision: {
            action: e.action.type,
            amount: e.action.amount,
            thought: e.thought,
            handNumber: state.handNumber,
            timestamp: index,
          },
        } satisfies SeatState;
      });
      return {
        ...next,
        seats,
        currentThinkerId: state.currentThinkerId === e.playerId ? null : state.currentThinkerId,
        allInFlashAt: e.allIn ? Date.now() : state.allInFlashAt,
      };
    }

    default:
      return next;
  }
}
```

- [ ] **Step 4: 运行测试，确认全部通过**

Run: `bun run test events-to-state`
Expected: PASS（基础 3 项 + 决策 5 项）

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/PixelTable/logic/events-to-state.ts apps/web/src/components/PixelTable/__tests__/events-to-state.test.ts
git commit -m "feat(pixel-table): events-to-state 决策事件累加（action-taken/required）"
```

---

## Task 6: events-to-state — showdown / hand-complete / 淘汰

**Files:**
- Modify: `apps/web/src/components/PixelTable/logic/events-to-state.ts`
- Modify: `apps/web/src/components/PixelTable/__tests__/events-to-state.test.ts`

- [ ] **Step 1: 追加测试**

```ts
describe("eventsToTableState - terminal", () => {
  const handStart = (): GameEvent => ({
    type: "hand-start", handNumber: 1, players: [player("p1", 0), player("p2", 1)], dealerSeatIndex: 0,
  });

  it("reveals hole cards on showdown", () => {
    const events: GameEvent[] = [
      handStart(),
      { type: "showdown", results: [
        { playerId: "p1", holeCards: [{ rank: 14, suit: "s" }, { rank: 14, suit: "h" }], bestHand: [], handRank: "pair", handName: "Pair of Aces" },
      ] },
    ];
    expect(eventsToTableState(events).seats[0].holeCards).toHaveLength(2);
  });

  it("sets winners and updates chips on hand-complete", () => {
    const events: GameEvent[] = [
      handStart(),
      { type: "hand-complete", winners: [{ playerId: "p1", amount: 300, potIndex: 0 }], players: [player("p1", 0, 1300), player("p2", 1, 700)] },
    ];
    const state = eventsToTableState(events);
    expect(state.winners).toEqual([{ playerId: "p1", amount: 300 }]);
    expect(state.seats[0].chips).toBe(1300);
  });

  it("marks player out on player-eliminated", () => {
    const events: GameEvent[] = [
      handStart(),
      { type: "player-eliminated", playerId: "p2", finishPosition: 6, handNumber: 1 },
    ];
    expect(eventsToTableState(events).seats[1].status).toBe("out");
  });
});
```

- [ ] **Step 2: 运行测试，确认 3 项失败**

Run: `bun run test events-to-state`
Expected: FAIL

- [ ] **Step 3: 在 applyEvent switch 内追加 cases（在 default 之前）**

```ts
    case "showdown":
      return {
        ...next,
        seats: next.seats.map((s) => {
          const r = e.results.find((x) => x.playerId === s.playerId);
          return r ? { ...s, holeCards: r.holeCards } : s;
        }),
      };

    case "hand-complete":
      return {
        ...next,
        winners: e.winners.map((w) => ({ playerId: w.playerId, amount: w.amount })),
        seats: next.seats.map((s) => {
          const updated = e.players.find((p) => p.id === s.playerId);
          return updated ? { ...s, chips: updated.chips } : s;
        }),
      };

    case "player-eliminated":
      return {
        ...next,
        seats: next.seats.map((s) => (s.playerId === e.playerId ? { ...s, status: "out" } : s)),
      };
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `bun run test events-to-state`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/PixelTable/logic/events-to-state.ts apps/web/src/components/PixelTable/__tests__/events-to-state.test.ts
git commit -m "feat(pixel-table): events-to-state 终局事件（showdown/winners/淘汰）"
```

---

## Task 7: seat-layout.ts — 6 人位响应式坐标

**Files:**
- Create: `apps/web/src/components/PixelTable/logic/seat-layout.ts`
- Create: `apps/web/src/components/PixelTable/__tests__/seat-layout.test.ts`

**布局规则**：竖椭圆桌中心 (cx, cy)，半轴 (rx, ry)。6 个座位坐标：
- seat 0：上方（cx, cy - ry - margin）
- seat 1：左上（cx - rx, cy - ry/2.5）
- seat 2：右上（cx + rx, cy - ry/2.5）
- seat 3：左下（cx - rx, cy + ry/2.5）
- seat 4：右下（cx + rx, cy + ry/2.5）
- seat 5：下方（cx, cy + ry + margin）

- [ ] **Step 1: 写测试**

```ts
import { describe, it, expect } from "vitest";
import { computeSeatPositions } from "../logic/seat-layout";

describe("computeSeatPositions", () => {
  const dim = { width: 300, height: 500, marginY: 30 };

  it("returns 6 positions", () => {
    const ps = computeSeatPositions(dim);
    expect(ps).toHaveLength(6);
  });

  it("seat 0 is above seat 5 (vertical ellipse)", () => {
    const ps = computeSeatPositions(dim);
    expect(ps[0].y).toBeLessThan(ps[5].y);
    expect(Math.abs(ps[0].x - ps[5].x)).toBeLessThan(1);  // 同一垂直线
  });

  it("left seats x < right seats x", () => {
    const ps = computeSeatPositions(dim);
    expect(ps[1].x).toBeLessThan(ps[2].x);
    expect(ps[3].x).toBeLessThan(ps[4].x);
  });

  it("table center is at width/2", () => {
    const ps = computeSeatPositions(dim);
    expect(ps[0].x).toBeCloseTo(150, 0);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `bun run test seat-layout`
Expected: FAIL

- [ ] **Step 3: 实现 `seat-layout.ts`**

```ts
export interface StageDim {
  width: number;
  height: number;
  marginY?: number;
}

export interface SeatPosition {
  x: number;
  y: number;
}

export function computeSeatPositions({ width, height, marginY = 30 }: StageDim): SeatPosition[] {
  const cx = width / 2;
  const cy = height / 2;
  // 桌面竖椭圆：保留底部空间给底部卡片，所以 ry 不能太大
  const rx = Math.min(width * 0.32, 110);
  const ry = Math.min(height * 0.34, 150);

  return [
    { x: cx, y: cy - ry - marginY },        // 0 上
    { x: cx - rx, y: cy - ry / 2.5 },        // 1 左上
    { x: cx + rx, y: cy - ry / 2.5 },        // 2 右上
    { x: cx - rx, y: cy + ry / 2.5 },        // 3 左下
    { x: cx + rx, y: cy + ry / 2.5 },        // 4 右下
    { x: cx, y: cy + ry + marginY },        // 5 下
  ];
}

export function computeTableEllipse({ width, height }: StageDim) {
  const cx = width / 2;
  const cy = height / 2;
  const rx = Math.min(width * 0.32, 110);
  const ry = Math.min(height * 0.34, 150);
  return { cx, cy, rx, ry };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `bun run test seat-layout`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/PixelTable/logic/seat-layout.ts apps/web/src/components/PixelTable/__tests__/seat-layout.test.ts
git commit -m "feat(pixel-table): seat-layout 6 人位响应式坐标计算"
```

---

## Task 8: Table + PotDisplay + CommunityCards 静态渲染

**Files:**
- Create: `apps/web/src/components/PixelTable/stage/Table.tsx`
- Create: `apps/web/src/components/PixelTable/stage/PotDisplay.tsx`
- Create: `apps/web/src/components/PixelTable/stage/CommunityCards.tsx`

> 测试：因为是 PixiJS Graphics 渲染，这一类组件单测覆盖率收益低，集成测试在 Task 26 移动端验证时通过截图回归。**这一组任务不写单测**，相信 PixiJS API。

- [ ] **Step 1: 实现 `stage/Table.tsx`**

```tsx
"use client";

import { Graphics } from "pixi.js";
import { useCallback } from "react";
import type { StageDim } from "../logic/seat-layout";
import { computeTableEllipse } from "../logic/seat-layout";

interface TableProps {
  dim: StageDim;
}

export function Table({ dim }: TableProps) {
  const { cx, cy, rx, ry } = computeTableEllipse(dim);

  const draw = useCallback((g: Graphics) => {
    g.clear();
    // 桌面阴影
    g.ellipse(cx, cy + 8, rx, ry).fill({ color: 0x1a4d2e, alpha: 0.35 });
    // 桌沿
    g.ellipse(cx, cy, rx + 4, ry + 4).fill(0x5a4a3a);
    // 桌面（低饱和绿）
    g.ellipse(cx, cy, rx, ry).fill(0x3d8b6a);
    // 内圈高光
    g.ellipse(cx, cy, rx - 12, ry - 12).stroke({ color: 0x4d9e7a, width: 1, alpha: 0.6 });
  }, [cx, cy, rx, ry]);

  return <pixiGraphics draw={draw} />;
}
```

- [ ] **Step 2: 实现 `stage/PotDisplay.tsx`**

```tsx
"use client";

import { TextStyle } from "pixi.js";

interface PotDisplayProps {
  amount: number;
  x: number;
  y: number;
  flash?: boolean;
}

const POT_STYLE = new TextStyle({
  fontFamily: "ui-monospace, SFMono-Regular, monospace",
  fontSize: 13,
  fontWeight: "600",
  fill: 0xffd700,
});

export function PotDisplay({ amount, x, y, flash = false }: PotDisplayProps) {
  const text = `💰 POT $${amount.toLocaleString()}`;
  return (
    <pixiContainer x={x} y={y}>
      <pixiGraphics
        draw={(g) => {
          g.clear();
          g.roundRect(-60, -12, 120, 24, 12).fill({
            color: flash ? 0xff3355 : 0x000000,
            alpha: flash ? 0.85 : 0.7,
          });
        }}
      />
      <pixiText text={text} anchor={0.5} style={POT_STYLE} />
    </pixiContainer>
  );
}
```

- [ ] **Step 3: 实现 `stage/CommunityCards.tsx`**

```tsx
"use client";

import type { Card } from "@cybercasino/shared";
import { PlayingCard } from "./PlayingCard";

interface CommunityCardsProps {
  cards: Card[];
  cx: number;
  cy: number;
}

const CARD_W = 22;
const CARD_GAP = 4;
const SLOTS = 5;

export function CommunityCards({ cards, cx, cy }: CommunityCardsProps) {
  const totalW = CARD_W * SLOTS + CARD_GAP * (SLOTS - 1);
  const startX = cx - totalW / 2 + CARD_W / 2;
  return (
    <pixiContainer>
      {Array.from({ length: SLOTS }).map((_, i) => {
        const card = cards[i];
        return (
          <PlayingCard
            key={i}
            card={card ?? null}
            x={startX + i * (CARD_W + CARD_GAP)}
            y={cy}
            width={CARD_W}
          />
        );
      })}
    </pixiContainer>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/PixelTable/stage/Table.tsx apps/web/src/components/PixelTable/stage/PotDisplay.tsx apps/web/src/components/PixelTable/stage/CommunityCards.tsx
git commit -m "feat(pixel-table): Table/PotDisplay/CommunityCards 静态渲染"
```

---

## Task 9: PlayingCard — 正反面 + flip 动画

**Files:**
- Create: `apps/web/src/components/PixelTable/stage/PlayingCard.tsx`

- [ ] **Step 1: 实现 `PlayingCard.tsx`**

```tsx
"use client";

import { TextStyle, type Graphics } from "pixi.js";
import { useEffect, useRef, useState, useCallback } from "react";
import type { Card } from "@cybercasino/shared";

interface PlayingCardProps {
  card: Card | null;          // null = 空槽，背面渲染但灰阶
  x: number;
  y: number;
  width: number;
  faceDown?: boolean;          // true = 强制背面（用于玩家手牌默认）
}

const FLIP_MS = 300;

const FACE_STYLE = new TextStyle({ fontFamily: "ui-monospace", fontSize: 11, fontWeight: "700" });
const FACE_RED = new TextStyle({ fontFamily: "ui-monospace", fontSize: 11, fontWeight: "700", fill: 0xc00020 });

function rankLabel(r: number): string {
  if (r === 14) return "A";
  if (r === 13) return "K";
  if (r === 12) return "Q";
  if (r === 11) return "J";
  return String(r);
}

const SUIT_GLYPH: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };

export function PlayingCard({ card, x, y, width, faceDown = false }: PlayingCardProps) {
  const height = Math.round(width * 1.4);
  const [progress, setProgress] = useState(card ? 1 : 0);  // 0=背面，1=正面
  const lastCard = useRef<Card | null>(null);
  const target = card && !faceDown ? 1 : 0;

  useEffect(() => {
    if (lastCard.current === card && progress === target) return;
    lastCard.current = card;
    const start = performance.now();
    const from = progress;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / FLIP_MS);
      setProgress(from + (target - from) * t);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [card, faceDown, target]);

  // flip 用 scaleX：1 → 0 → -1 → 0 → 1，到 0 时切换内容
  const scaleX = Math.abs(progress * 2 - 1);    // 0 → 1
  const showFront = progress >= 0.5;

  const drawBg = useCallback((g: Graphics) => {
    g.clear();
    if (showFront && card) {
      g.roundRect(-width / 2, -height / 2, width, height, 3).fill(0xffffff).stroke({ color: 0x222, width: 0.5 });
    } else {
      g.roundRect(-width / 2, -height / 2, width, height, 3).fill(0x3a3a8a).stroke({ color: 0xffffff, width: 0.5 });
    }
  }, [card, showFront, width, height]);

  return (
    <pixiContainer x={x} y={y} scale={{ x: scaleX, y: 1 }}>
      <pixiGraphics draw={drawBg} />
      {showFront && card && (
        <>
          <pixiText
            text={rankLabel(card.rank)}
            anchor={{ x: 0, y: 0 }}
            x={-width / 2 + 2}
            y={-height / 2 + 2}
            style={card.suit === "h" || card.suit === "d" ? FACE_RED : FACE_STYLE}
          />
          <pixiText
            text={SUIT_GLYPH[card.suit]}
            anchor={0.5}
            style={card.suit === "h" || card.suit === "d" ? FACE_RED : FACE_STYLE}
          />
        </>
      )}
    </pixiContainer>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/PixelTable/stage/PlayingCard.tsx
git commit -m "feat(pixel-table): PlayingCard 正反面 + flip 动画"
```

---

## Task 10: Seat 静态渲染（聚合 Avatar + BetIndicator + HoleCards + ChipsLabel）

**Files:**
- Create: `apps/web/src/components/PixelTable/stage/Avatar.tsx`
- Create: `apps/web/src/components/PixelTable/stage/BetIndicator.tsx`
- Create: `apps/web/src/components/PixelTable/stage/HoleCards.tsx`
- Create: `apps/web/src/components/PixelTable/stage/ChipsLabel.tsx`
- Create: `apps/web/src/components/PixelTable/stage/Seat.tsx`

- [ ] **Step 1: `Avatar.tsx` — 圆形头像（emoji 占位）**

```tsx
"use client";

import { TextStyle, type Graphics } from "pixi.js";
import { useCallback } from "react";
import type { SeatStatus } from "../logic/types";

interface AvatarProps {
  emoji: string;
  status: SeatStatus;
  x: number;
  y: number;
  size?: number;
}

const EMOJI_STYLE = new TextStyle({ fontFamily: "system-ui", fontSize: 16 });

export function Avatar({ emoji, status, x, y, size = 32 }: AvatarProps) {
  const r = size / 2;
  const draw = useCallback((g: Graphics) => {
    g.clear();
    let fillColor = 0xffe0bd;
    let alpha = 1;
    if (status === "folded") alpha = 0.4;
    if (status === "out") fillColor = 0xbbbbbb;
    g.circle(0, 0, r).fill({ color: fillColor, alpha }).stroke({ color: 0x333, width: 1.5 });
  }, [status, r]);

  return (
    <pixiContainer x={x} y={y}>
      <pixiGraphics draw={draw} />
      <pixiText
        text={emoji}
        anchor={0.5}
        style={EMOJI_STYLE}
        alpha={status === "folded" ? 0.4 : status === "out" ? 0.5 : 1}
      />
    </pixiContainer>
  );
}
```

- [ ] **Step 2: `BetIndicator.tsx` — 头像上方下注小标签**

```tsx
"use client";

import { TextStyle, type Graphics } from "pixi.js";
import { useCallback } from "react";

interface BetIndicatorProps {
  amount: number;
  x: number;
  y: number;
}

const STYLE = new TextStyle({ fontFamily: "ui-monospace", fontSize: 9, fontWeight: "700", fill: 0xaa0033 });

export function BetIndicator({ amount, x, y }: BetIndicatorProps) {
  if (amount <= 0) return null;
  const text = `⬆ $${amount.toLocaleString()}`;
  const pad = 4;
  const draw = useCallback((g: Graphics) => {
    g.clear();
    const w = text.length * 6 + pad * 2;
    g.roundRect(-w / 2, -8, w, 16, 8)
      .fill(0xffffff)
      .stroke({ color: 0xff5577, width: 1 });
  }, [text]);

  return (
    <pixiContainer x={x} y={y}>
      <pixiGraphics draw={draw} />
      <pixiText text={text} anchor={0.5} style={STYLE} />
    </pixiContainer>
  );
}
```

- [ ] **Step 3: `HoleCards.tsx` — 玩家两张牌**

```tsx
"use client";

import type { Card } from "@cybercasino/shared";
import { PlayingCard } from "./PlayingCard";

interface HoleCardsProps {
  cards: Card[] | null;
  x: number;
  y: number;
  cardWidth?: number;
}

export function HoleCards({ cards, x, y, cardWidth = 12 }: HoleCardsProps) {
  const gap = 2;
  return (
    <pixiContainer x={x} y={y}>
      <PlayingCard card={cards?.[0] ?? null} x={-(cardWidth + gap) / 2} y={0} width={cardWidth} faceDown={!cards} />
      <PlayingCard card={cards?.[1] ?? null} x={(cardWidth + gap) / 2} y={0} width={cardWidth} faceDown={!cards} />
    </pixiContainer>
  );
}
```

- [ ] **Step 4: `ChipsLabel.tsx` — 昵称 + 筹码（先静态，Task 13 加滚动）**

```tsx
"use client";

import { TextStyle } from "pixi.js";

interface ChipsLabelProps {
  name: string;
  chips: number;
  x: number;
  y: number;
  dim?: boolean;
}

const NAME_STYLE = new TextStyle({ fontFamily: "system-ui", fontSize: 9, fontWeight: "600" });
const CHIPS_STYLE = new TextStyle({ fontFamily: "ui-monospace", fontSize: 8, fill: 0x888 });

export function ChipsLabel({ name, chips, x, y, dim = false }: ChipsLabelProps) {
  return (
    <pixiContainer x={x} y={y} alpha={dim ? 0.5 : 1}>
      <pixiText text={name} anchor={{ x: 0.5, y: 0 }} style={NAME_STYLE} />
      <pixiText text={`$${chips.toLocaleString()}`} anchor={{ x: 0.5, y: 0 }} y={11} style={CHIPS_STYLE} />
    </pixiContainer>
  );
}
```

- [ ] **Step 5: `Seat.tsx` — 聚合所有子元素**

```tsx
"use client";

import type { SeatState } from "../logic/types";
import { Avatar } from "./Avatar";
import { BetIndicator } from "./BetIndicator";
import { HoleCards } from "./HoleCards";
import { ChipsLabel } from "./ChipsLabel";

interface SeatProps {
  seat: SeatState;
  x: number;
  y: number;
}

const AVATAR_SIZE = 32;

export function Seat({ seat, x, y }: SeatProps) {
  const dim = seat.status === "folded" || seat.status === "out";
  return (
    <pixiContainer x={x} y={y}>
      <BetIndicator amount={seat.currentBet} x={0} y={-AVATAR_SIZE / 2 - 16} />
      <Avatar emoji={seat.avatar || "🤖"} status={seat.status} x={0} y={0} size={AVATAR_SIZE} />
      <HoleCards cards={seat.holeCards} x={0} y={AVATAR_SIZE / 2 + 12} />
      <ChipsLabel name={seat.name} chips={seat.chips} x={0} y={AVATAR_SIZE / 2 + 24} dim={dim} />
    </pixiContainer>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/PixelTable/stage/Avatar.tsx apps/web/src/components/PixelTable/stage/BetIndicator.tsx apps/web/src/components/PixelTable/stage/HoleCards.tsx apps/web/src/components/PixelTable/stage/ChipsLabel.tsx apps/web/src/components/PixelTable/stage/Seat.tsx
git commit -m "feat(pixel-table): Seat 静态渲染（Avatar/BetIndicator/HoleCards/ChipsLabel）"
```

---

## Task 11: TabBar 重构 + TableView Tab 路由（一级 + 二级）

**Files:**
- Modify: `apps/web/src/components/TabBar.tsx`
- Modify: `apps/web/src/components/TableView.tsx`

**当前 `TabBar` 包含 `live | highlights | leaderboard` 三个一级 tab；现需改为 `highlights | leaderboard` 两个一级 tab，并在 `TableView` 内部用本地 state 管理二级 tab `live | text`。**

- [ ] **Step 1: 读 TabBar 现状**

Run: `cat apps/web/src/components/TabBar.tsx`

- [ ] **Step 2: 重构 `TabBar.tsx`**

> 操作要点：从 TabId 联合中删除 `"live"`，保留 `"highlights" | "leaderboard"`；移除"live" 按钮渲染；`isFinished` / `showReplay` 等参数保持不变；其它代码维持现状。

完整新 `TabBar.tsx`（按现有风格写——保留 export `TabId`、保留 i18n 调用，仅删除 live 选项）：

```tsx
"use client";

import { useLanguage } from "@/contexts/LanguageContext";

export type TabId = "highlights" | "leaderboard";

interface TabBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  hasNewHighlight?: boolean;
  showReplay?: boolean;
}

export function TabBar({ activeTab, onTabChange, hasNewHighlight }: TabBarProps) {
  const { t } = useLanguage();
  const tabs: { id: TabId; label: string; badge?: boolean }[] = [
    { id: "highlights", label: `⭐ ${t("tableView.highlights")}`, badge: hasNewHighlight },
    { id: "leaderboard", label: `🏆 ${t("tableView.leaderboard")}` },
  ];
  return (
    <div className="flex">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`flex-1 h-9 text-[13px] font-medium relative ${
            activeTab === tab.id
              ? "text-text-primary border-b-2 border-accent"
              : "text-text-secondary"
          }`}
        >
          {tab.label}
          {tab.badge && (
            <span className="absolute top-1.5 right-[24%] w-1.5 h-1.5 bg-accent rounded-full" />
          )}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: 重构 `TableView.tsx`**

```tsx
"use client";

import { useState, useEffect, useRef } from "react";
import type { GameEvent } from "@cybercasino/shared";
import { ChatFeed } from "./ChatFeed";
import { TabBar, type TabId } from "./TabBar";
import { HighlightFeed } from "./HighlightFeed";
import { Leaderboard } from "./Leaderboard";
import { PixelTableView } from "./PixelTable/PixelTableView";
import { useLanguage } from "@/contexts/LanguageContext";
import { useHeader } from "@/contexts/HeaderContext";

type LiveSubTab = "live" | "text";

interface TableViewProps {
  tableId: string;
  tableName?: string;
  events: GameEvent[];
  onLeave: () => void;
  defaultTab?: TabId;
  isFinished?: boolean;
}

export function TableView({ tableId, tableName, events, onLeave, defaultTab = "highlights", isFinished = false }: TableViewProps) {
  const { t } = useLanguage();
  const { setVisible } = useHeader();
  const [replayCopied, setReplayCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>(defaultTab);
  const [liveSubTab, setLiveSubTab] = useState<LiveSubTab>("live");
  const [hasNewHighlight, setHasNewHighlight] = useState(false);
  const lastHighlightCount = useRef(0);

  useEffect(() => {
    setVisible(false);
    return () => setVisible(true);
  }, [setVisible]);

  useEffect(() => {
    const count = events.filter((e) => e.type === "hand-highlight").length;
    if (count > lastHighlightCount.current && activeTab !== "highlights") {
      setHasNewHighlight(true);
    }
    lastHighlightCount.current = count;
  }, [events, activeTab]);

  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab);
    if (tab === "highlights") setHasNewHighlight(false);
  };

  return (
    <div className="h-[100dvh] flex flex-col bg-surface-elevated">
      <header className="shrink-0 flex items-center justify-between px-5 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] bg-white/80 backdrop-blur-xl border-b border-separator z-20">
        <button
          onClick={onLeave}
          className="text-accent text-[15px] font-normal min-w-[44px] min-h-[44px] flex items-center"
        >
          {t("common.back")}
        </button>
        <h2 className="text-text-primary text-[17px] font-semibold tracking-tight">
          {tableName || "CyberCasino"}
        </h2>
        {isFinished ? (
          <button
            onClick={() => {
              const url = `${window.location.origin}/api/replay/${tableId}`;
              navigator.clipboard.writeText(url).then(() => {
                setReplayCopied(true);
                setTimeout(() => setReplayCopied(false), 2000);
              });
            }}
            className="text-accent text-[13px] font-medium min-h-[44px] flex items-center justify-end active:scale-95 transition-transform"
          >
            {replayCopied ? t("chatFeed.replayCopied") : t("chatFeed.shareReplay")}
          </button>
        ) : (
          <div className="text-success text-[13px] min-w-[44px] text-right font-medium">{t("lobby.playing")}</div>
        )}
      </header>

      <div className="shrink-0 border-b border-separator">
        <TabBar activeTab={activeTab} onTabChange={handleTabChange} hasNewHighlight={hasNewHighlight} showReplay={isFinished} />
      </div>

      {/* 二级 Tab：仅在 highlights 一级 tab 下显示 */}
      {activeTab === "highlights" && (
        <div className="shrink-0 flex justify-center py-2 border-b border-separator">
          <div className="inline-flex bg-black/5 rounded-lg p-0.5 text-[12px]">
            <button
              onClick={() => setLiveSubTab("live")}
              className={`px-3 py-1 rounded-md ${liveSubTab === "live" ? "bg-white shadow-sm font-semibold" : "text-text-secondary"}`}
            >
              📺 {t("tableView.subLive")}
            </button>
            <button
              onClick={() => setLiveSubTab("text")}
              className={`px-3 py-1 rounded-md ${liveSubTab === "text" ? "bg-white shadow-sm font-semibold" : "text-text-secondary"}`}
            >
              📝 {t("tableView.subText")}
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 relative">
        <div className={`absolute inset-0 ${activeTab === "highlights" && liveSubTab === "live" ? "" : "invisible pointer-events-none"}`}>
          <PixelTableView events={events} />
        </div>
        <div className={`absolute inset-0 ${activeTab === "highlights" && liveSubTab === "text" ? "" : "invisible pointer-events-none"}`}>
          <HighlightFeed events={events} />
        </div>
        <div className={`absolute inset-0 ${activeTab === "leaderboard" ? "" : "invisible pointer-events-none"}`}>
          <Leaderboard events={events} />
        </div>
        {/* ChatFeed 已合并到 HighlightFeed/PixelTableView 体系，不再单独 tab；归档分享走原入口 */}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 在 `locales/zh.json` / `locales/en.json` 加 key**

zh.json 追加：
```json
"tableView.subLive": "实况",
"tableView.subText": "文字",
```
en.json 追加：
```json
"tableView.subLive": "Live",
"tableView.subText": "Text",
```

> 注意：`ChatFeed` 暂时不再被任何路由渲染。如果需保留"归档分享"按钮的旧文字流路径，下一版可在 "📝 文字" tab 内组合 `HighlightFeed + ChatFeed`。本任务不做。

- [ ] **Step 5: 创建 `PixelTableView.tsx` 占位（让 import 不报错）**

```tsx
"use client";

import type { GameEvent } from "@cybercasino/shared";

interface PixelTableViewProps {
  events: GameEvent[];
}

export function PixelTableView({ events }: PixelTableViewProps) {
  return <div className="flex-1 flex items-center justify-center text-text-secondary text-sm">PixelTableView 占位 · {events.length} events</div>;
}
```

- [ ] **Step 6: 启动 dev 验证编译**

Run: `cd "/Users/mi/Claude Code/CyberCasino" && bun run --filter @cybercasino/web dev`
Expected: 编译成功，浏览器进入牌桌页面看到双层 Tab，实况 tab 显示 "PixelTableView 占位"。

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/TabBar.tsx apps/web/src/components/TableView.tsx apps/web/src/components/PixelTable/PixelTableView.tsx apps/web/src/locales/zh.json apps/web/src/locales/en.json
git commit -m "feat(pixel-table): TableView 重构为双层 Tab + PixelTableView 占位"
```

---

## Task 12: PixelTableView 容器：连接事件流 → 渲染

**Files:**
- Modify: `apps/web/src/components/PixelTable/PixelTableView.tsx`
- Create: `apps/web/src/components/PixelTable/index.ts`

- [ ] **Step 1: 创建 `index.ts`**

```ts
export { PixelTableView } from "./PixelTableView";
```

- [ ] **Step 2: 实现 `PixelTableView.tsx` 完整版**

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GameEvent } from "@cybercasino/shared";
import { PixiStage } from "./stage/PixiStage";
import { Table } from "./stage/Table";
import { PotDisplay } from "./stage/PotDisplay";
import { CommunityCards } from "./stage/CommunityCards";
import { Seat } from "./stage/Seat";
import { eventsToTableState } from "./logic/events-to-state";
import { computeSeatPositions, computeTableEllipse } from "./logic/seat-layout";

interface PixelTableViewProps {
  events: GameEvent[];
}

export function PixelTableView({ events }: PixelTableViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dim, setDim] = useState({ width: 360, height: 480 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setDim({ width: Math.max(280, Math.floor(r.width)), height: Math.max(360, Math.floor(r.height)) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const state = useMemo(() => eventsToTableState(events), [events]);
  const seatPositions = useMemo(() => computeSeatPositions(dim), [dim]);
  const ellipse = useMemo(() => computeTableEllipse(dim), [dim]);

  // 找到每个座位的渲染位置（按 seatIndex 取数组对应位置；不足 6 人时跳过）
  const placedSeats = state.seats.map((seat) => ({
    seat,
    pos: seatPositions[seat.seatIndex] ?? seatPositions[0],
  }));

  return (
    <div ref={containerRef} className="flex-1 flex items-center justify-center bg-surface-elevated relative">
      <PixiStage width={dim.width} height={dim.height}>
        <Table dim={dim} />
        <PotDisplay
          amount={state.potTotal}
          x={ellipse.cx}
          y={ellipse.cy - ellipse.ry - 14}
          flash={isAllInFlashing(state.allInFlashAt)}
        />
        <CommunityCards cards={state.communityCards} cx={ellipse.cx} cy={ellipse.cy} />
        {placedSeats.map(({ seat, pos }) => (
          <Seat key={seat.playerId} seat={seat} x={pos.x} y={pos.y} />
        ))}
      </PixiStage>
    </div>
  );
}

function isAllInFlashing(at: number | null): boolean {
  if (at == null) return false;
  return Date.now() - at < 1500;
}
```

- [ ] **Step 3: 启动 dev 验证**

Run: `cd "/Users/mi/Claude Code/CyberCasino" && bun run --filter @cybercasino/web dev`
进入一个进行中的牌桌 → 实况 tab → 应看到桌面 + 公共牌 + 6 个座位（emoji 头像）。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/PixelTable/PixelTableView.tsx apps/web/src/components/PixelTable/index.ts
git commit -m "feat(pixel-table): PixelTableView 容器接通事件流 → 状态 → 渲染"
```

---

## Task 13: ChipsLabel 数字滚动动画

**Files:**
- Modify: `apps/web/src/components/PixelTable/stage/ChipsLabel.tsx`

- [ ] **Step 1: 替换 `ChipsLabel.tsx`**

```tsx
"use client";

import { TextStyle } from "pixi.js";
import { useEffect, useRef, useState } from "react";

interface ChipsLabelProps {
  name: string;
  chips: number;
  x: number;
  y: number;
  dim?: boolean;
}

const NAME_STYLE = new TextStyle({ fontFamily: "system-ui", fontSize: 9, fontWeight: "600" });
const CHIPS_STYLE = new TextStyle({ fontFamily: "ui-monospace", fontSize: 8, fill: 0x888 });

const ROLL_MS = 300;

export function ChipsLabel({ name, chips, x, y, dim = false }: ChipsLabelProps) {
  const [display, setDisplay] = useState(chips);
  const fromRef = useRef(chips);

  useEffect(() => {
    if (chips === display) return;
    const start = performance.now();
    const from = fromRef.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ROLL_MS);
      const ease = 1 - (1 - t) * (1 - t);
      setDisplay(Math.round(from + (chips - from) * ease));
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = chips;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [chips]);

  return (
    <pixiContainer x={x} y={y} alpha={dim ? 0.5 : 1}>
      <pixiText text={name} anchor={{ x: 0.5, y: 0 }} style={NAME_STYLE} />
      <pixiText text={`$${display.toLocaleString()}`} anchor={{ x: 0.5, y: 0 }} y={11} style={CHIPS_STYLE} />
    </pixiContainer>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/PixelTable/stage/ChipsLabel.tsx
git commit -m "feat(pixel-table): ChipsLabel 数字滚动动画（300ms ease-out）"
```

---

## Task 14: ThinkingHalo — 当前思考者金色脉冲描边

**Files:**
- Create: `apps/web/src/components/PixelTable/effects/ThinkingHalo.tsx`
- Modify: `apps/web/src/components/PixelTable/stage/Seat.tsx`

- [ ] **Step 1: 实现 `effects/ThinkingHalo.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { type Graphics } from "pixi.js";

interface ThinkingHaloProps {
  active: boolean;
  radius: number;
}

export function ThinkingHalo({ active, radius }: ThinkingHaloProps) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      setPhase(((now - start) / 1400) % 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  if (!active) return null;
  // 0..1 → 0..2π
  const alpha = 0.4 + 0.4 * Math.sin(phase * Math.PI * 2);
  const expand = 2 + 2 * Math.sin(phase * Math.PI * 2);

  return (
    <pixiGraphics
      draw={(g: Graphics) => {
        g.clear();
        g.circle(0, 0, radius + expand).stroke({ color: 0xffd700, width: 2.5, alpha });
      }}
    />
  );
}
```

- [ ] **Step 2: 修改 `Seat.tsx` 引入 ThinkingHalo**

替换 Seat 内部，在 Avatar 之前插入：

```tsx
import { ThinkingHalo } from "../effects/ThinkingHalo";

// ... 在 <Avatar /> 之前：
<ThinkingHalo active={seat.status === "thinking"} radius={AVATAR_SIZE / 2} />
```

完整 `Seat.tsx`：

```tsx
"use client";

import type { SeatState } from "../logic/types";
import { Avatar } from "./Avatar";
import { BetIndicator } from "./BetIndicator";
import { HoleCards } from "./HoleCards";
import { ChipsLabel } from "./ChipsLabel";
import { ThinkingHalo } from "../effects/ThinkingHalo";

interface SeatProps {
  seat: SeatState;
  x: number;
  y: number;
}

const AVATAR_SIZE = 32;

export function Seat({ seat, x, y }: SeatProps) {
  const dim = seat.status === "folded" || seat.status === "out";
  return (
    <pixiContainer x={x} y={y}>
      <BetIndicator amount={seat.currentBet} x={0} y={-AVATAR_SIZE / 2 - 16} />
      <ThinkingHalo active={seat.status === "thinking"} radius={AVATAR_SIZE / 2} />
      <Avatar emoji={seat.avatar || "🤖"} status={seat.status} x={0} y={0} size={AVATAR_SIZE} />
      <HoleCards cards={seat.holeCards} x={0} y={AVATAR_SIZE / 2 + 12} />
      <ChipsLabel name={seat.name} chips={seat.chips} x={0} y={AVATAR_SIZE / 2 + 24} dim={dim} />
    </pixiContainer>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/PixelTable/effects/ThinkingHalo.tsx apps/web/src/components/PixelTable/stage/Seat.tsx
git commit -m "feat(pixel-table): ThinkingHalo 当前思考者金色脉冲描边"
```

---

## Task 15: Avatar 状态变体（FOLDED / OUT 已在 Task 10 实现，此 Task 验证 + 微调）

**Files:**
- Modify: `apps/web/src/components/PixelTable/stage/Avatar.tsx`

> Task 10 已含基础变体。本 Task 增强：FOLDED 状态下手牌也降透明，OUT 角色 emoji 全灰。

- [ ] **Step 1: 修改 `HoleCards.tsx` 支持 dim**

```tsx
interface HoleCardsProps {
  cards: Card[] | null;
  x: number;
  y: number;
  cardWidth?: number;
  dim?: boolean;
}

export function HoleCards({ cards, x, y, cardWidth = 12, dim = false }: HoleCardsProps) {
  const gap = 2;
  return (
    <pixiContainer x={x} y={y} alpha={dim ? 0.4 : 1}>
      <PlayingCard card={cards?.[0] ?? null} x={-(cardWidth + gap) / 2} y={0} width={cardWidth} faceDown={!cards} />
      <PlayingCard card={cards?.[1] ?? null} x={(cardWidth + gap) / 2} y={0} width={cardWidth} faceDown={!cards} />
    </pixiContainer>
  );
}
```

- [ ] **Step 2: Seat.tsx 把 dim 传给 HoleCards**

```tsx
<HoleCards cards={seat.holeCards} x={0} y={AVATAR_SIZE / 2 + 12} dim={dim} />
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/PixelTable/stage/HoleCards.tsx apps/web/src/components/PixelTable/stage/Seat.tsx
git commit -m "feat(pixel-table): FOLDED/OUT 状态下手牌同步降透明"
```

---

## Task 16: emoji-pool.ts — 决策 → emoji 抽取（防重）

**Files:**
- Create: `apps/web/src/components/PixelTable/logic/emoji-pool.ts`
- Create: `apps/web/src/components/PixelTable/__tests__/emoji-pool.test.ts`

- [ ] **Step 1: 写测试**

```ts
import { describe, it, expect } from "vitest";
import { pickEmoji, type EmojiContext } from "../logic/emoji-pool";

describe("pickEmoji", () => {
  it("returns null when context is none", () => {
    expect(pickEmoji({ kind: "none" } as EmojiContext, [])).toBe(null);
  });

  it("returns an emoji from FOLD pool for fold", () => {
    const e = pickEmoji({ kind: "fold" }, []);
    expect(["😅", "🙄", "😴", "🤷", "💤", "😮‍💨"]).toContain(e);
  });

  it("avoids the most recent emoji for the same player", () => {
    const last = ["🔥"];
    for (let i = 0; i < 50; i++) {
      const e = pickEmoji({ kind: "raise" }, last);
      expect(e).not.toBe("🔥");
    }
  });

  it("returns idle emoji ~30% of the time when context is idle", () => {
    let hits = 0;
    const seed = Array.from({ length: 1000 });
    seed.forEach(() => {
      if (pickEmoji({ kind: "idle" }, []) !== null) hits++;
    });
    expect(hits).toBeGreaterThan(200);
    expect(hits).toBeLessThan(400);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `bun run test emoji-pool`
Expected: FAIL

- [ ] **Step 3: 实现 `emoji-pool.ts`**

```ts
export type EmojiKind = "fold" | "call" | "check" | "raise" | "all-in" | "win" | "bad-beat" | "idle" | "none";

export interface EmojiContext {
  kind: EmojiKind;
}

const POOLS: Record<Exclude<EmojiKind, "none">, string[]> = {
  fold:    ["😅", "🙄", "😴", "🤷", "💤", "😮‍💨"],
  call:    ["🤔", "😏", "👀", "🧐", "😶", "🤨"],
  check:   ["😎", "🙂", "👌", "✋"],
  raise:   ["🔥", "💪", "⚡", "😤", "🎯"],
  "all-in":["💀", "⚡", "🔥", "🎲", "🚀"],
  win:     ["🎉", "💰", "😎", "👑", "🏆"],
  "bad-beat": ["😱", "🤯", "💀", "😭", "🥲"],
  idle:    ["😏", "😴", "🤔", "👀", "😎", "🙂", "😅"],
};

const IDLE_PROB = 0.3;

export function pickEmoji(ctx: EmojiContext, recent: string[]): string | null {
  if (ctx.kind === "none") return null;
  if (ctx.kind === "idle" && Math.random() >= IDLE_PROB) return null;

  const pool = POOLS[ctx.kind];
  const candidates = pool.filter((e) => !recent.includes(e));
  const finalPool = candidates.length > 0 ? candidates : pool;
  return finalPool[Math.floor(Math.random() * finalPool.length)];
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `bun run test emoji-pool`
Expected: PASS（4 项）

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/PixelTable/logic/emoji-pool.ts apps/web/src/components/PixelTable/__tests__/emoji-pool.test.ts
git commit -m "feat(pixel-table): emoji-pool 决策→emoji 抽取（防重 + idle 30%）"
```

---

## Task 17: animation-scheduler — 守卫期 + 排队

**Files:**
- Create: `apps/web/src/components/PixelTable/logic/animation-scheduler.ts`
- Create: `apps/web/src/components/PixelTable/__tests__/animation-scheduler.test.ts`

- [ ] **Step 1: 写测试**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createBubbleScheduler } from "../logic/animation-scheduler";

describe("createBubbleScheduler", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("emits immediately for first request", () => {
    const cb = vi.fn();
    const s = createBubbleScheduler(800, cb);
    s.request("p1", "🔥");
    expect(cb).toHaveBeenCalledWith("p1", "🔥");
  });

  it("queues second request within guard period", () => {
    const cb = vi.fn();
    const s = createBubbleScheduler(800, cb);
    s.request("p1", "🔥");
    s.request("p1", "💪");
    expect(cb).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(800);
    expect(cb).toHaveBeenCalledWith("p1", "💪");
  });

  it("emits immediately if requests are for different players", () => {
    const cb = vi.fn();
    const s = createBubbleScheduler(800, cb);
    s.request("p1", "🔥");
    s.request("p2", "😅");
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("collapses queued bursts (only keeps the last per player)", () => {
    const cb = vi.fn();
    const s = createBubbleScheduler(800, cb);
    s.request("p1", "🔥");   // emit
    s.request("p1", "💪");   // queue
    s.request("p1", "⚡");   // replace queued
    vi.advanceTimersByTime(800);
    expect(cb).toHaveBeenLastCalledWith("p1", "⚡");
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `bun run test animation-scheduler`
Expected: FAIL

- [ ] **Step 3: 实现 `animation-scheduler.ts`**

```ts
type Emit = (playerId: string, emoji: string) => void;

interface PlayerSlot {
  lastEmitAt: number;
  pendingEmoji: string | null;
  timer: ReturnType<typeof setTimeout> | null;
}

export function createBubbleScheduler(guardMs: number, emit: Emit) {
  const slots = new Map<string, PlayerSlot>();

  function request(playerId: string, emoji: string) {
    const now = Date.now();
    let slot = slots.get(playerId);
    if (!slot) {
      slot = { lastEmitAt: 0, pendingEmoji: null, timer: null };
      slots.set(playerId, slot);
    }
    const wait = slot.lastEmitAt + guardMs - now;
    if (wait <= 0) {
      slot.lastEmitAt = now;
      slot.pendingEmoji = null;
      emit(playerId, emoji);
    } else {
      slot.pendingEmoji = emoji;
      if (slot.timer) clearTimeout(slot.timer);
      slot.timer = setTimeout(() => {
        const cur = slots.get(playerId);
        if (!cur || cur.pendingEmoji == null) return;
        const e = cur.pendingEmoji;
        cur.pendingEmoji = null;
        cur.timer = null;
        cur.lastEmitAt = Date.now();
        emit(playerId, e);
      }, wait);
    }
  }

  function dispose() {
    slots.forEach((s) => s.timer && clearTimeout(s.timer));
    slots.clear();
  }

  return { request, dispose };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `bun run test animation-scheduler`
Expected: PASS（4 项）

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/PixelTable/logic/animation-scheduler.ts apps/web/src/components/PixelTable/__tests__/animation-scheduler.test.ts
git commit -m "feat(pixel-table): animation-scheduler 守卫期 + 排队 + 折叠突发"
```

---

## Task 18: EmojiBubble — 弹出/停留/淡出

**Files:**
- Create: `apps/web/src/components/PixelTable/effects/EmojiBubble.tsx`

- [ ] **Step 1: 实现**

```tsx
"use client";

import { TextStyle, type Graphics } from "pixi.js";
import { useEffect, useState, useCallback } from "react";

interface EmojiBubbleProps {
  emoji: string | null;
  x: number;
  y: number;
}

const STAY_MS = 2000;
const POP_MS = 120;
const FADE_MS = 200;
const STYLE = new TextStyle({ fontFamily: "system-ui", fontSize: 13 });

type Phase = "popIn" | "stay" | "fadeOut" | "hidden";

export function EmojiBubble({ emoji, x, y }: EmojiBubbleProps) {
  const [phase, setPhase] = useState<Phase>("hidden");
  const [scale, setScale] = useState(0);
  const [alpha, setAlpha] = useState(1);
  const [shown, setShown] = useState<string | null>(null);

  useEffect(() => {
    if (!emoji) return;
    setShown(emoji);
    setPhase("popIn");
    const t1 = setTimeout(() => setPhase("stay"), POP_MS);
    const t2 = setTimeout(() => setPhase("fadeOut"), POP_MS + STAY_MS);
    const t3 = setTimeout(() => setPhase("hidden"), POP_MS + STAY_MS + FADE_MS);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [emoji]);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const fromScale = scale;
    const fromAlpha = alpha;
    const tick = (now: number) => {
      const elapsed = now - start;
      if (phase === "popIn") {
        const t = Math.min(1, elapsed / POP_MS);
        setScale(fromScale + (1 - fromScale) * t);
      } else if (phase === "fadeOut") {
        const t = Math.min(1, elapsed / FADE_MS);
        setAlpha(fromAlpha * (1 - t));
      } else if (phase === "stay") {
        setScale(1); setAlpha(1);
      } else if (phase === "hidden") {
        setScale(0); setAlpha(1); setShown(null);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  const drawBg = useCallback((g: Graphics) => {
    g.clear();
    g.roundRect(-12, -10, 24, 20, 6).fill(0xffffff).stroke({ color: 0x333, width: 1 });
  }, []);

  if (!shown || phase === "hidden") return null;

  return (
    <pixiContainer x={x} y={y} scale={{ x: scale, y: scale }} alpha={alpha}>
      <pixiGraphics draw={drawBg} />
      <pixiText text={shown} anchor={0.5} style={STYLE} />
    </pixiContainer>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/PixelTable/effects/EmojiBubble.tsx
git commit -m "feat(pixel-table): EmojiBubble pop-in/stay/fade-out 动画"
```

---

## Task 19: EmojiBubble 接入 Seat（决策触发 + idle 概率）

**Files:**
- Modify: `apps/web/src/components/PixelTable/PixelTableView.tsx`
- Modify: `apps/web/src/components/PixelTable/stage/Seat.tsx`

- [ ] **Step 1: 在 `PixelTableView.tsx` 维护一个 `playerId → currentEmoji` 的 state**

```tsx
// 顶部 imports 添加
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createBubbleScheduler } from "./logic/animation-scheduler";
import { pickEmoji, type EmojiKind } from "./logic/emoji-pool";

// 在组件内（state 上方追加）：
const [bubbles, setBubbles] = useState<Record<string, string>>({});
const recentRef = useRef<Record<string, string[]>>({});
const lastEventIndexRef = useRef(-1);
const schedulerRef = useRef<ReturnType<typeof createBubbleScheduler> | null>(null);

useEffect(() => {
  schedulerRef.current = createBubbleScheduler(800, (pid, emoji) => {
    setBubbles((b) => ({ ...b, [pid]: emoji }));
    setTimeout(() => setBubbles((b) => {
      if (b[pid] !== emoji) return b;
      const { [pid]: _, ...rest } = b;
      return rest;
    }), 2400);
  });
  return () => schedulerRef.current?.dispose();
}, []);

// 监听 events 增量，将新 action-taken 喂给 scheduler
useEffect(() => {
  const sched = schedulerRef.current;
  if (!sched) return;
  for (let i = lastEventIndexRef.current + 1; i < events.length; i++) {
    const e = events[i];
    if (e.type === "action-taken") {
      const kind = mapActionToKind(e);
      const recent = recentRef.current[e.playerId] ?? [];
      const emoji = pickEmoji({ kind }, recent);
      if (emoji) {
        recentRef.current[e.playerId] = [emoji, ...recent].slice(0, 3);
        sched.request(e.playerId, emoji);
      }
    } else if (e.type === "hand-complete") {
      e.winners.forEach((w) => {
        const recent = recentRef.current[w.playerId] ?? [];
        const emoji = pickEmoji({ kind: "win" }, recent);
        if (emoji) {
          recentRef.current[w.playerId] = [emoji, ...recent].slice(0, 3);
          sched.request(w.playerId, emoji);
        }
      });
    }
  }
  lastEventIndexRef.current = events.length - 1;
}, [events]);

// idle 概率 — 每 8 秒为活跃玩家随机抽 emoji
useEffect(() => {
  const interval = setInterval(() => {
    const sched = schedulerRef.current;
    if (!sched) return;
    state.seats.forEach((s) => {
      if (s.status !== "active" && s.status !== "thinking") return;
      const recent = recentRef.current[s.playerId] ?? [];
      const emoji = pickEmoji({ kind: "idle" }, recent);
      if (emoji) {
        recentRef.current[s.playerId] = [emoji, ...recent].slice(0, 3);
        sched.request(s.playerId, emoji);
      }
    });
  }, 8000);
  return () => clearInterval(interval);
}, [state.seats]);

function mapActionToKind(e: Extract<GameEvent, { type: "action-taken" }>): EmojiKind {
  if (e.action.type === "fold") return "fold";
  if (e.action.type === "check") return "check";
  if (e.action.type === "call") return "call";
  if (e.allIn) return "all-in";
  return "raise";
}

// 把 bubbles 传给 Seat：
{placedSeats.map(({ seat, pos }) => (
  <Seat key={seat.playerId} seat={seat} x={pos.x} y={pos.y} bubble={bubbles[seat.playerId] ?? null} />
))}
```

- [ ] **Step 2: 修改 `Seat.tsx` 接受 bubble prop 并渲染 EmojiBubble**

```tsx
import { EmojiBubble } from "../effects/EmojiBubble";

interface SeatProps {
  seat: SeatState;
  x: number;
  y: number;
  bubble: string | null;
}

export function Seat({ seat, x, y, bubble }: SeatProps) {
  const dim = seat.status === "folded" || seat.status === "out";
  return (
    <pixiContainer x={x} y={y}>
      <EmojiBubble emoji={bubble} x={0} y={-AVATAR_SIZE / 2 - 30} />
      <BetIndicator amount={seat.currentBet} x={0} y={-AVATAR_SIZE / 2 - 16} />
      <ThinkingHalo active={seat.status === "thinking"} radius={AVATAR_SIZE / 2} />
      <Avatar emoji={seat.avatar || "🤖"} status={seat.status} x={0} y={0} size={AVATAR_SIZE} />
      <HoleCards cards={seat.holeCards} x={0} y={AVATAR_SIZE / 2 + 12} dim={dim} />
      <ChipsLabel name={seat.name} chips={seat.chips} x={0} y={AVATAR_SIZE / 2 + 24} dim={dim} />
    </pixiContainer>
  );
}
```

- [ ] **Step 3: 启动 dev 验证**

牌桌应能看到：每次决策头顶弹出 emoji 气泡（持续 2 秒），idle 时偶尔随机情绪 emoji。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/PixelTable/PixelTableView.tsx apps/web/src/components/PixelTable/stage/Seat.tsx
git commit -m "feat(pixel-table): emoji 气泡接入 — 决策触发 + idle 30% 概率"
```

---

## Task 20: TurnCard 静态渲染 + Typewriter 子组件

**Files:**
- Create: `apps/web/src/components/TurnCard/Typewriter.tsx`
- Create: `apps/web/src/components/TurnCard/index.tsx`
- Create: `apps/web/src/components/TurnCard/__tests__/Typewriter.test.tsx`
- Modify: `apps/web/src/components/PixelTable/PixelTableView.tsx`（在底部添加 TurnCard）

- [ ] **Step 1: 写 Typewriter 测试**

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { Typewriter } from "../Typewriter";

describe("Typewriter", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("renders an empty string initially when text is empty", () => {
    render(<Typewriter text="" cps={30} />);
    expect(screen.getByTestId("typewriter").textContent).toBe("");
  });

  it("reveals characters at given cps", () => {
    render(<Typewriter text="hello" cps={30} />);
    act(() => { vi.advanceTimersByTime(34 * 5); });  // 1000/30 ≈ 33.3ms × 5
    expect(screen.getByTestId("typewriter").textContent?.length).toBeGreaterThanOrEqual(4);
  });

  it("eventually reveals the full text", () => {
    render(<Typewriter text="hello" cps={30} />);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByTestId("typewriter").textContent).toBe("hello");
  });

  it("resets when text changes", () => {
    const { rerender } = render(<Typewriter text="aaaa" cps={30} />);
    act(() => { vi.advanceTimersByTime(2000); });
    rerender(<Typewriter text="bbb" cps={30} />);
    expect(screen.getByTestId("typewriter").textContent).toBe("");
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `bun run test Typewriter`
Expected: FAIL

- [ ] **Step 3: 实现 `Typewriter.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";

interface TypewriterProps {
  text: string;
  cps?: number;        // chars per second
  className?: string;
}

export function Typewriter({ text, cps = 30, className }: TypewriterProps) {
  const [shown, setShown] = useState("");

  useEffect(() => {
    setShown("");
    if (!text) return;
    const intervalMs = 1000 / cps;
    let i = 0;
    const t = setInterval(() => {
      i++;
      setShown(text.slice(0, i));
      if (i >= text.length) clearInterval(t);
    }, intervalMs);
    return () => clearInterval(t);
  }, [text, cps]);

  return <span data-testid="typewriter" className={className}>{shown}</span>;
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `bun run test Typewriter`
Expected: PASS

- [ ] **Step 5: 实现 `TurnCard/index.tsx`**

```tsx
"use client";

import type { SeatState } from "../PixelTable/logic/types";
import { Typewriter } from "./Typewriter";
import { useLanguage } from "@/contexts/LanguageContext";

interface TurnCardProps {
  seat: SeatState | null;
  handIndex: number;          // 当前查看第几手（0 = 最新）
  totalHands: number;
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
}

function actionLabel(seat: SeatState): { text: string; color: string } | null {
  const d = seat.lastDecision;
  if (!d) return null;
  if (d.action === "fold") return { text: "FOLD", color: "text-text-secondary" };
  if (d.action === "check") return { text: "CHECK", color: "text-text-primary" };
  if (d.action === "call") return { text: `CALL $${d.amount?.toLocaleString() ?? 0}`, color: "text-blue-600" };
  return { text: `RAISE $${d.amount?.toLocaleString() ?? 0}`, color: "text-amber-700" };
}

export function TurnCard({ seat, handIndex, totalHands, onPrev, onNext, canPrev, canNext }: TurnCardProps) {
  const { t } = useLanguage();
  return (
    <div className="absolute left-0 right-0 bottom-3 px-2 flex items-center gap-1.5">
      <button
        onClick={onPrev}
        disabled={!canPrev}
        className={`w-7 h-[88px] rounded-lg flex items-center justify-center text-lg flex-shrink-0 ${canPrev ? "bg-white/85 text-text-secondary" : "bg-white/55 text-text-tertiary cursor-not-allowed"}`}
      >‹</button>

      <div className="flex-1 bg-white/95 backdrop-blur-md rounded-2xl px-3 py-2.5 shadow-lg border border-black/5 min-w-0">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[10px] text-text-secondary font-mono">#{seat?.lastDecision?.handNumber ?? "—"}</span>
          {handIndex === 0 ? (
            <span className="text-[9px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded border border-amber-200">⬤ {t("turnCard.current")}</span>
          ) : (
            <span className="text-[9px] bg-gray-100 text-text-secondary px-1.5 py-0.5 rounded">{t("turnCard.history")}</span>
          )}
          <span className="ml-auto text-[9px] text-text-secondary font-mono">{handIndex + 1} / {Math.max(1, totalHands)}</span>
        </div>
        {seat ? (
          <div className="flex items-start gap-2">
            <div className="w-8 h-8 rounded-full bg-amber-100 border-2 border-amber-300 flex-shrink-0 flex items-center justify-center text-sm">
              {seat.avatar || "🤖"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold mb-0.5">{seat.name}</div>
              <div className="text-[10px] text-text-secondary leading-snug mb-1 line-clamp-2">
                <Typewriter text={seat.lastDecision?.thought?.message ?? ""} cps={30} />
              </div>
              {actionLabel(seat) && (
                <div className={`inline-flex items-center gap-1 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 ${actionLabel(seat)!.color} text-[10px] font-semibold`}>
                  {actionLabel(seat)!.text}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-text-secondary text-center py-4">{t("turnCard.waiting")}</div>
        )}
      </div>

      <button
        onClick={onNext}
        disabled={!canNext}
        className={`w-7 h-[88px] rounded-lg flex items-center justify-center text-lg flex-shrink-0 ${canNext ? "bg-white/85 text-text-secondary" : "bg-white/55 text-text-tertiary cursor-not-allowed"}`}
      >›</button>
    </div>
  );
}
```

- [ ] **Step 6: i18n 字符串**

zh.json：
```json
"turnCard.current": "当前",
"turnCard.history": "历史",
"turnCard.waiting": "等待出牌..."
```
en.json：
```json
"turnCard.current": "Current",
"turnCard.history": "History",
"turnCard.waiting": "Waiting for action..."
```

- [ ] **Step 7: 在 `PixelTableView.tsx` 渲染 TurnCard（先固定为最新手，下个 Task 加历史回看）**

```tsx
import { TurnCard } from "../TurnCard";

// 在 return 的 div 内 PixiStage 后追加：
const latestSeat = state.seats.find((s) => s.lastDecision);
<TurnCard
  seat={latestSeat ?? null}
  handIndex={0}
  totalHands={1}
  onPrev={() => {}}
  onNext={() => {}}
  canPrev={false}
  canNext={false}
/>
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/TurnCard apps/web/src/components/PixelTable/PixelTableView.tsx apps/web/src/locales/zh.json apps/web/src/locales/en.json
git commit -m "feat(pixel-table): TurnCard 静态渲染 + Typewriter 30 字/秒"
```

---

## Task 21: TurnCard 历史回看左右箭头

**Files:**
- Modify: `apps/web/src/components/PixelTable/PixelTableView.tsx`

- [ ] **Step 1: 提取所有"action-taken"的座位快照（按时间倒序），实现箭头切换**

在 `PixelTableView.tsx` 顶层 imports 处：

```tsx
import type { SeatState } from "./logic/types";

// 工具：从 events 中提取每一个决策点对应的 seat 快照（最近 50 个）
function extractDecisionHistory(events: GameEvent[]): SeatState[] {
  const history: SeatState[] = [];
  // 我们需要逐步重放并捕获每个 action-taken 后的对应 seat 状态
  // 简化做法：对每个 action-taken，截取到该索引的 events 子数组重新计算
  for (let i = events.length - 1; i >= 0 && history.length < 50; i--) {
    const e = events[i];
    if (e.type !== "action-taken") continue;
    const sub = events.slice(0, i + 1);
    const s = eventsToTableState(sub);
    const seat = s.seats.find((x) => x.playerId === e.playerId);
    if (seat) history.push(seat);
  }
  return history;  // index 0 = 最新决策
}
```

> 性能提示：快照数量上限 50，避免历史过长导致 O(n²) 雪崩。

在组件中替换 TurnCard 渲染逻辑：

```tsx
const history = useMemo(() => extractDecisionHistory(events), [events]);
const [handIndex, setHandIndex] = useState(0);

useEffect(() => { setHandIndex(0); }, [events.length]);  // 新事件来了自动跳回最新

const currentSeat = history[handIndex] ?? null;

<TurnCard
  seat={currentSeat}
  handIndex={handIndex}
  totalHands={Math.max(1, history.length)}
  onPrev={() => setHandIndex((i) => Math.min(i + 1, history.length - 1))}
  onNext={() => setHandIndex((i) => Math.max(0, i - 1))}
  canPrev={handIndex < history.length - 1}
  canNext={handIndex > 0}
/>
```

- [ ] **Step 2: dev 验证**

进入牌桌打几手 → 点 ‹ 回看历史决策卡片，点 › 回到最新。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/PixelTable/PixelTableView.tsx
git commit -m "feat(pixel-table): TurnCard 左右箭头历史回看（最近 50 个决策）"
```

---

## Task 22: AllInFire 粒子特效

**Files:**
- Create: `apps/web/src/components/PixelTable/effects/AllInFire.tsx`
- Modify: `apps/web/src/components/PixelTable/stage/Seat.tsx`

- [ ] **Step 1: 实现 `AllInFire.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { type Graphics } from "pixi.js";

interface AllInFireProps {
  active: boolean;     // 在 1.5s 内 true
  radius: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;        // 0..1
  size: number;
}

const PARTICLE_COUNT = 30;
const LIFE_MS = 1500;

export function AllInFire({ active, radius }: AllInFireProps) {
  const [particles, setParticles] = useState<Particle[]>([]);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!active) {
      startedRef.current = false;
      setParticles([]);
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;

    const seed: Particle[] = Array.from({ length: PARTICLE_COUNT }, () => ({
      x: (Math.random() - 0.5) * radius * 1.4,
      y: (Math.random() - 0.5) * 4,
      vx: (Math.random() - 0.5) * 0.4,
      vy: -0.6 - Math.random() * 0.8,
      life: 0,
      size: 2 + Math.random() * 3,
    }));
    setParticles(seed);

    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = (now - start) / LIFE_MS;
      if (t >= 1) {
        setParticles([]);
        return;
      }
      setParticles((prev) =>
        prev.map((p) => ({
          ...p,
          x: p.x + p.vx,
          y: p.y + p.vy,
          life: t,
        })),
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, radius]);

  const draw = useCallback((g: Graphics) => {
    g.clear();
    particles.forEach((p) => {
      const alpha = 1 - p.life;
      const r = (p.life < 0.3) ? 0xffaa00 : (p.life < 0.7 ? 0xff5520 : 0x442222);
      g.circle(p.x, p.y, p.size * (1 - p.life * 0.5)).fill({ color: r, alpha });
    });
  }, [particles]);

  if (!active && particles.length === 0) return null;
  return <pixiGraphics draw={draw} />;
}
```

- [ ] **Step 2: 在 `Seat.tsx` 加入**

```tsx
import { AllInFire } from "../effects/AllInFire";

// 在 EmojiBubble 之前：
<AllInFire active={seat.status === "all-in"} radius={AVATAR_SIZE / 2} />
```

- [ ] **Step 3: dev 验证（all-in 牌局触发 → 角色周围冒火）**

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/PixelTable/effects/AllInFire.tsx apps/web/src/components/PixelTable/stage/Seat.tsx
git commit -m "feat(pixel-table): AllInFire 火焰粒子（30 颗 / 1.5s）"
```

---

## Task 23: PotDisplay All-in 红光闪烁

> Task 8 已实现 `flash` prop；Task 12 已传 `isAllInFlashing(state.allInFlashAt)`。本任务确认 + 完善：闪烁要有 3 次脉冲而不是单次。

**Files:**
- Modify: `apps/web/src/components/PixelTable/stage/PotDisplay.tsx`

- [ ] **Step 1: 改为多次脉冲**

```tsx
"use client";

import { TextStyle, type Graphics } from "pixi.js";
import { useEffect, useState, useCallback } from "react";

interface PotDisplayProps {
  amount: number;
  x: number;
  y: number;
  flash?: boolean;
}

const POT_STYLE = new TextStyle({
  fontFamily: "ui-monospace, SFMono-Regular, monospace",
  fontSize: 13,
  fontWeight: "600",
  fill: 0xffd700,
});

export function PotDisplay({ amount, x, y, flash = false }: PotDisplayProps) {
  const [t, setT] = useState(0);

  useEffect(() => {
    if (!flash) { setT(0); return; }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const elapsed = (now - start) / 1500;
      if (elapsed >= 1) { setT(0); return; }
      setT(elapsed);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [flash]);

  // 3 次脉冲：sin(t * 6π) 余弦波 → -1..1，取绝对值得到 3 次峰
  const pulse = flash ? Math.abs(Math.sin(t * Math.PI * 3)) : 0;

  const text = `💰 POT $${amount.toLocaleString()}`;
  const draw = useCallback((g: Graphics) => {
    g.clear();
    const bgColor = pulse > 0 ? 0xff3355 : 0x000000;
    const alpha = 0.7 + 0.2 * pulse;
    g.roundRect(-60, -12, 120, 24, 12).fill({ color: bgColor, alpha });
  }, [pulse]);

  return (
    <pixiContainer x={x} y={y}>
      <pixiGraphics draw={draw} />
      <pixiText text={text} anchor={0.5} style={POT_STYLE} />
    </pixiContainer>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/PixelTable/stage/PotDisplay.tsx
git commit -m "feat(pixel-table): PotDisplay All-in 触发 3 次红光脉冲"
```

---

## Task 24: WinCelebration — 冠光 + 金币粒子

**Files:**
- Create: `apps/web/src/components/PixelTable/effects/WinCelebration.tsx`
- Modify: `apps/web/src/components/PixelTable/stage/Seat.tsx`
- Modify: `apps/web/src/components/PixelTable/PixelTableView.tsx`（透传 isWinner）

- [ ] **Step 1: 实现 `WinCelebration.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { type Graphics } from "pixi.js";

interface WinCelebrationProps {
  active: boolean;
  radius: number;
}

interface Coin {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

const COUNT = 30;
const LIFE_MS = 1500;

export function WinCelebration({ active, radius }: WinCelebrationProps) {
  const [coins, setCoins] = useState<Coin[]>([]);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!active) {
      startedRef.current = false;
      setCoins([]);
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;

    const seed: Coin[] = Array.from({ length: COUNT }, () => ({
      x: (Math.random() - 0.5) * radius,
      y: 0,
      vx: (Math.random() - 0.5) * 1.2,
      vy: -2 - Math.random() * 1.5,
      life: 0,
    }));
    setCoins(seed);

    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = (now - start) / LIFE_MS;
      if (t >= 1) { setCoins([]); return; }
      setCoins((prev) =>
        prev.map((c) => ({
          ...c,
          x: c.x + c.vx,
          y: c.y + c.vy + 0.06 * (now - start),  // 重力
          life: t,
        })),
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, radius]);

  const draw = useCallback((g: Graphics) => {
    g.clear();
    // 冠光环
    if (active) {
      g.circle(0, -radius - 8, 4).fill({ color: 0xffd700, alpha: 0.9 });
      g.poly([
        -8, -radius - 4,
        -4, -radius - 14,
        0,  -radius - 6,
        4,  -radius - 14,
        8,  -radius - 4,
      ]).fill({ color: 0xffd700, alpha: 0.9 });
    }
    // 金币
    coins.forEach((c) => {
      const alpha = 1 - c.life;
      g.circle(c.x, c.y, 2).fill({ color: 0xffd700, alpha });
    });
  }, [active, coins, radius]);

  if (!active && coins.length === 0) return null;
  return <pixiGraphics draw={draw} />;
}
```

- [ ] **Step 2: `PixelTableView.tsx` 计算每位是否赢家并传给 Seat**

在 placedSeats 渲染处：

```tsx
const winnerIds = new Set(state.winners.map((w) => w.playerId));

{placedSeats.map(({ seat, pos }) => (
  <Seat
    key={seat.playerId}
    seat={seat}
    x={pos.x}
    y={pos.y}
    bubble={bubbles[seat.playerId] ?? null}
    isWinner={winnerIds.has(seat.playerId)}
  />
))}
```

- [ ] **Step 3: `Seat.tsx` 加 isWinner prop**

```tsx
import { WinCelebration } from "../effects/WinCelebration";

interface SeatProps {
  seat: SeatState;
  x: number;
  y: number;
  bubble: string | null;
  isWinner: boolean;
}

export function Seat({ seat, x, y, bubble, isWinner }: SeatProps) {
  const dim = seat.status === "folded" || seat.status === "out";
  return (
    <pixiContainer x={x} y={y}>
      <WinCelebration active={isWinner} radius={AVATAR_SIZE / 2} />
      <AllInFire active={seat.status === "all-in"} radius={AVATAR_SIZE / 2} />
      <EmojiBubble emoji={bubble} x={0} y={-AVATAR_SIZE / 2 - 30} />
      <BetIndicator amount={seat.currentBet} x={0} y={-AVATAR_SIZE / 2 - 16} />
      <ThinkingHalo active={seat.status === "thinking"} radius={AVATAR_SIZE / 2} />
      <Avatar emoji={seat.avatar || "🤖"} status={seat.status} x={0} y={0} size={AVATAR_SIZE} />
      <HoleCards cards={seat.holeCards} x={0} y={AVATAR_SIZE / 2 + 12} dim={dim} />
      <ChipsLabel name={seat.name} chips={seat.chips} x={0} y={AVATAR_SIZE / 2 + 24} dim={dim} />
    </pixiContainer>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/PixelTable/effects/WinCelebration.tsx apps/web/src/components/PixelTable/stage/Seat.tsx apps/web/src/components/PixelTable/PixelTableView.tsx
git commit -m "feat(pixel-table): WinCelebration 赢家冠光 + 金币粒子"
```

---

## Task 25: i18n 字符串补全

**Files:**
- Modify: `apps/web/src/locales/zh.json`
- Modify: `apps/web/src/locales/en.json`

- [ ] **Step 1: 检查所有引用的 i18n key 都已定义**

需要验证存在的 keys：
- `tableView.highlights` `tableView.leaderboard`（Task 11 已用）
- `tableView.subLive` `tableView.subText`（Task 11 已加）
- `turnCard.current` `turnCard.history` `turnCard.waiting`（Task 20 已加）

Run:
```bash
cd "/Users/mi/Claude Code/CyberCasino/apps/web"
grep -E '"(tableView\.highlights|tableView\.leaderboard)":' src/locales/zh.json src/locales/en.json
```

如果两个文件都包含，跳过；否则补齐：

zh.json 追加（仅缺时）：
```json
"tableView.highlights": "精彩集锦",
"tableView.leaderboard": "排行榜",
```
en.json 追加：
```json
"tableView.highlights": "Highlights",
"tableView.leaderboard": "Leaderboard",
```

- [ ] **Step 2: 运行编译检查**

Run: `cd "/Users/mi/Claude Code/CyberCasino" && bun run --filter @cybercasino/web lint`

- [ ] **Step 3: Commit（仅当有改动）**

```bash
git add apps/web/src/locales/zh.json apps/web/src/locales/en.json
git commit -m "i18n(pixel-table): 补齐 tableView/turnCard 中英字符串"
```

---

## Task 26: 移动端 / iPad / 桌面三档断点验证

**Files:**
- 无修改（验证任务）

- [ ] **Step 1: 启动 dev**

```bash
cd "/Users/mi/Claude Code/CyberCasino"
bun run --filter @cybercasino/web dev
```

- [ ] **Step 2: 用浏览器开发者工具切换到 iPhone 14 Pro（390×844）尺寸**

进入一个进行中的牌桌，二级 tab 切到"实况"，验证清单：
- [ ] 6 个座位无重叠，全在 Canvas 内
- [ ] 头像旁/下方手牌可读（窄屏自适应：手牌应在头像下方，不溢出）
- [ ] 公共牌、底池、TurnCard 不互相遮挡
- [ ] TurnCard 左右箭头可点
- [ ] 决策时头顶 emoji 气泡正常弹出 + 消失
- [ ] All-in 时角色周围有火焰粒子
- [ ] 思考者头像有金色脉冲

- [ ] **Step 3: 切换到 iPad Air（820×1180）**

- [ ] 桌子按比例放大，仍居中
- [ ] 文字不模糊（resolution=devicePixelRatio）

- [ ] **Step 4: 切换到桌面（1280×900 视窗）**

- [ ] 桌子被限制在最大 rx/ry，不会拉伸到全屏
- [ ] Canvas 居中，左右留白

- [ ] **Step 5: 历史回放页验证**

进 lobby → 点击一个已结束的牌桌 → 同样验证实况 tab 渲染历史快照。

- [ ] **Step 6: 性能验证**

Chrome DevTools → Performance Insights → 录制 30 秒：
- [ ] 平均 FPS ≥ 50
- [ ] 无明显帧抖（红色长帧）

- [ ] **Step 7: 写一个简短的 QA notes 提交（无代码改动则跳过 commit）**

如果发现问题：分别修复并 commit `fix(pixel-table): ...`，每个修复独立 commit。

---

## 完成后续

当 Task 1-26 全部 ✅，按 spec § 12 进入：
- **M6**：用真实美术资产替换占位 sprite（Kenney 牌 + LimeZu 角色 + Free Game Assets 赛博 overlay + DoDoCat UI + Zpix 字体）。下载、打包成 atlas、替换。**这是一份独立计划**，不在本文件范围。
- **音效（v2 候选）**：`AudioContext` 程序化筹码声、心跳、胜利音阶。

---

## Self-Review Notes

**Spec 覆盖检查**：
- § 3 布局 → Task 11（双层 Tab）+ Task 7（座位坐标）+ Task 12（容器装配）✅
- § 4 视觉风格 → Task 8（低饱和绿桌面）+ Task 11（保留 iOS 风 UI 容器）+ Task 18（emoji 系统色）✅
- § 5.1 角色显示模式 → Task 10（IDLE/Avatar）+ Task 14（THINKING）+ Task 22（ALL-IN）+ Task 15（FOLDED/OUT）+ Task 24（WIN）✅
- § 5.2 emoji 池 → Task 16 ✅
- § 5.3 桌面特效 → Task 23（All-in 红光）+ Task 13（数字滚动）+ Task 9（公共牌 flip）✅
- § 6 底部卡片 → Task 20（打字机）+ Task 21（左右箭头）✅
- § 7.3 历史回放 → Task 12（PixelTableView 接 events 即可，无需额外）✅
- § 8 PixiJS 架构 → Task 2 ✅
- § 9 与现有代码集成 → Task 11 ✅
- § 10 美术 → 占位 sprite 跑通，M6 替换（独立计划）✅
- § 11 实现期约束（atlas / 整数缩放 / NEAREST）→ M6 美术替换时再加，本计划占位 sprite 不需要✅

**类型一致性**：`SeatState` / `PixelTableState` / `EmojiKind` 在所有任务中一致。

**Placeholder 扫描**：本计划无 TBD / TODO / "implement later"。
