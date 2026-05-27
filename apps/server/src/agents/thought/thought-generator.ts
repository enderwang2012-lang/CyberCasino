import type {
  ExpressionConfig,
  ThoughtLanguage,
  ToneSpectrum,
  PostflopCondition,
  ActionType,
  AgentThought,
  Card,
  AgentGameView,
} from "@cybercasino/shared";
import type { PsychologicalState } from "../imperfection/psychological-state";
import { describeState } from "../imperfection/psychological-state";
import { getClient, getModel } from "../llm-client";

// ---------------------------------------------------------------------------
// Hand condition → natural-language descriptions
// ---------------------------------------------------------------------------

const HAND_DESC_ZH: Record<string, string> = {
  "top-pair-top-kicker": "顶对顶踢脚",
  "top-pair-good-kicker": "顶对好踢脚",
  "top-pair-weak-kicker": "顶对弱踢脚",
  "second-pair": "第二对",
  "middle-pair": "中对",
  "bottom-pair": "底对",
  "overpair": "超对",
  "top-two-pair": "顶两对",
  "two-pair": "两对",
  "three-of-a-kind": "三条",
  "straight": "顺子",
  "flush": "同花",
  "full-house": "葫芦",
  "four-of-a-kind": "四条",
  "straight-flush": "同花顺",
  "royal-flush": "皇家同花顺",
  "flush-draw": "同花听牌",
  "straight-draw": "顺子听牌",
  "gutshot": "卡顺听牌",
  "overcards": "高牌",
  "nothing": "空气牌",
  "monster": "怪兽牌",
};

const HAND_DESC_EN: Record<string, string> = {
  "top-pair-top-kicker": "top pair top kicker",
  "top-pair-good-kicker": "top pair good kicker",
  "top-pair-weak-kicker": "top pair weak kicker",
  "second-pair": "second pair",
  "middle-pair": "middle pair",
  "bottom-pair": "bottom pair",
  "overpair": "overpair",
  "top-two-pair": "top two pair",
  "two-pair": "two pair",
  "three-of-a-kind": "three of a kind",
  "straight": "straight",
  "flush": "flush",
  "full-house": "full house",
  "four-of-a-kind": "four of a kind",
  "straight-flush": "straight flush",
  "royal-flush": "royal flush",
  "flush-draw": "flush draw",
  "straight-draw": "straight draw",
  "gutshot": "gutshot straight draw",
  "overcards": "overcards",
  "nothing": "nothing",
  "monster": "monster",
};

const ACTION_DESC_ZH: Record<string, string> = {
  fold: "弃牌",
  check: "过牌",
  call: "跟注",
  raise: "加注",
};

const ACTION_DESC_EN: Record<string, string> = {
  fold: "fold",
  check: "check",
  call: "call",
  raise: "raise",
};

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Map a PostflopCondition enum value to a human-readable hand description.
 * ja / ko fall back to zh; "mixed" prefers zh.
 */
export function describeHand(
  condition: PostflopCondition,
  lang: ThoughtLanguage
): string {
  const dict = lang === "en" ? HAND_DESC_EN : HAND_DESC_ZH;
  return dict[condition] ?? condition;
}

/**
 * Map an ActionType to a human-readable action description.
 */
export function describeAction(
  action: ActionType,
  lang: ThoughtLanguage
): string {
  const dict = lang === "en" ? ACTION_DESC_EN : ACTION_DESC_ZH;
  return dict[action] ?? action;
}

// ---------------------------------------------------------------------------
// Preflop hand strength → thought category
// ---------------------------------------------------------------------------

type PreflopCategory = "premium" | "good" | "trash" | "bluff";

const RANK_MAP: Record<string, number> = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8,
  "9": 9, "T": 10, "J": 11, "Q": 12, "K": 13, "A": 14,
};

function parseCard(s: string): { rank: number; suited: boolean } {
  const clean = s.replace(/[+o]/g, "");
  return { rank: RANK_MAP[clean[0]] ?? 0, suited: clean[1] === "s" };
}

function cardRank(c: { rank: number }) { return c.rank; }

function cardSuit(c: { suited: boolean }) { return c.suited; }

/**
 * Classify a 2-card preflop hand into a thought category.
 */
export function classifyPreflopHand(
  cards: Array<{ rank: number; suit: string }>
): PreflopCategory {
  if (cards.length < 2) return "good";
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const [hi, lo] = ranks;
  const suited = cards[0].suit === cards[1].suit;
  const pair = hi === lo;

  // Premium: AA-QQ, AKs, AKo
  if (pair && hi >= 12) return "premium";
  if (hi === 14 && lo >= 13) return "premium";

  // Good: JJ-77, AQs+, AJs, KQs, suited connectors T9s+
  if (pair && hi >= 7) return "good";
  if (hi === 14 && lo >= 10) return "good";
  if (hi === 13 && lo >= 12 && suited) return "good";
  if (suited && hi - lo <= 1 && hi >= 10) return "good";

  // Trash
  if (hi < 10 && lo < 10 && !suited) return "trash";

  return "good";
}

// ---------------------------------------------------------------------------
// Template selection helpers
// ---------------------------------------------------------------------------

type TemplateKey = "confident" | "worried" | "bluffing" | "frustrated";

function selectTemplate(
  state: PsychologicalState,
  action: ActionType
): TemplateKey {
  if (state.tilt > 0.5) return "frustrated";
  if (action === "raise" && state.confidence > 0.6) return "confident";
  if (state.fear > 0.5) return "worried";
  return "confident";
}

// ---------------------------------------------------------------------------
// Core thought generator
// ---------------------------------------------------------------------------

/**
 * Generate a contextual AgentThought based on the agent's hand condition,
 * chosen action, expression config, and current psychological state.
 *
 * @param handCondition - postflop hand strength classification
 * @param action         - the action the agent is about to take
 * @param expression     - the agent's expression / personality config
 * @param state          - current psychological state (tilt, fear, etc.)
 * @param context        - optional extra variables ({concern}, {opponent})
 */
export function generateThought(
  handCondition: PostflopCondition,
  action: ActionType,
  expression: ExpressionConfig,
  state: PsychologicalState,
  context?: { concern?: string; opponent?: string }
): AgentThought {
  const lang = expression.thoughtLanguage;

  const handDesc = describeHand(handCondition, lang);
  const actionDesc = describeAction(action, lang);

  // 1. Select the best matching thought template
  const templateKey = selectTemplate(state, action);
  const rawTemplate = expression.thoughtTemplates[templateKey];
  const template = Array.isArray(rawTemplate)
    ? rawTemplate[Math.floor(Math.random() * rawTemplate.length)]
    : rawTemplate;
  let message = template
    .replace("{handDesc}", handDesc)
    .replace("{actionDesc}", actionDesc)
    .replace("{concern}", context?.concern ?? "")
    .replace("{opponent}", context?.opponent ?? "");

  // 2. Optionally append a catchphrase (30% chance)
  if (expression.catchphrases.length > 0 && Math.random() < 0.3) {
    const idx = Math.floor(Math.random() * expression.catchphrases.length);
    message += " " + expression.catchphrases[idx];
  }

  // 3. Optionally append a verbal tic (50% chance)
  if (expression.verbalTics.length > 0 && Math.random() < 0.5) {
    const idx = Math.floor(Math.random() * expression.verbalTics.length);
    message += " " + expression.verbalTics[idx];
  }

  // 4. Compute derived fields
  const rawConf =
    0.5 + state.confidence * 0.3 - state.fear * 0.2 - state.tilt * 0.1;
  const confidence = Math.max(0.1, Math.min(0.95, rawConf));

  const isBluffing = action === "raise" && handCondition === "nothing";

  const difficulty = state.tilt > 0.5 ? 0.8 : undefined;

  const psychologicalState = describeState(state);

  return {
    message: message.trim(),
    confidence: Math.round(confidence * 100) / 100,
    isBluffing,
    difficulty,
    psychologicalState,
    thinkingSource: "strategy",
  };
}

// ---------------------------------------------------------------------------
// LLM-based thought generation (with timeout fallback)
// ---------------------------------------------------------------------------

const SUIT_SYMBOLS: Record<string, string> = { h: "♥", d: "♦", c: "♣", s: "♠" };
const RANK_NAMES: Record<number, string> = {
  2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8",
  9: "9", 10: "10", 11: "J", 12: "Q", 13: "K", 14: "A",
};
function cardStr(c: Card): string {
  return `${RANK_NAMES[c.rank]}${SUIT_SYMBOLS[c.suit]}`;
}

function buildThoughtPrompt(
  view: AgentGameView,
  action: ActionType,
  amount: number | undefined,
  language: "zh" | "en",
): string {
  const myCards = view.myCards.map(cardStr).join(" ");
  const community = view.communityCards.length > 0
    ? view.communityCards.map(cardStr).join(" ")
    : "(无)";
  const potSize = view.pots.reduce((s, p) => s + p.amount, 0);
  const opponents = view.players
    .filter((p) => p.id !== view.myId && !p.folded)
    .map((p) => `  ${p.name}: ${p.chips}筹码, 下注${p.bet}${p.allIn ? " [ALL-IN]" : ""}`)
    .join("\n");

  const actionDesc = action === "raise" ? `加注到 ${amount ?? "?"}` : { fold: "弃牌", check: "过牌", call: "跟注" }[action];

  if (language === "en") {
    return `POKER THOUGHT — write 1 sentence of inner monologue (like a real player muttering to themselves).

Hand: ${myCards} | Board: ${community} | Phase: ${view.phase}
Pot: ${potSize} | Your chips: ${view.myChips} | Your action: ${actionDesc}
Opponents:
${opponents || "  (none)"}

Rules: reference your actual cards by name, be natural and brief, no JSON.`;
  }

  return `扑克内心独白 — 用 1 句话写出此刻的真实想法（像牌手在心里嘀咕）。

手牌: ${myCards} | 公共牌: ${community} | 阶段: ${view.phase}
底池: ${potSize} | 你的筹码: ${view.myChips} | 你的动作: ${actionDesc}
对手:
${opponents || "  (无)"}

要求：提到你的真实手牌牌面，自然简短，像人一样说话，不要 JSON。`;
}

/**
 * Generate thought via LLM. Returns null on failure/timeout (caller should
 * fall back to template-based generation).
 */
export async function generateLLMThought(
  view: AgentGameView,
  action: ActionType,
  amount: number | undefined,
  language: "zh" | "en",
  state: PsychologicalState,
): Promise<AgentThought | null> {
  try {
    const prompt = buildThoughtPrompt(view, action, amount, language);

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("LLM thought timeout")), 5000)
    );

    const response = await Promise.race([
      getClient().chat.completions.create({
        model: getModel(),
        max_tokens: 80,
        temperature: 0.9,
        messages: [
          {
            role: "system",
            content: language === "en"
              ? "You are a poker player's inner voice. Output ONLY the thought text, nothing else."
              : "你是一个扑克玩家的内心独白。只输出想法文字，不要任何其他内容。",
          },
          { role: "user", content: prompt },
        ],
      }),
      timeoutPromise,
    ]);

    const text = response.choices[0]?.message?.content?.trim();
    if (!text || text.length < 2) return null;

    const rawConf = 0.5 + state.confidence * 0.3 - state.fear * 0.2 - state.tilt * 0.1;
    const confidence = Math.max(0.1, Math.min(0.95, rawConf));
    const isBluffing = action === "raise" && view.myCards.length === 2;

    return {
      message: text,
      confidence: Math.round(confidence * 100) / 100,
      isBluffing,
      thinkingSource: "llm",
    };
  } catch {
    return null;
  }
}