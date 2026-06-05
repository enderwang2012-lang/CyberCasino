# 像素牌桌可视化（Pixel Table Visualization）

**Status**: Draft v1 · 2026-06-05
**Owner**: wangwei98
**Inspiration**: [Agentshire](https://github.com/Agentshire/Agentshire) — 借鉴其"角色化 NPC + 状态机 + 决策→VFX 映射 + 流式打字气泡"的核心思想，但**视觉风格走 2D 像素风**（Agentshire 是低面 3D，我们不抄视觉、只抄思想）。

## 1. 目标

把 CyberCasino 现在的纯文字事件流（`ChatFeed`）升级为**像素风可视化牌桌**，让"AI 在打牌"从描述变成可观赏的画面。最终产出：
- 上帝视角观战体验，6 个 AI 牌手围一张竖向椭圆桌
- 每个 AI 是有"表情"的角色（emoji 气泡 + idle 微动）
- 关键决策（特别是 All-in / 赢牌）有局部视觉特效
- 直播切片 / 录屏 GIF 即可成为传播素材

## 2. 非目标

为了避免镀金、保持"先做基础后做加法"原则，**这一版明确不做**：
- ❌ 镜头变化、慢动作、剧场化推近
- ❌ 发牌弧线动画、筹码飞行动画
- ❌ 角色多状态身体动作（无 BET/RAISE/CALL/FOLD 帧动画，只用 IDLE + emoji + 静态变体）
- ❌ 性格化定制特效（每个 AI 不同的 VFX）
- ❌ 音效（v1 全部留空）
- ❌ 桌面环境/装饰物（窗户、灯、海报等"舞台道具"）

非目标都标记为"v2 候选"，先跑通 v1 的基础画面再说。

## 3. 整体布局（已与用户确认）

参考 mockup：`.superpowers/brainstorm/80310-1780653736/content/layout-v3.html`

从上到下：

```
┌─────────────────────────────────┐
│ ① 系统状态栏                    │ 18px
├─────────────────────────────────┤
│ ② 顶部导航  ‹ 返回 / 桌名 / SNG │ 38px
├─────────────────────────────────┤
│ ③ 一级 Tab  ⭐ 集锦 │ 🏆 排行榜 │ 36px
├─────────────────────────────────┤
│ ④ 二级 Tab  📺 实况 │ 📝 文字   │ 36px (仅在"集锦" tab 内)
├─────────────────────────────────┤
│                                 │
│  ⑤ 实况牌桌主区                 │ ≈60% 屏高
│     · 顶部底池数字              │
│     · 竖向椭圆桌（6 人位）      │
│     · 中央 5 张公共牌           │
│     · 当前思考者：金色描边脉冲  │
│                                 │
├─────────────────────────────────┤
│ ‹ ⑥ 当前手卡片（轮播）       › │ ≈88px
└─────────────────────────────────┘
```

**6 个座位**（竖椭圆）：
- 上方 1 人
- 左 2（左上、左下）
- 右 2（右上、右下）
- 下方 1 人

**单座位信息层级**（自上而下）：
1. 头顶 emoji 气泡（情绪/决策反应）
2. 本轮下注金额（仅当下注 > 0 时显示，红框小标签）
3. 头像（圆形 sprite，当前思考者带金色描边 + 脉冲）
4. 手牌（2 张，默认背面，showdown 翻开）
5. 昵称
6. 筹码总额（等宽字体）

**自适应**：宽屏放头像旁，窄屏放头像下方。

**视角立场**：6 人对等，**无主视角**——玩家是观众/上帝视角，所以所有手牌默认背面，showdown 才翻开。

## 4. 视觉风格（v1 核心约束：克制 · 与 Apple 风 UI 一致）

**v1 的最高视觉准则：色彩集中在表情和局部动画，整体克制不喧宾夺主。** 像素风是"舞台"而不是"主角"——主角是 AI 牌手的决策与情绪表达。

### 4.1 整体色调
- **背景**：与现有 UI 同款的中性浅色（白 / 浅灰 + 极淡渐变），**不用暖黄/糖果色等饱和背景**
- **桌面**：低饱和绿（如 `#3d8b6a`），桌沿用深灰木色或哑光金属，避免高对比霓虹边
- **UI 容器**：沿用现有 iOS 风（圆角、毛玻璃、阴影克制）
- **像素 sprite 区与 UI 区视觉自然过渡**：sprite 在桌面 Canvas 内，UI（顶部 Tab、底部卡片）保持 DOM/Tailwind 渲染

### 4.2 色彩配额（哪里能花、哪里必须素）
| 区域 | 色彩自由度 | 原则 |
|---|---|---|
| 头顶 emoji 气泡 | **高** | 系统原生 emoji，自然多彩 |
| 当前思考者描边 | 中（金色） | 单色脉冲，不引入更多色 |
| All-in 火焰粒子 | **高**（红橙） | 仅 1.5s 瞬时 |
| 赢家冠光 + 金币 | **高**（金黄） | 仅 1.5s 瞬时 |
| 头像本体 | 低 | 一套统一色板，不让 6 个角色互相喊叫 |
| 桌面 / 公共牌 / 底池 | **极低** | 中性、低饱和、可读性优先 |
| 背景 / UI | **极低** | 与现有 UI 完全一致 |

**核心原则**：**默认状态画面尽量素**，色彩与活力通过**情绪 emoji + 关键时刻局部特效**点亮——这正好对应"AI 在思考、突然出招、赢牌庆祝"的节奏感。

### 4.3 角色视觉
6 个 AI 牌手仍保留 Cyber 锚点（机器人 / AR 眼镜 / 霓虹发色 / 机械臂等），但 v1 **每个 AI 只有 1-2 个识别元素**，整体仍以中性色为主，不堆叠多重赛博装饰。

### 4.4 风格隔离
UI 区（顶 Tab / 底卡片 / 排行榜）走现代 iOS 风（圆角、模糊、Apple 风克制）。像素风**仅出现在牌桌 Canvas 内部**——头像、桌面、公共牌、筹码堆。两者通过"sprite 在 Canvas 中、UI 在 DOM 中"的边界自然隔离，避免整站像素化造成的阅读疲劳。

## 5. 角色与决策呈现（4.1 + 4.2 定稿）

### 5.1 角色"状态" —— 极简化

不再做 8 状态机，只保留视觉表现层的 5 种"显示模式"：

| 模式 | 触发 | 视觉表现 |
|---|---|---|
| **IDLE** | 默认 | 静止 sprite + 偶尔眨眼/呼吸（每 4-8s 随机一帧） |
| **THINKING** | 轮到该玩家决策 | 头像金色描边 + 脉冲；头顶 "..." 思考气泡 |
| **ALL-IN** | 该玩家提交 all-in 决策瞬间 | 角色周围**火焰粒子**（持续 1.5s 后淡出）；底池区域红光闪烁同步 |
| **FOLDED** | 该手已弃牌 | 头像降饱和 + 整体半透明（持续到下一手） |
| **OUT** | SNG 中已淘汰 | 头像永久灰阶 |
| **WIN** | 赢得本手底池 | 头顶冠光 + 局部金币粒子 1.5s |

注意：**没有 BET / RAISE / CALL / CHECK 的角色动作**——这些通过头顶 emoji 气泡 + 筹码区数字变化即可表达，避免帧动画工作量。

### 5.2 决策 → 头顶 emoji 气泡（统一表）

每种决策有一组 emoji 池，每次随机抽取，**同一玩家相邻 2 次不重复**：

```
FOLD     → [😅, 🙄, 😴, 🤷, 💤, 😮‍💨]
CALL     → [🤔, 😏, 👀, 🧐, 😶, 🤨]
CHECK    → [😎, 🙂, 👌, ✋]
RAISE    → [🔥, 💪, ⚡, 😤, 🎯]
ALL-IN   → [💀, ⚡, 🔥, 🎲, 🚀]
赢牌      → [🎉, 💰, 😎, 👑, 🏆]
BAD BEAT → [😱, 🤯, 💀, 😭, 🥲]
IDLE     → 30% 概率随机情绪（[😏, 😴, 🤔, 👀, 😎, 🙂, 😅]），每 6-12s 抽一次
```

**气泡行为**：
- 出现：从头像顶部弹出（缩放 0→1，120ms）
- 停留：2 秒
- 消失：淡出（200ms）
- 守卫期：同一玩家两次 emoji 气泡最小间隔 800ms

**BLUFF 处理**：v1 不显式暴露给观众。后端如果在 thought 里标记 bluff=true，气泡仍走 RAISE 池，不做特殊视觉。（v2 候选：观众视角增加紫色暗纹光环显示"内心其实在诈唬"）

### 5.3 桌面特效（极简）

**仅 All-in 时**：底池数字区域红光闪烁 + 边缘震动 0.5s。其他决策**无桌面特效**。

筹码总额变化用**数字滚动动画**（300ms）表达，无飞行动画。

公共牌翻牌用简单 **flip 动画**（0.3s scale x→0→1 + 切换正反面）。

## 6. 底部当前手卡片（4.3 打字机 + 6 历史回看）

### 6.1 内容
- 头像（小尺寸）
- 昵称 + 状态（"思考中…" / "已决策"）
- AI 的 thought 文本（**打字机效果**，30 字/秒）
- 决策结果标签（FOLD / CALL $X / RAISE $X / ALL-IN $X），**v1 只展示不可点击跳转**

### 6.2 守卫期
同一玩家两次 thought 卡片更新最小间隔 1.2 秒（避免快速决策时打字机来不及看完就被替换）。

### 6.3 历史回看
- 卡片左右各一个箭头（`‹` `›`）
- 左箭头：回看上一手 thought（每点一次回退一手）
- 右箭头：返回当前
- 卡片顶部显示 `手牌 #X · 3/12`（位置标记）

## 7. 非牌桌界面变化

### 7.1 集锦 Tab
保留现有 `HighlightFeed` 文字播报作为"📝 文字"二级 tab。新增"📺 实况"二级 tab 显示像素牌桌（默认）。

### 7.2 排行榜 Tab
保留现有 `Leaderboard` 不变。

### 7.3 历史回放页（`HistoryPage`）
归档牌桌点击进入时同样支持像素牌桌实况回放（事件流逐步重放，复用同一渲染层）。**v1 维持现有事件重放速率，不新增暂停 / 快进功能**（v2 候选）。

## 8. 技术架构

### 8.1 渲染层选型：**PixiJS v8**

**选 PixiJS 不选 Canvas API / Three.js / Phaser 的理由**：
- 2D 像素风原生最优（自动 nearest-neighbor、PIXI.SCALE_MODES.NEAREST）
- React 生态有 `@pixi/react` 已稳定
- WebGL 硬件加速，60 帧无压力
- 无需 3D 思维、API 浅，学习曲线远低于 Three.js
- 包体积比 Phaser 小（Phaser 含完整游戏循环我们用不到）

### 8.2 模块拆分

```
apps/web/src/components/PixelTable/
  ├─ PixelTableView.tsx          # 容器：替换原 TableView 的"实况"区
  ├─ stage/
  │   ├─ PixiStage.tsx            # @pixi/react Application 包裹
  │   ├─ Table.tsx                # 椭圆桌面 sprite
  │   ├─ CommunityCards.tsx       # 5 张公共牌容器
  │   ├─ PotDisplay.tsx           # 顶部底池数字
  │   └─ Seat.tsx                 # 单座位（头像/手牌/筹码/下注）
  ├─ effects/
  │   ├─ EmojiBubble.tsx          # 头顶 emoji 气泡（pop in/out）
  │   ├─ ThinkingHalo.tsx         # 思考者金色脉冲描边
  │   ├─ AllInFire.tsx            # All-in 火焰粒子
  │   └─ WinCelebration.tsx       # 赢家冠光 + 金币粒子
  ├─ logic/
  │   ├─ emoji-pool.ts            # 决策 → emoji 抽取（含防重）
  │   ├─ event-to-state.ts        # GameEvent → 渲染状态映射
  │   └─ animation-scheduler.ts   # 守卫期 / 排队 / 节流
  └─ assets/                      # 像素 sprite（路径见 §10）

apps/web/src/components/
  ├─ TableView.tsx                # 原文件：改为容器 + Tab 路由
  ├─ TurnCard.tsx                 # 新：底部当前手卡片（含打字机 + 回看）
  └─ ChatFeed.tsx                 # 保留，移到"📝 文字" tab 下
```

### 8.3 数据流

```
WebSocket events
   │
   ▼
TableView (existing event accumulator)
   │
   ├──► ChatFeed (文字 tab 不变)
   │
   └──► PixelTableView
           │
           ▼
      event-to-state.ts
        - 累加 GameEvent[]
        - 计算 6 个座位的当前快照（{playerId, chips, currentBet, status, lastDecision, thought, ...}）
        - 计算公共牌 / 底池
           │
           ▼
      Seat[] / Table 渲染
           │
           └─► EmojiBubble / ThinkingHalo / AllInFire / WinCelebration 触发
```

**核心原则**：渲染层是**纯函数 of state**。事件流入 → 状态更新 → 渲染重画。所有动效通过"状态从 A 变 B"触发，绝不命令式调用 `playEffect()`。

### 8.4 性能预算

- 60 fps 目标
- ALL-IN 火焰粒子 ≤ 50 颗
- 赢家金币粒子 ≤ 80 颗
- emoji 气泡同屏 ≤ 6（每位玩家最多 1 个）
- 静态 sprite atlas 单张 ≤ 1024×1024
- 总资产体积（sprite + UI）≤ 2 MB（gzip 后）

## 9. 与现有代码的集成

### 9.1 复用
- `GameEvent` 类型不变（`packages/shared`）
- WebSocket 连接逻辑不变（`apps/web/src/hooks/useSocket`）
- `LanguageContext` 双语支持自动覆盖（[[project_bilingual]]）
- 现有 `ChatFeed` / `Leaderboard` / `HighlightFeed` 移到对应 tab 下

### 9.2 改造
- `TableView.tsx` 重构为 Tab 路由壳，不再直接 render ChatFeed
- 新增 `TurnCard` 与现有事件流订阅同源

### 9.3 服务端
**零改动**。所有可视化都从现有 GameEvent 推导。

## 10. 美术资源策略

### 10.1 调研结论
公开市场**不存在"6 个赛博风顶视坐姿 AI 牌手 + 多动作"的一站式包**。开源赛博像素角色多为侧视平台游戏向，顶视坐姿 + 多动作齐全的角色组在 Kenney / LimeZu / itch.io / OpenGameArt 全部范围内**没有直接命中**。

但好消息：扑克牌 / 筹码 / UI / 特效 / 桌面这些"基础件"开源资源齐全且大多 CC0。瓶颈仅在角色。

### 10.2 推荐组合（一站式覆盖 ~90%）

| 类别 | 资源 | 协议 | 链接 | 备注 |
|---|---|---|---|---|
| 牌 + 筹码 | **Kenney Playing Cards Pack** | CC0 | kenney.nl/assets/playing-cards-pack | 52 张 + 牌背 + 筹码图标全包，零署名 |
| 角色基础体 | **LimeZu Modern Interiors** 角色生成器 | 商用许可（购买） | limezu.itch.io | 顶视 16×16，输出 6 个基础体；常 50% off |
| 角色赛博 overlay | **Free Game Assets · Cyberpunk Townspeople** | 免费商用（署名） | free-game-assets.itch.io | AR 眼镜 / 霓虹发 / 机械臂等元素 |
| UI + 字体 | **Cyberpunk UI Asset Pack v1**（DoDoCat） | 免费商用 | itch.io 搜该名 | 霓虹按钮 / HUD / 对话框 |
| 中文像素字体 | **Zpix** | OFL / MIT | github.com/SolidZORO/zpix-pixel-font | 12px 中文像素，支持简繁日 |
| 桌面（绿呢椭圆） | OpenGameArt "Asset Pack Pixel Poker" | CC-BY | opengameart.org/content/asset-pack-pixel-poker | 桌面 + 庄家可拆，做参考 |
| 特效 | **Free Pixel Effects Pack #4/#5** | 免费 | itch.io | 火花 / 烟花 / 闪光，All-in / winner 通用 |

**总成本**：< $25（LimeZu ≈ $15，其余全免费）。

### 10.3 角色缺口的解决路径

LimeZu / Penzilla 输出的角色只有 idle/walk，不含 thinking/all-in/win 等动作。我们的方案：

1. 用 LimeZu 生成 6 个体型/服饰/肤色不同的基础角色
2. 用 Free Game Assets 的赛博元素叠加（AR 眼镜 + 霓虹发色 + 机械臂等 6 种 gimmick）
3. **本 spec § 5.1 已极简化角色显示模式**——idle 是唯一需要的动作，其他状态全靠静态 sprite + emoji 气泡 + 描边 + 半透明状态变体表达。这意味着**自绘工作量降到几乎为零**：
   - IDLE → LimeZu 输出已有
   - THINKING → idle + 头顶 emoji 气泡 + 描边脉冲（程序生成）
   - ALL-IN → idle + 火焰粒子（程序生成）
   - FOLDED → idle + CSS 滤镜降饱和（程序生成）
   - OUT → idle + 灰阶（程序生成）
   - WIN → idle + 头顶冠光 + 金币粒子（程序生成）

**核心洞察**：决策已经在 § 4 锁死"无角色帧动作"，所以美术资源的 90% 缺口被设计简化消化了，**实际只需 1 套静态角色 sprite 即可**。

### 10.4 备选纯免费方案（< $0）
Kenney Playing Cards + **Penzilla Expanded Character (free tier)** + Free Game Assets 赛博系列 + DoDoCat Cyberpunk UI + Free Pixel Effects #4。零成本，但风格统一性下降，需自行调色统一。M1 占位阶段先用此方案，M6 决定是否升级到 LimeZu 付费版。

### 10.5 GitHub 开源调研结论
对 [github.com/topics/pixel-art](https://github.com/topics/pixel-art) 与 [Siilwyn/awesome-pixel-art](https://github.com/Siilwyn/awesome-pixel-art) 两个清单的检索表明：**赛博风顶视坐姿角色 + 扑克 + casino 这个组合在开源社区是空白**。GitHub topic 下无任何可商用的扑克/casino 像素项目可借鉴或抠 sprite，awesome-pixel-art 列表纯工具向、不含 Assets 分类。**结论：§ 10.2 推荐组合即最优解，不要再花时间在 GitHub 找替代品。**

> 单独标注的工具链备选（实现期可选）：
> - **Pixelorama** ([Orama-Interactive/Pixelorama](https://github.com/Orama-Interactive/Pixelorama), MIT, 9.7k★)——Aseprite 的开源替代，团队若不付费可用；
> - **LibreSprite** ([LibreSprite](https://github.com/LibreSprite/LibreSprite), GPLv2, 7.8k★)——Aseprite 最后 GPL 版本的 fork；
> - **spritefusion-pixel-snapper** ([Hugo-Dz](https://github.com/Hugo-Dz/spritefusion-pixel-snapper))——若未来用 AI 生成补充资产，可修复网格对齐。

### 10.6 协议要求与实现期约束
**协议**：MIT / CC0 / CC-BY / CC-BY-SA 均可。禁止 NC（非商用）和 ND（禁止改动）。所有 CC-BY 资源在 `docs/CREDITS.md` 集中署名。

**实现期约束**：
1. 所有 sprite 打成单张 atlas（PIXI 性能最优）
2. 像素整数缩放（×2 / ×3），禁止小数缩放
3. 默认禁用图片平滑（`PIXI.SCALE_MODES.NEAREST`）
4. 中文文本走 Zpix 字体；emoji 走系统原生字体（不像素化以保持表现力）

## 11. 实现期的精细化约束（不在本 spec 决策、但要保留）

- **间距**：mockup v3 的间距是粗略的，实现期需精细化
- **字体**：像素字体 + 中文（中文像素字体可用 [Zpix](https://github.com/SolidZORO/zpix-pixel-font) MIT）
- **emoji 渲染**：用系统原生 emoji，不画像素 emoji（保持表现力）
- **颜色**：实现期建立 design token（背景渐变值、桌面绿、Cyber 边框光色）

## 12. 里程碑

| 阶段 | 内容 | 预估 |
|---|---|---|
| **M1 · 静态布局** | 6 座位 + 桌面 + 公共牌 + 底池静态渲染（占位 sprite） | 3 天 |
| **M2 · 事件接入** | 实时事件→状态映射，筹码数字滚动，思考者描边脉冲 | 3 天 |
| **M3 · emoji 气泡** | 决策→emoji 池抽取 + 防重 + 守卫期 + 弹出动画 | 2 天 |
| **M4 · 底部卡片** | TurnCard + 打字机效果 + 历史回看箭头 | 2 天 |
| **M5 · 特效** | All-in 火焰 + 赢家冠光金币粒子 + 公共牌 flip | 3 天 |
| **M6 · 美术替换** | 占位 sprite → 真实美术资源；间距精细化 | 3 天 |
| **M7 · QA + 移动端** | iPhone / iPad / 桌面三档断点验证 | 2 天 |
| **合计** | | **≈ 18 天 / 3.5 周** |

## 13. 风险与备选

| 风险 | 缓解 |
|---|---|
| 找不到统一风格的 6 个赛博角色像素 sprite | 先用同一作者的人形角色包，后期 Aseprite 改色调（霓虹发色 + 眼镜配件）实现差异 |
| PixiJS 学习曲线 / React 集成踩坑 | M1 单独安排 1 天技术验证（spike），失败回退到 CSS Sprite + DOM |
| 移动端 60fps 跑不动 | 降级特效（火焰粒子从 50 降 20）、关闭 idle 微动 |
| 6 个 AI 一齐说话气泡爆炸 | animation-scheduler 排队 + 全局并发上限（同屏最多 3 个气泡同时弹出） |

## 14. v2 候选（明确推迟）

按"先做加法"清单存档：
- 镜头化剧场（All-in 推近 / Showdown 翻牌节奏）
- 性格化 VFX（Dwan 骰子、臧书奴 GTO 数据流）
- BLUFF 显示（紫色暗纹光环）
- 桌面环境道具（窗户、霓虹招牌、地砖 tileset）
- 音效（筹码碰撞、心跳、胜利音阶）
- 角色帧动画（推筹码、挥拳）
- AI 解说集锦自动剪辑（[[project_highlight_reel]]）

## 15. 引用

- 灵感源：[Agentshire](https://github.com/Agentshire/Agentshire)（低面 3D，借思想不借视觉）
- 现有项目记忆：[[project_highlight_reel]] [[project_bilingual]] [[project_sng_roadmap]] [[project_competitor_analysis]]
- 设计 mockup（已确认）：`.superpowers/brainstorm/80310-1780653736/content/layout-v3.html`
