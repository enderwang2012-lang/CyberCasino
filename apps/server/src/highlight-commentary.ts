import type { ActionRecord, Card, ShowdownResult, HighlightReason } from "@cybercasino/shared";
import { getClient, getModel } from "./agents/llm-client";

const SUIT_SYMBOLS: Record<string, string> = { h: "♥", d: "♦", c: "♣", s: "♠" };
const RANK_NAMES: Record<number, string> = {
  2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8",
  9: "9", 10: "10", 11: "J", 12: "Q", 13: "K", 14: "A",
};

function cardStr(c: Card): string {
  return `${RANK_NAMES[c.rank]}${SUIT_SYMBOLS[c.suit]}`;
}

const REASON_LABELS: Record<HighlightReason, string> = {
  "big-pot": "大底池",
  "bluff-success": "诈唬成功",
  "bluff-catch": "抓诈成功",
  "cooler": "Cooler对决",
  "bad-beat": "Bad Beat",
  "short-stack-comeback": "短码翻盘",
  "multi-way-allin": "多人全下",
};

export interface CommentaryContext {
  handNumber: number;
  reasons: HighlightReason[];
  actionHistory: ActionRecord[];
  holeCards: Map<string, Card[]>;
  communityCards: Card[];
  showdownResults: ShowdownResult[] | null;
  potTotal: number;
  bigBlind: number;
  playerNames: Map<string, string>;
  winnerIds: string[];
}

function buildCommentaryPrompt(ctx: CommentaryContext): string {
  const reasonText = ctx.reasons.map((r) => REASON_LABELS[r]).join("、");

  const playerHands = [...ctx.holeCards.entries()]
    .map(([id, cards]) => `  ${ctx.playerNames.get(id) ?? id}: ${cards.map(cardStr).join(" ")}`)
    .join("\n");

  const community = ctx.communityCards.length > 0
    ? ctx.communityCards.map(cardStr).join(" ")
    : "(无公共牌)";

  const actions = ctx.actionHistory
    .map((a) => {
      const name = ctx.playerNames.get(a.playerId) ?? a.playerId;
      const actionText = a.action.type === "raise"
        ? `加注到 ${a.action.amount}`
        : a.action.type;
      const thought = a.thought?.message && a.thought.message !== "..."
        ? ` (内心: "${a.thought.message}")`
        : "";
      return `  [${a.phase}] ${name}: ${actionText}${thought}`;
    })
    .join("\n");

  const result = ctx.showdownResults
    ? ctx.showdownResults
        .map((r) => `  ${ctx.playerNames.get(r.playerId) ?? r.playerId}: ${r.holeCards.map(cardStr).join(" ")} → ${r.handName}${ctx.winnerIds.includes(r.playerId) ? " ★赢家" : ""}`)
        .join("\n")
    : `  赢家: ${ctx.winnerIds.map((id) => ctx.playerNames.get(id) ?? id).join(", ")}（对手弃牌）`;

  return `你是一位火爆的德州扑克网络直播解说，请为以下这手精彩牌局写一段解说。

## 牌局信息
- 手牌编号: #${ctx.handNumber}
- 精彩类型: ${reasonText}
- 底池总额: ${ctx.potTotal} (大盲 ${ctx.bigBlind})

## 玩家手牌
${playerHands}

## 公共牌
${community}

## 行动过程
${actions}

## 结果
${result}

## 要求
- 先简要复述牌局过程：翻牌前谁加注/跟注，翻牌/转牌/河牌各发了什么、关键动作是什么，让没看直播的人也能看懂
- 在叙事中自然穿插点评，语气像老练的牌友聊天，有态度但不浮夸
- 可以夸赞好操作、调侃失误、感叹运气，但点到即止
- 4-6句话，叙事为主、情绪为辅
- 只输出解说文字，不要输出其他内容`;
}

export async function generateCommentary(ctx: CommentaryContext): Promise<string> {
  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Commentary LLM timeout (30s)")), 30000)
    );

    const response = await Promise.race([
      getClient().chat.completions.create({
        model: getModel(),
        max_tokens: 500,
        messages: [
          {
            role: "system",
            content: "你是一位经验丰富的德州扑克解说。你的风格是先讲清楚牌局经过，再自然带出点评。语气像老练牌友复盘，有态度但克制，不做作不喊麦。",
          },
          { role: "user", content: buildCommentaryPrompt(ctx) },
        ],
      }),
      timeoutPromise,
    ]);

    const text = response.choices[0]?.message?.content?.trim();
    if (!text) throw new Error("Empty commentary response");
    return text;
  } catch (error) {
    console.error(`[highlight-commentary] generation failed:`, (error as Error).message);
    const fallbacks: Record<HighlightReason, string> = {
      "big-pot": "这把底池爆炸了！筹码疯狂堆积，谁能笑到最后？",
      "bluff-success": "一手教科书级别的诈唬！对手被骗得团团转！",
      "bluff-catch": "火眼金睛！完美识破诈唬，让对手的演技白费！",
      "cooler": "两副强牌正面交锋，这就是德州的残酷！",
      "bad-beat": "天哪！这河牌简直是命运在开玩笑！",
      "short-stack-comeback": "短码逆袭！绝境翻盘的快感，无与伦比！",
      "multi-way-allin": "三路全下！这把牌的火药味直接拉满！",
    };
    return fallbacks[ctx.reasons[0]] ?? "精彩一手！";
  }
}
