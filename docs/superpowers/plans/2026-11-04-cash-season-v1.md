# CyberCasino 现金桌赛季 v1 改进计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把公共竞技主循环从「凑满 6 人的 SNG」改成持续现金桌，并用 14 天赛季的 bb/100 排名，让用户到来就能入座，预置 Agent 不再被整场淘汰赛锁死。

**Architecture:** 手牌引擎继续只负责一手牌，进行中的桌上筹码以引擎为准。赛季账是两手之间的镜像，只覆盖结果，不另行累加输赢。买入、封顶和兑现在同一步里同时改钱包和引擎筹码。现有 `ranked-default` 队列不再按 6 人成批开赛，只保留等待名单。公开排行榜改读赛季账本；旧的完赛名次榜留在单独的历史字段里。

**Tech Stack:** 现有 Bun 服务、`packages/engine` 单手循环、`packages/shared` 类型、Socket.IO、外部 Agent WebSocket、Postgres 或本地 JSON 历史存储。

## Global Constraints

- 公共主循环是现金桌：固定盲注 50/100，买入 5,000，桌上筹码上限 15,000，2 到 6 人。
- 赛季 14 天。每个 Agent 的赛季钱包起点是 20,000。买入、离桌、封顶划转和重买只在钱包与桌上筹码之间移动，不另造筹码。
- 公开排名是 bb/100。计入排名至少 500 手。只有桌上至少有一名用户 Agent 的手牌才计入。
- 预置 Agent 仍是六个正式身体，每个同时只坐一桌。有用户等待时，在下一手开始前让座。
- 一个用户同时只有一个在座 Agent。
- 先补满已有牌桌的空位，再替换预置座位；只有无法在已有牌桌入座、且能凑满 2 人时才开新桌。
- 无人排队时，空闲预置 Agent 可以坐一张供旁观的现金桌。旁观桌使用桌内筹码，散桌或有用户加入时这些筹码作废，不写入赛季账。
- 断线仍不等于离桌。行动截止时间不因重连重置。外部 Agent 断线继续走现有 fallback。
- 策略版本在每手开始时锁定，待生效版本在下一手生效。
- 思考、解说、直播牌桌和公开回放继续可用。弃牌玩家的底牌仍不公开。
- 不做支付、Pro、私赛、奖金、复杂 Elo，也不把 SNG 做回入座方式。
- 赛季账只在两手之间保存。进程重启时放弃未完成的手牌，桌上筹码恢复到这手开始前，再兑现回钱包。不恢复半手牌，也不把底池单独退还。
- 赛季账本必须能跨重启保留。同一赛季只有一个写入者。队列和牌桌席位仍可以是进程内状态。
- 公开榜读取最近一次两手之间的快照。进行中的底池不计入权益。
- 新赛季从空榜开始。换季时先兑现并冻结旧榜，再发放新的 20,000，不把旧权益加进新钱包。旧的完赛名次榜保留为历史，不和 bb/100 混排。
- 本计划全部任务完成前，不把现金桌主循环部署到生产。
- 未得到用户要求时不创建 git commit。
- 新源码使用 ASCII。说明文档沿用现有中文文档的语言。

---

## 已确认的产品决定

这些决定来自 2026-11-04 的讨论，本计划把它们写成可执行规则。

1. 日常主循环朝 Open Poker 的现金桌赛季进化。
2. SNG 和表演赛不再充当入座闸门。升盲淘汰赛以后若要做，是单独的演出，不在本计划。
3. 现金桌解决的是「整场锁座」和「不满 6 人开不了桌」。它不增加预置 Agent 的身体数量。
4. 预置 Agent 必须在有人等候时让座，否则现金桌会把座位坐死。
5. 排名使用最低手数和 bb/100，桌上筹码封顶。不使用「账上加桌上」的原始筹码作为名次，避免赢家复利占榜。

当前本地尚未发布的并发归档修复继续有效，本计划不推翻它。当前本地的「凑满 6 人、表演赛整场结束后把预置 Agent 让给排名赛」会被本计划替换，不再往那个方向加规则。

## 文件边界

| 文件 | 责任 |
|---|---|
| `apps/server/src/cash-seat-policy.ts` | 纯入座计划：空位、让座、开新桌、旁观桌 |
| `apps/server/src/season-ledger.ts` | 纯赛季数学：买入、封顶、兑现、bb/100、换季窗口 |
| `apps/server/src/season-store.ts` | 赛季账本的保存、读取和重启退码 |
| `apps/server/src/table-instance.ts` | 现金桌两手之间的结算顺序；不再因一人输光结束整桌 |
| `apps/server/src/table-manager.ts` | 按入座计划摆座位，停止创建 SNG 表演赛 |
| `apps/server/src/matchmaking-service.ts` | 等待名单，不再以 6 人为一批领取 |
| `packages/shared/src/types.ts` | 现金桌模式、赛季状态、`session_result` |
| `apps/server/src/index.ts` | 公开排行榜改读赛季账本 |
| `apps/server/src/test-utils/reference-agent-client.ts` | 参考 Agent 能一直打，并消费离座结果 |
| `apps/web/src/components/Lobby.tsx` | 展示 2 到 6 人的现金桌和赛季成绩 |

`packages/engine` 的单手发牌、底池和行动合法性不动。

## 筹码不变量

进行中的一手牌只有一个筹码权威：引擎里的桌上筹码。底池里的筹码已经离开个人筹码，还没有回到赢家手里。赛季账在这一手结束前保持这手开始时的快照。

一手正常结束后，用引擎给出的最终筹码覆盖赛季账的 `tableStack`。覆盖不是累加。`apps/server/src/table-instance.ts` 里现有的三处 `startingChips` 赋值不能用于现金桌：开桌循环约 530 行、快照缺省约 252 行、名单快照约 344 行。现金桌的新筹码只来自 `buyIn` 的返回值。

同一手的持久化键是 `seasonId + tableId + handNumber`。相同键再次写入时，最终筹码必须和第一次相同，权益不变。筹码不同则拒绝这次写入。

每个 Agent 同时只能有一笔大于 0 的 `tableStack`，并且对应唯一的 `tableId`。

全体赛季权益之和在每手计分前后保持不变。权益等于钱包加桌上筹码。旁观桌的桌内筹码不在这个和里。

全下使桌上筹码变为 0，但这一手还没结束。只有手牌结束后筹码仍为 0，才离座。现有循环在有效筹码人数少于 2 时会结束整桌，现金桌不能在一手牌中途走这条路径。

庄位保存为 `seatIndex`。有人离座或入座后，庄位顺时针移到下一个有人的座位，再把这个座位号传给单手循环。禁止用 `agents` 数组下标代替座位号。

## 两手之间的固定顺序

现金桌每手结束后，按这个顺序处理，不能调换：

1. 用引擎的最终筹码覆盖赛季账的桌上筹码，并把这一手计入手数。此时底池已经回到赢家的桌上筹码。
2. 把超过 15,000 的桌上筹码划回钱包，并同步改引擎筹码。
3. 桌上筹码仍为 0 的 Agent 离座，桌上筹码回钱包。这一步才处理输光，不处理手牌中的全下。
4. 刚离座且仍选择留下的 Agent，若钱包至少有 5,000、原桌有空位、并且没有用户正在等待任何座位，才把 5,000 买回原桌。买入同时减少钱包并设置引擎筹码。桌上仍有筹码时拒绝买入。没能买回的留场者排进等待名单末尾，供第 6 步安排，不从竞技场消失。
5. 已经要求离桌的用户在这里兑现。当前手的结果已经在第 1 步进入桌上筹码。主动离桌的人不再买回。
6. 用入座计划安排等待中的用户：先坐空位，没有空位再让预置 Agent 离座。新入座者先从赛季钱包买入。

旁观桌只处理入座和离座，跳过第 1 到第 4 步。坐入第一名用户时，先作废桌内筹码，再从第 6 步起按赛季桌执行。
7. 仍不足 2 人时，剩余 Agent 兑现离桌，桌子关闭。
8. 赛季进入结束前 5 分钟后，不再开始新手牌。当前手打完后全员兑现，冻结 bb/100，然后才发放下一季的 20,000。
9. 按座位号移动庄位。
10. 把两手之间的快照标成「没有进行中的手牌」并保存。下一手开始后不再把中途筹码写入赛季账。
11. 仍然至少 2 人，才开始下一手。

用户主动离桌落在第 5 步：当前手打完，筹码回钱包，座位释放。

## 排名公式

```text
权益 = 钱包 + 桌上筹码
净胜筹码 = 权益 - 20000
bb/100 = 净胜筹码 / 100 / 计入手数 * 100
```

盲注是 100 时，bb/100 的数值等于平均每手净胜筹码。例如 500 手净胜 10,000 筹码，bb/100 是 20。不足 500 手的 Agent 出现在 provisional 列表，没有正式名次。

---

### Task 1: 纯入座计划

**Files:**

- Create: `apps/server/src/cash-seat-policy.ts`
- Test: `apps/server/src/cash-seat-policy.test.ts`

**Interfaces:**

- Consumes: 无
- Produces: `planCashSeats`、`CASH_MIN_PLAYERS = 2`、`CASH_MAX_PLAYERS = 6`

- [x] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from "bun:test";
import { planCashSeats, type CashTableSnapshot, type WaitingAgent } from "./cash-seat-policy";

const user = (agentId: string, enteredAt: number): WaitingAgent => ({
  userId: `user-${agentId}`,
  agentId,
  enteredAt,
  kind: "user",
});

const preset = (agentId: string): WaitingAgent => ({
  userId: `builtin:${agentId}`,
  agentId,
  enteredAt: 0,
  kind: "preset",
});

const table = (id: string, seats: CashTableSnapshot["seats"]): CashTableSnapshot => ({ id, seats });

describe("planCashSeats", () => {
  it("seats a waiting user into the fullest open table", () => {
    const moves = planCashSeats({
      tables: [
        table("short", [{ agentId: "u1", kind: "user", userId: "user-u1" }]),
        table("fuller", [
          { agentId: "u2", kind: "user", userId: "user-u2" },
          { agentId: "p1", kind: "preset" },
        ]),
      ],
      waitingUsers: [user("u3", 10)],
      idlePresets: [],
    });

    const fuller = moves.find((move) => move.tableId === "fuller");
    expect(fuller?.sit.map((agent) => agent.agentId)).toEqual(["u3"]);
    expect(fuller?.standAgentIds).toEqual([]);
  });

  it("replaces one preset when every current seat is taken", () => {
    const moves = planCashSeats({
      tables: [table("main", [
        { agentId: "u1", kind: "user", userId: "user-u1" },
        ...["p1", "p2", "p3", "p4", "p5"].map((agentId) => ({ agentId, kind: "preset" as const })),
      ])],
      waitingUsers: [user("u2", 10)],
      idlePresets: [],
    });

    expect(moves).toEqual([
      expect.objectContaining({
        tableId: "main",
        standAgentIds: ["p1"],
        open: false,
      }),
    ]);
    expect(moves[0].sit.map((agent) => agent.agentId)).toEqual(["u2"]);
  });

  it("opens a new table for a seventh user and an idle preset", () => {
    const moves = planCashSeats({
      tables: [table("full", ["u1", "u2", "u3", "u4", "u5", "u6"].map((agentId) => ({
        agentId,
        kind: "user" as const,
        userId: `user-${agentId}`,
      })))],
      waitingUsers: [user("u7", 10)],
      idlePresets: [preset("p1")],
    });

    expect(moves).toEqual([
      { tableId: "", sit: [user("u7", 10), preset("p1")], standAgentIds: [], open: true },
    ]);
  });

  it("keeps a lone waiting user unseated when nobody can join them", () => {
    expect(planCashSeats({
      tables: [table("full", ["u1", "u2", "u3", "u4", "u5", "u6"].map((agentId) => ({
        agentId,
        kind: "user" as const,
        userId: `user-${agentId}`,
      })))],
      waitingUsers: [user("u7", 10)],
      idlePresets: [],
    })).toEqual([]);
  });

  it("opens one spectator table from idle presets when no user is waiting", () => {
    const moves = planCashSeats({
      tables: [],
      waitingUsers: [],
      idlePresets: ["p1", "p2", "p3", "p4", "p5", "p6"].map(preset),
    });

    expect(moves).toHaveLength(1);
    expect(moves[0].open).toBe(true);
    expect(moves[0].sit.map((agent) => agent.agentId)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);
  });

  it("does not seat a preset that is already at a table", () => {
    const moves = planCashSeats({
      tables: [],
      waitingUsers: [user("u1", 1)],
      idlePresets: [preset("p1"), preset("p1")],
    });

    const seated = moves.flatMap((move) => move.sit.map((agent) => agent.agentId));
    expect(seated).toEqual(["u1", "p1"]);
  });
});
```

- [x] **Step 2: 运行测试并确认失败**

Run: `bun test apps/server/src/cash-seat-policy.test.ts`

Expected: FAIL，模块不存在。

- [x] **Step 3: 实现入座计划**

规则按测试和下面的实现执行。已经在座的 Agent 忽略。等待用户按 `enteredAt` 排序，相同时间再按 `agentId`。有空位时坐入人数最多的桌子。没有空位时，从用户人数最多的桌子上换掉第一个预置 Agent，被换下的预置 Agent 回到空闲名单，可以去新桌。换完仍有人等待，并且等待者加空闲预置 Agent 至少 2 人，才开一张新桌。然后把剩余预置 Agent 补进已有桌子的空位，优先补人数多的桌子。没有任何用户在场或在等，且没有任何桌子时，用至少 2 个空闲预置 Agent 开一张旁观桌，最多 6 人。

```ts
export const CASH_MIN_PLAYERS = 2;
export const CASH_MAX_PLAYERS = 6;

export interface CashSeat {
  agentId: string;
  kind: "user" | "preset";
  userId?: string;
}

export interface CashTableSnapshot {
  id: string;
  seats: CashSeat[];
}

export interface WaitingAgent {
  userId: string;
  agentId: string;
  enteredAt: number;
  kind: "user" | "preset";
}

export interface SeatMove {
  tableId: string;
  sit: WaitingAgent[];
  standAgentIds: string[];
  open: boolean;
}

export function planCashSeats(input: {
  tables: CashTableSnapshot[];
  waitingUsers: WaitingAgent[];
  idlePresets: WaitingAgent[];
}): SeatMove[] {
  const seatedIds = new Set(input.tables.flatMap((table) => table.seats.map((seat) => seat.agentId)));
  const presets: WaitingAgent[] = [];
  for (const preset of input.idlePresets) {
    if (preset.kind !== "preset" || seatedIds.has(preset.agentId)) continue;
    if (presets.some((item) => item.agentId === preset.agentId)) continue;
    presets.push(preset);
  }
  const users = input.waitingUsers
    .filter((agent) => agent.kind === "user" && !seatedIds.has(agent.agentId))
    .sort((a, b) => a.enteredAt - b.enteredAt || a.agentId.localeCompare(b.agentId));

  const tables = input.tables.map((table) => ({
    id: table.id,
    seats: table.seats.map((seat) => ({ ...seat })),
    sit: [] as WaitingAgent[],
    standAgentIds: [] as string[],
  }));
  const moves: SeatMove[] = [];
  const flush = (table: typeof tables[number]) => {
    if (table.sit.length === 0 && table.standAgentIds.length === 0) return;
    moves.push({
      tableId: table.id,
      sit: table.sit.splice(0),
      standAgentIds: table.standAgentIds.splice(0),
      open: false,
    });
  };

  for (const waiting of users) {
    const openSeat = [...tables]
      .sort((a, b) => b.seats.length - a.seats.length)
      .find((table) => table.seats.length < CASH_MAX_PLAYERS);
    if (openSeat) {
      openSeat.seats.push({ agentId: waiting.agentId, kind: "user", userId: waiting.userId });
      openSeat.sit.push(waiting);
      flush(openSeat);
      continue;
    }

    const host = [...tables]
      .sort((a, b) => {
        const count = (table: typeof tables[number]) => table.seats.filter((seat) => seat.kind === "user").length;
        return count(b) - count(a);
      })
      .find((table) => table.seats.some((seat) => seat.kind === "preset"));
    if (!host) continue;
    const index = host.seats.findIndex((seat) => seat.kind === "preset");
    const [standing] = host.seats.splice(index, 1);
    host.standAgentIds.push(standing.agentId);
    presets.unshift({
      userId: `builtin:${standing.agentId}`,
      agentId: standing.agentId,
      enteredAt: 0,
      kind: "preset",
    });
    host.seats.push({ agentId: waiting.agentId, kind: "user", userId: waiting.userId });
    host.sit.push(waiting);
    flush(host);
  }

  const seatedAfter = new Set(tables.flatMap((table) => table.seats.map((seat) => seat.agentId)));
  const unmet = users.filter((agent) => !seatedAfter.has(agent.agentId));
  if (unmet.length > 0 && unmet.length + presets.length >= CASH_MIN_PLAYERS) {
    const sit = [...unmet];
    while (sit.length < CASH_MAX_PLAYERS && presets.length > 0) sit.push(presets.shift()!);
    moves.push({ tableId: "", sit, standAgentIds: [], open: true });
  }

  for (const table of [...tables].sort((a, b) => b.seats.length - a.seats.length)) {
    while (table.seats.length < CASH_MAX_PLAYERS && presets.length > 0) {
      const next = presets.shift()!;
      table.seats.push({ agentId: next.agentId, kind: "preset" });
      table.sit.push(next);
    }
    flush(table);
  }

  const anyUser = tables.some((table) => table.seats.some((seat) => seat.kind === "user")) || unmet.length > 0;
  if (!anyUser && tables.length === 0 && presets.length >= CASH_MIN_PLAYERS) {
    moves.push({
      tableId: "",
      sit: presets.splice(0, CASH_MAX_PLAYERS),
      standAgentIds: [],
      open: false,
    });
    moves[moves.length - 1].open = true;
  }

  return moves;
}
```

旁观桌的 `open` 在推入后设为 `true`，避免和「用户新桌」的对象形状分叉。`sit` 的顺序就是入座顺序。

- [x] **Step 4: 运行测试并确认通过**

Run: `bun test apps/server/src/cash-seat-policy.test.ts`

Expected: PASS。2026-11-04 实际结果：6 pass，0 fail。

### Task 2: 纯赛季账本

**Files:**

- Create: `apps/server/src/season-ledger.ts`
- Test: `apps/server/src/season-ledger.test.ts`

**Interfaces:**

- Consumes: 无
- Produces: `SEASON_STARTING_BANKROLL = 20_000`、`CASH_BUY_IN = 5_000`、`CASH_TABLE_CAP = 15_000`、`CASH_BIG_BLIND = 100`、`SEASON_MIN_HANDS = 500`、`SEASON_LENGTH_MS`、`SEASON_WIND_DOWN_MS = 300_000`、`createSeasonEntry`、`buyIn`、`skim`、`cashOut`、`settleHandStacks`、`bbPer100`、`seasonWindow`、`openNextSeason`

- [x] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from "bun:test";
import {
  bbPer100,
  buyIn,
  cashOut,
  createSeasonEntry,
  settleHandStacks,
  openNextSeason,
  seasonWindow,
  skim,
} from "./season-ledger";

describe("season ledger", () => {
  it("moves a buy-in from bankroll to the table without minting chips", () => {
    const result = buyIn(createSeasonEntry("s1", "hero", "Hero", "user"));
    expect(result).toEqual({
      ok: true,
      entry: expect.objectContaining({ bankroll: 15_000, tableStack: 5_000 }),
    });
  });

  it("refuses a buy-in below 5000 and keeps the original entry", () => {
    const broke = { ...createSeasonEntry("s1", "hero", "Hero", "user"), bankroll: 4_999, tableStack: 0 };
    expect(buyIn(broke)).toEqual({ ok: false, reason: "insufficient_bankroll", entry: broke });
  });

  it("skims the table back to 15000 and keeps total equity", () => {
    const before = { ...createSeasonEntry("s1", "hero", "Hero", "user"), bankroll: 10_000, tableStack: 18_000 };
    const after = skim(before);
    expect(after.bankroll + after.tableStack).toBe(28_000);
    expect(after.tableStack).toBe(15_000);
  });

  it("returns the whole table stack on cash-out", () => {
    const seated = { ...createSeasonEntry("s1", "hero", "Hero", "user"), bankroll: 15_000, tableStack: 7_500 };
    expect(cashOut(seated)).toEqual(expect.objectContaining({ bankroll: 22_500, tableStack: 0 }));
  });

  it("reports 20 bb/100 after winning 10000 chips over 500 counted hands", () => {
    let entry = createSeasonEntry("s1", "hero", "Hero", "user");
    entry = { ...entry, bankroll: 30_000, countedHands: 500 };
    expect(bbPer100(entry)).toBe(20);
  });

  it("withholds a rank before 500 counted hands", () => {
    const entry = { ...createSeasonEntry("s1", "hero", "Hero", "user"), bankroll: 30_000, countedHands: 499 };
    expect(bbPer100(entry)).toBeNull();
  });

  it("replaces the table stack with the engine result instead of adding the win", () => {
    const seated = { ...createSeasonEntry("s1", "hero", "Hero", "user"), bankroll: 15_000, tableStack: 5_000 };
    expect(settleHandStacks(seated, 5_100)).toEqual(expect.objectContaining({
      bankroll: 15_000,
      tableStack: 5_100,
      countedHands: 1,
    }));
  });

  it("refuses a second buy-in while chips remain on the table", () => {
    const seated = { ...createSeasonEntry("s1", "hero", "Hero", "user"), bankroll: 15_000, tableStack: 5_000 };
    expect(buyIn(seated)).toEqual({ ok: false, reason: "already_seated", entry: seated });
  });

  it("opens the wind-down five minutes before the season ends", () => {
    const start = Date.parse("2026-11-04T00:00:00.000Z");
    const season = seasonWindow(start);
    expect(season.endsAt - season.startedAt).toBe(14 * 24 * 60 * 60 * 1000);
    expect(season.windingDown(season.endsAt - 300_000)).toBe(true);
    expect(season.windingDown(season.endsAt - 300_001)).toBe(false);
  });

  it("opens the next season at 20000 after the old equity is frozen", () => {
    const cashedOut = cashOut({
      ...createSeasonEntry("s1", "hero", "Hero", "user"),
      bankroll: 15_000,
      tableStack: 15_000,
      countedHands: 500,
    });
    const next = openNextSeason([cashedOut], Date.parse("2026-11-18T00:00:00.000Z"));
    expect(next.frozen[0]).toEqual(expect.objectContaining({ seasonId: "s1", bankroll: 30_000, countedHands: 500 }));
    expect(next.entries[0]).toEqual(expect.objectContaining({
      bankroll: 20_000,
      tableStack: 0,
      countedHands: 0,
    }));
    expect(next.entries[0].seasonId).not.toBe("s1");
  });
});
```

- [x] **Step 2: 运行测试并确认失败**

Run: `bun test apps/server/src/season-ledger.test.ts`

Expected: FAIL，模块不存在。

- [x] **Step 3: 实现赛季数学**

`createSeasonEntry` 返回 `bankroll: 20_000`、`tableStack: 0`、`countedHands: 0`，并保留传入的 `seasonId`、`agentId`、`displayName` 和 `kind`。`buyIn` 永远返回新结果，不修改入参。钱包不足 5,000 时返回 `{ ok: false, reason: "insufficient_bankroll", entry }`。`tableStack > 0` 时返回 `{ ok: false, reason: "already_seated", entry }`。成功时返回 `{ ok: true, entry }`，钱包减少 5,000，桌上筹码增加 5,000。`skim` 只处理桌上超过 15,000 的部分。`cashOut` 把桌上筹码全部加回钱包。`settleHandStacks(entry, tableStackAfterHand)` 把 `tableStack` 设为引擎结果，钱包不动，`countedHands` 加 1。`bbPer100` 在 `countedHands < 500` 时返回 `null`，否则返回 `(bankroll + tableStack - 20_000) / 100 / countedHands * 100`。`seasonWindow(startedAt)` 的 `endsAt` 是起点加 14 天。`windingDown(now)` 在 `now >= endsAt - 300_000` 时为真。`openNextSeason(settledEntries, startedAt)` 要求每个入参的 `tableStack` 都是 0；它冻结旧权益，并返回一批新的 20,000 起点账本，新钱包不包含旧余额。

这些函数都返回新对象。

- [x] **Step 4: 运行测试并确认通过**

Run: `bun test apps/server/src/season-ledger.test.ts`

Expected: PASS。2026-11-04 实际结果：10 pass，0 fail。与入座测试合跑为 16 pass，0 fail。

### Task 3: 现金桌手牌循环

**Files:**

- Modify: `packages/shared/src/types.ts` 的 `ArenaTableMode`
- Modify: `apps/server/src/table-instance.ts` 约 536 行的手牌循环，以及 `checkEliminations`、`emitTournamentComplete`、`checkBlindLevel`
- Test: `apps/server/src/table-instance` 现有测试旁新增 `apps/server/src/cash-table-loop.test.ts`

**Interfaces:**

- Consumes: `skim`、`cashOut`、`buyIn`、`settleHandStacks`
- Produces: `mode: "cash"` 的桌子在一手结束后才处理输光；`TableInstance.applyBetweenHands(moves)` 只在一手结束后接受离座和入座；庄位是 `seatIndex`

- [x] **Step 1: 写失败测试**

`apps/server/src/cash-table-loop.test.ts` 覆盖四条：

- 脚本化打两手。第一手让一名玩家在手牌结束后筹码为 0。桌子状态仍是 `playing`，该玩家已离座，另一名玩家保留引擎给出的筹码，盲注仍是 50/100，事件流没有 `tournament-complete` 和 `blind-level-up`。
- 一名玩家在翻前全下，桌上筹码变为 0，但摊牌尚未发生。此时该玩家仍在座。摊牌后若筹码仍为 0，才离座。
- 手牌结束后把引擎筹码设为 18,000，两手之间封顶，引擎筹码和赛季账都变为桌上 15,000。钱包增加划出的 3,000。
- 6 号位离座后，原来记在数组下标上的庄位改记为下一个有人的 `seatIndex`，下一手传给单手循环的是这个座位号。

- [x] **Step 2: 运行测试并确认失败**

Run: `bun test apps/server/src/cash-table-loop.test.ts`

Expected: FAIL，现有循环在有效玩家少于 2 人时结束整桌。

- [x] **Step 3: 只改变现金桌循环**

`ArenaTableMode` 增加 `"cash"`。`mode === "cash"` 时：

- 不调用 `checkBlindLevel`。盲注保持配置里的 50/100。
- 手牌进行中，即使有人全下到 0，也不离座，不调用 `emitTournamentComplete`。
- 手牌结束后才按「两手之间的固定顺序」覆盖赛季账、封顶、离座和买入。
- 下一手开始前人数仍少于 2，才兑现剩余玩家并结束这张桌子。连续手牌错误也走兑现关闭，不把现金桌收成一场淘汰赛。
- `ranked` 和 `exhibition` 的旧结束条件先留在代码里，公共入口在 Task 4 停止调用它们。
- 开桌循环、快照缺省和名单快照里的 `startingChips` 不作用于现金桌。新筹码只来自同一步完成的 `buyIn`。已有桌上筹码从 `playerStates` 读取。
- 庄位保存为 `seatIndex`。座位变化后顺时针移到下一个有人的座位。

两手之间的钩子是同步的。它先用引擎最终筹码调用 `settleHandStacks`，再 `skim` 和 `buyIn`。每一次钱包变化都同时写进引擎筹码。

- [x] **Step 4: 运行测试并确认通过**

Run: `bun test apps/server/src/cash-table-loop.test.ts apps/server/src/table-mode.test.ts`

Expected: PASS。2026-11-04 实际结果：现金桌 3 pass，ranked/exhibition 7 pass。

### Task 4: 用等待名单替换六人成批开赛

**Files:**

- Modify: `apps/server/src/matchmaking-service.ts`
- Modify: `apps/server/src/matchmaking-controller.ts`
- Modify: `apps/server/src/table-manager.ts`
- Modify: `apps/server/src/index.ts` 里调用 `ensureShowcaseTable` 和成批开桌的位置
- Test: `apps/server/src/matchmaking-service.test.ts`、`apps/server/src/matchmaking-controller.test.ts`、`apps/server/src/table-manager.test.ts`

**Interfaces:**

- Consumes: `planCashSeats`
- Produces: `MatchmakingService.join` 只把用户放进等待名单。`TableManager.syncCashTables(waiting, idlePresets)` 执行 `SeatMove`。

- [x] **Step 1: 改写失败测试**

把「不足 6 人就等待、满 6 人一次领走」改成下面四条。2026-11-04：四条已落在 `table-manager.test.ts`。`MatchmakingService` 仍按 6 人成批，控制器测试尚未改。

- 一个用户和五个空闲预置 Agent 立即组成一张现金桌。
- 第二个用户在下一手之前替换其中一个预置 Agent，不需要再凑四个人。
- 六个用户已经坐满、没有空闲预置 Agent 时，第七个用户停留在等待名单。
- 没有用户时开一张预置 Agent 现金桌；一旦有用户等待，下一手替换预置 Agent，而不是等整桌结束。

删除或改写要求 `entries.length === 6` 才能创建自动牌桌的断言。

- [ ] **Step 2: 运行测试并确认失败**

Run: `bun test apps/server/src/matchmaking-service.test.ts apps/server/src/table-manager.test.ts`

Expected: FAIL，现有实现仍要求 6 人。

- [ ] **Step 3: 接入入座计划**

`createMatchedTable` 不再要求 6 个 `MatchEntry`。现金桌创建时至少 2 人，最多 6 人。`ensureShowcaseTable` 改为调用同一个 `syncCashTables`：没有用户时它自然产生旁观桌。旁观桌的筹码只存在这张桌子上，不调用 `buyIn`、`settleHandStacks` 或 `SeasonStore.recordHand`。旁观桌散桌时桌内筹码作废。用户加入旁观桌时，桌内筹码作废，留下的 Agent 改为从赛季钱包买入；钱包不足 5,000 的离座。买入后不足 2 人时，按两手之间的关闭规则兑现并关掉这张桌子。预置 Agent 的单桌检查继续使用 `isAgentSeated`。同一 `userId` 或 `agentId` 不能重复等待或重复入座。

`matchmaking:leave` 对已入座用户的含义改为：当前手结束后离桌，筹码回钱包，不存在「下一场自动回队」。控制状态里的 `autoRequeue` 对现金桌表示「输光后若钱包够 5,000 就继续买入」。

- [x] **Step 4: 运行测试并确认通过**

Run: `bun test apps/server/src/table-manager.test.ts apps/server/src/table-mode.test.ts apps/server/src/table-lifecycle.test.ts`

Expected: PASS。2026-11-04 实际结果：上述三份加上现金桌循环，27 pass，0 fail。控制器仍走旧的六人批次。

### Task 5: 持久化赛季，并在重启时退码

**Files:**

- Create: `apps/server/src/season-store.ts`
- Modify: `apps/server/src/stores.ts` 的数据库和 JSON 写入方式
- Test: `apps/server/src/season-store.test.ts`

**Interfaces:**

- Consumes: Task 2 的账本类型、`cashOut`、`settleHandStacks`、`openNextSeason`
- Produces: `SeasonStore.open(now)`、`SeasonStore.recordHand`、`SeasonStore.cashOutAllSeats`、`SeasonStore.restoreAfterRestart`

- [ ] **Step 1: 写失败测试**

`apps/server/src/season-store.test.ts` 和 `apps/server/src/cash-chip-conservation.test.ts` 覆盖这些事实：

- 两个 Agent 各从 20,000 买入 5,000。一手牌把 100 从一人转到另一人后，两人权益之和仍是 40,000。赛季账的桌上筹码等于引擎最终筹码，不是在旧桌上筹码上再加 100。
- 同一 `seasonId + tableId + handNumber` 写入两次后，权益和计入手数与第一次相同。第二次若携带不同的最终筹码，写入被拒绝。
- 一个 Agent 已有大于 0 的桌上筹码时，不能再为另一张桌子写入桌上筹码。
- 手牌开始前保存快照。手牌中途的筹码变化不写入存储。按重启恢复后，桌上筹码回到这手开始前，底池不在任何人的筹码里，然后再兑现回钱包。
- 保存中断后重新打开，两手之间的钱包、桌上筹码和计入手数仍在。
- 旁观桌结束或有用户加入时，不产生赛季账写入。
- 旧赛季兑现后的 30,000 进入冻结记录。新赛季钱包是 20,000，不是 50,000。

- [ ] **Step 2: 运行测试并确认失败**

Run: `bun test apps/server/src/season-store.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 按现有归档的方式保存**

有 Postgres 时，在事务成功之后再替换内存账本，避免沿用已修复的「先复制 Map、后整表覆盖」问题。没有 Postgres 时写入单独的 JSON 文件，不塞进 `game_history`。赛季行至少包含 `seasonId`、`agentId`、`displayName`、`kind`、`bankroll`、`tableStack`、`countedHands`、`tableId`、`startedAt`、`endsAt`。手牌记录的唯一键是 `seasonId + tableId + handNumber`。

只有两手之间、且没有进行中的手牌时才保存桌上筹码。`restoreAfterRestart` 读取这份快照，先把未完成手牌的影响丢掉，再 `cashOut`。不重建半手牌。换季调用 `openNextSeason`，冻结记录和新建账本同一次保存。

- [ ] **Step 4: 运行测试并确认通过**

Run: `bun test apps/server/src/season-store.test.ts apps/server/src/stores.test.ts`

Expected: PASS

### Task 6: 公开榜、大厅和控制台

**Files:**

- Modify: `apps/server/src/index.ts` 约 381 行的排行榜响应
- Modify: `packages/shared/src/types.ts` 的 `MatchmakingState`
- Modify: `apps/web/src/components/Lobby.tsx`
- Modify: `apps/web/src/locales/zh.json`、`apps/web/src/locales/en.json`
- Test: `apps/web/src/components/__tests__/Lobby.test.tsx`，以及服务端排行榜响应测试

**Interfaces:**

- Consumes: `bbPer100`、`SeasonStore`
- Produces: `{ seasonId: string; ranked: SeasonStanding[]; provisional: SeasonStanding[]; legacy: RankedStanding[] }`

`SeasonStanding` 包含 `agentId`、`displayName`、`kind`、`countedHands`、`equity`、`bbPer100`。`ranked` 只含 `bbPer100` 非空的条目，按 bb/100 降序，相同则按计入手数降序。`provisional` 含不足 500 手的条目，不带名次。

- [ ] **Step 1: 写失败测试**

服务端测试构造 500 手和 499 手两个账本，断言前者在 `ranked` 且 bb/100 为预期值，后者只在 `provisional`。大厅测试断言现金桌显示人数和固定盲注 50/100，不再要求凑满 6 人，也不再把预置 Agent 现金桌标成要打完的表演赛。

- [ ] **Step 2: 运行测试并确认失败**

Run: `bun test apps/server/src/season-leaderboard.test.ts`，以及 `bun run test` 在 `apps/web` 中运行 `Lobby.test.tsx`

Expected: FAIL，响应仍是完赛 Elo 列表。

- [ ] **Step 3: 切换公开榜的数据源**

`ranked` 和 `provisional` 只读赛季快照。`legacy` 继续调用 `calculateLeaderboard`，作为换季前的完赛名次，不参与 bb/100 排序。新赛季没有计满 500 手的 Agent 时，`ranked` 为空，`legacy` 仍可显示旧榜。控制台显示钱包、桌上筹码、计入手数、bb/100 或「未满 500 手」，以及在座、等待、赛季筹码不足三种状态。离桌按钮调用现有 `matchmaking:leave`。

- [ ] **Step 4: 运行测试并确认通过**

Run: 上一步的两个测试命令

Expected: PASS

### Task 7: 离座结果和参考 Agent

**Files:**

- Modify: `packages/shared/src/types.ts`
- Modify: `apps/server/src/agents/match-result-message.ts`
- Modify: `apps/server/src/agents/match-result-delivery.ts`
- Modify: `apps/server/src/test-utils/reference-agent-client.ts`
- Modify: `docs/external-agent-protocol-v1.md`
- Test: `apps/server/src/agents/match-result-message.test.ts`、`apps/server/src/test-utils/reference-agent-client.test.ts`

**Interfaces:**

- Consumes: 现金桌离座时的本次入座手数、净胜筹码、该 Agent 自己的底牌
- Produces: `session_result`

```ts
interface SessionResult {
  type: "session_result";
  table_id: string;
  season_id: string;
  started_at: number;
  ended_at: number;
  counted_hands: number;
  sit_equity: number;
  equity: number;
  net_chips: number;
  reason: "left" | "season_broke" | "table_closed" | "season_ended";
  replay: unknown;
}
```

- [ ] **Step 1: 写失败测试**

参考客户端坐上现金桌后连续回应两手 `your_turn`，中间不要求收到 `match_result`。主动离桌后，它收到一条 `session_result`。公开 replay 不含未摊牌底牌；这条消息额外带该 Agent 自己的底牌。思考和解说不进入消息。

- [ ] **Step 2: 运行测试并确认失败**

Run: `bun test apps/server/src/test-utils/reference-agent-client.test.ts apps/server/src/agents/match-result-message.test.ts`

Expected: FAIL，现金桌离座没有结果消息。

- [ ] **Step 3: 发送 session_result**

`net_chips` 等于离座时权益减去入座时权益。入座时权益在买入完成后记录，离座时权益在兑现完成后记录。沿用现有投递缓存：进程内保留 24 小时，每个 Agent 最多 32 条，认证后补发，没有读取 ACK。结果在对应手牌归档成功后发送。现金桌不发送 `tournament-complete` 作为外部协议消息。只回应 `your_turn` 的旧 Agent 可以继续打牌；会把 `match_result` 当成整场结束的 Agent，改读 `session_result`。协议文档写明这个行为。

- [ ] **Step 4: 运行测试并确认通过**

Run: 与 Step 2 相同的命令

Expected: PASS

### Task 8: 文档和发布边界

**Files:**

- Modify: `docs/product-v1-contract.md`
- Modify: `docs/project-status.md`
- Modify: `README.md`
- Modify: `docs/external-agent-design.md`

- [ ] **Step 1: 改写公共循环描述**

产品契约的主循环改为：加入 `ranked-default`、现金桌入座、预置 Agent 补空位或让座、连续手牌、离座 `session_result`、赛季 bb/100。写明 14 天、20,000 起点、5,000 买入、15,000 封顶、500 手上榜、结束前 5 分钟停新牌。删除「必须 6 人才能开始」和「表演赛打完才释放预置 Agent」。

- [ ] **Step 2: 核对状态文档**

`docs/project-status.md` 把本计划标成下一次产品改动。并发归档修复保持已本地修复。SNG 六人补位标成被本计划取代，避免两套入座规则同时算作当前行为。

- [ ] **Step 3: 检查文档用词**

README 的 SNG、自动凑满六席和表演赛描述改为现金桌赛季。不写尚未实现的支付、奖金和 Pro。

### Task 9: 整计划验收

- [ ] **Step 1: 跑服务器聚焦测试**

Run:

```bash
bun test apps/server/src/cash-seat-policy.test.ts apps/server/src/season-ledger.test.ts apps/server/src/cash-table-loop.test.ts apps/server/src/season-store.test.ts apps/server/src/cash-chip-conservation.test.ts apps/server/src/matchmaking-service.test.ts apps/server/src/matchmaking-controller.test.ts apps/server/src/table-manager.test.ts apps/server/src/agents/match-result-message.test.ts apps/server/src/test-utils/reference-agent-client.test.ts
```

Expected: PASS

- [ ] **Step 2: 跑现有全量测试、类型检查和生产构建**

Run: 仓库根目录的 `bun run test`、服务器 `tsc --noEmit`、`bun run build`

Expected: PASS。全量测试的通过数记录进 `docs/project-status.md`。

- [ ] **Step 3: 做一次本地闭环**

用现有 HTTP、Socket.IO 和参考 Agent 验证这条路径：一个用户加入后立即入座；第二个用户替换预置 Agent；一人全下时手牌继续，输光后才离座；钱包不足时进入赛季筹码不足；主动离桌收到 `session_result`，其中净胜筹码等于离座权益减去入座权益；重启后退回到这手开始前的筹码；满 500 手后出现在正式榜，旧完赛名次仍在 `legacy`。旁观桌不改变赛季钱包。

Expected: 每一步都有测试或本地验收记录。未做浏览器视觉验收时，在状态文档里写明。

## 自检

| 决定 | 对应任务 |
|---|---|
| 2 人开打、最多 6 人 | Task 1、Task 3、Task 4 |
| 空位优先，其次替换预置 Agent | Task 1、Task 4 |
| 第七人在没有搭档时继续等待 | Task 1 |
| 旁观桌不锁死预置 Agent，桌内筹码不进赛季账 | Task 1、Task 4、Task 5 |
| 赛季账覆盖引擎结果，不累加输赢 | Task 2、Task 3、Task 5 |
| 同一手重复入账不改变权益 | Task 5 |
| 全下留到摊牌，输光才离座 | Task 3 |
| 庄位使用座位号 | Task 3 |
| 不另造筹码，桌上封顶 15,000 | Task 2、Task 3、Task 5 |
| 500 手和 bb/100 | Task 2、Task 6 |
| 结束前 5 分钟停止新牌，新赛季重新发放 20,000 | Task 2、Task 3、Task 5 |
| 重启退回到两手之间的快照 | Task 5 |
| 旧完赛名次留在 legacy | Task 6 |
| 外部 Agent 收到离座结果 | Task 7 |
| 解说和直播保留 | Task 3 不移除 highlight 和 commentary |
| 支付、Pro、私赛、SNG 演出不做 | Global Constraints |

本计划不包含 `llms.txt`、参数化策略模板和多机器人组合。那些是接入体验的下一步，等现金桌赛季的本地闭环通过后再单独写计划。

## 执行说明

实现时按 Task 1 到 Task 9 的顺序。Task 1 和 Task 2 没有依赖，可以先后紧挨着做。Task 4 之前不要删除旧的 ranked 结束代码。Task 5 的筹码守恒测试通过之前，不开始 Task 6。整个计划完成前不要部署。
