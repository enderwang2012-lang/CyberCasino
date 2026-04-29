import Anthropic from "@anthropic-ai/sdk";
import type {
  AgentGameView,
  AgentDecision,
  AgentThought,
  ActionType,
  AgentPersonality,
  Card,
} from "@cybercasino/shared";

const SUIT_SYMBOLS: Record<string, string> = { h: "♥", d: "♦", c: "♣", s: "♠" };
const RANK_NAMES: Record<number, string> = {
  2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8",
  9: "9", 10: "10", 11: "J", 12: "Q", 13: "K", 14: "A",
};

function cardStr(c: Card): string {
  return `${RANK_NAMES[c.rank]}${SUIT_SYMBOLS[c.suit]}`;
}

function buildPrompt(view: AgentGameView, validActions: ActionType[], callAmount: number, minRaise: number): string {
  const myCards = view.myCards.map(cardStr).join(" ");
  const community = view.communityCards.length > 0
    ? view.communityCards.map(cardStr).join(" ")
    : "(none)";
  const potSize = view.pots.reduce((s, p) => s + p.amount, 0);

  const opponents = view.players
    .filter((p) => p.id !== view.myId && !p.folded)
    .map((p) => `  ${p.name} (${p.avatar}): ${p.chips} chips, bet ${p.bet}${p.allIn ? " [ALL-IN]" : ""}`)
    .join("\n");

  const recentActions = view.actionHistory
    .slice(-10)
    .map((a) => `  ${a.playerId}: ${a.action.type}${a.action.amount ? ` ${a.action.amount}` : ""}`)
    .join("\n");

  return `You are in a Texas Hold'em poker game.

YOUR HAND: ${myCards}
COMMUNITY CARDS: ${community}
PHASE: ${view.phase}
YOUR CHIPS: ${view.myChips}
YOUR CURRENT BET: ${view.myBet}
POT: ${potSize}
CURRENT BET TO MATCH: ${view.currentBet}
CALL AMOUNT: ${callAmount}
MIN RAISE TO: ${view.currentBet + minRaise}

OPPONENTS STILL IN:
${opponents}

RECENT ACTIONS:
${recentActions || "  (none)"}

VALID ACTIONS: ${validActions.join(", ")}

Respond with a JSON object (no markdown, just raw JSON):
{
  "action": "fold" | "check" | "call" | "raise",
  "amount": <number if raising, omit otherwise>,
  "thought": "<your inner monologue as your character, 1-2 sentences>",
  "confidence": <0.0-1.0>,
  "isBluffing": <true/false>
}`;
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({
      baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
    });
  }
  return client;
}

export async function claudeDecide(
  view: AgentGameView,
  personality: AgentPersonality,
  validActions: ActionType[],
  callAmount: number,
  minRaise: number
): Promise<AgentDecision> {
  const prompt = buildPrompt(view, validActions, callAmount, minRaise);

  try {
    const response = await getClient().messages.create({
      model: process.env.ANTHROPIC_MODEL || "ppio/pa/claude-opus-4-6",
      max_tokens: 300,
      system: personality.systemPrompt,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    const parsed = JSON.parse(jsonMatch[0]);
    const action = parsed.action as string;

    if (!validActions.includes(action as ActionType)) {
      throw new Error(`Invalid action: ${action}`);
    }

    return {
      action: {
        type: action as ActionType,
        amount: action === "raise" ? Math.max(parsed.amount ?? (view.currentBet + minRaise), view.currentBet + minRaise) : undefined,
      },
      thought: {
        message: parsed.thought ?? "...",
        confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.5)),
        isBluffing: parsed.isBluffing ?? false,
      },
    };
  } catch (error) {
    throw error;
  }
}
