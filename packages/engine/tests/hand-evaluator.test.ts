import { describe, expect, test } from "bun:test";
import { evaluateHand, compareHands } from "../src/hand-evaluator";
import type { Card, Suit } from "@cybercasino/shared";

function cards(...specs: string[]): Card[] {
  return specs.map((s) => {
    const suitChar = s[s.length - 1];
    const rankStr = s.slice(0, -1);
    const suitMap: Record<string, Suit> = { h: "h", d: "d", c: "c", s: "s" };
    const rankMap: Record<string, number> = {
      "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8,
      "9": 9, "10": 10, J: 11, Q: 12, K: 13, A: 14,
    };
    return { suit: suitMap[suitChar], rank: rankMap[rankStr] as Card["rank"] };
  });
}

describe("HandEvaluator", () => {
  test("detects royal flush", () => {
    const hand = evaluateHand(cards("Ah", "Kh", "Qh", "Jh", "10h"));
    expect(hand.rank).toBe("royal-flush");
  });

  test("detects straight flush", () => {
    const hand = evaluateHand(cards("9s", "8s", "7s", "6s", "5s"));
    expect(hand.rank).toBe("straight-flush");
  });

  test("detects four of a kind", () => {
    const hand = evaluateHand(cards("Ks", "Kh", "Kd", "Kc", "3s"));
    expect(hand.rank).toBe("four-of-a-kind");
  });

  test("detects full house", () => {
    const hand = evaluateHand(cards("Qs", "Qh", "Qd", "Jc", "Js"));
    expect(hand.rank).toBe("full-house");
  });

  test("detects flush", () => {
    const hand = evaluateHand(cards("Ad", "10d", "7d", "4d", "2d"));
    expect(hand.rank).toBe("flush");
  });

  test("detects straight", () => {
    const hand = evaluateHand(cards("9h", "8d", "7c", "6s", "5h"));
    expect(hand.rank).toBe("straight");
  });

  test("detects wheel straight (A-2-3-4-5)", () => {
    const hand = evaluateHand(cards("Ah", "2d", "3c", "4s", "5h"));
    expect(hand.rank).toBe("straight");
    expect(hand.name).toContain("5");
  });

  test("detects three of a kind", () => {
    const hand = evaluateHand(cards("7h", "7d", "7c", "Ks", "2h"));
    expect(hand.rank).toBe("three-of-a-kind");
  });

  test("detects two pair", () => {
    const hand = evaluateHand(cards("Ah", "Ad", "Kc", "Ks", "3h"));
    expect(hand.rank).toBe("two-pair");
  });

  test("detects pair", () => {
    const hand = evaluateHand(cards("Jh", "Jd", "9c", "5s", "2h"));
    expect(hand.rank).toBe("pair");
  });

  test("detects high card", () => {
    const hand = evaluateHand(cards("Ah", "Kd", "9c", "5s", "2h"));
    expect(hand.rank).toBe("high-card");
  });

  test("hand rankings are ordered correctly", () => {
    const royalFlush = evaluateHand(cards("Ah", "Kh", "Qh", "Jh", "10h"));
    const straightFlush = evaluateHand(cards("9s", "8s", "7s", "6s", "5s"));
    const fourKind = evaluateHand(cards("Ks", "Kh", "Kd", "Kc", "3s"));
    const fullHouse = evaluateHand(cards("Qs", "Qh", "Qd", "Jc", "Js"));
    const flush = evaluateHand(cards("Ad", "10d", "7d", "4d", "2d"));
    const straight = evaluateHand(cards("9h", "8d", "7c", "6s", "5h"));
    const threeKind = evaluateHand(cards("7h", "7d", "7c", "Ks", "2h"));
    const twoPair = evaluateHand(cards("Ah", "Ad", "Kc", "Ks", "3h"));
    const pair = evaluateHand(cards("Jh", "Jd", "9c", "5s", "2h"));
    const highCard = evaluateHand(cards("Ah", "Kd", "9c", "5s", "2h"));

    expect(compareHands(royalFlush, straightFlush)).toBeGreaterThan(0);
    expect(compareHands(straightFlush, fourKind)).toBeGreaterThan(0);
    expect(compareHands(fourKind, fullHouse)).toBeGreaterThan(0);
    expect(compareHands(fullHouse, flush)).toBeGreaterThan(0);
    expect(compareHands(flush, straight)).toBeGreaterThan(0);
    expect(compareHands(straight, threeKind)).toBeGreaterThan(0);
    expect(compareHands(threeKind, twoPair)).toBeGreaterThan(0);
    expect(compareHands(twoPair, pair)).toBeGreaterThan(0);
    expect(compareHands(pair, highCard)).toBeGreaterThan(0);
  });

  test("kicker matters for pairs", () => {
    const pairWithAceKicker = evaluateHand(cards("Jh", "Jd", "Ac", "5s", "2h"));
    const pairWithKingKicker = evaluateHand(cards("Jh", "Jd", "Kc", "5s", "2h"));
    expect(compareHands(pairWithAceKicker, pairWithKingKicker)).toBeGreaterThan(0);
  });

  test("higher pair beats lower pair", () => {
    const kings = evaluateHand(cards("Kh", "Kd", "9c", "5s", "2h"));
    const queens = evaluateHand(cards("Qh", "Qd", "9c", "5s", "2h"));
    expect(compareHands(kings, queens)).toBeGreaterThan(0);
  });

  test("equal hands tie (score = 0)", () => {
    const a = evaluateHand(cards("Ah", "Kd", "Qc", "Js", "9h"));
    const b = evaluateHand(cards("As", "Kc", "Qh", "Jd", "9s"));
    expect(compareHands(a, b)).toBe(0);
  });

  test("evaluates 7 cards (picks best 5)", () => {
    const hand = evaluateHand(cards("Ah", "Kh", "Qh", "Jh", "10h", "2d", "3c"));
    expect(hand.rank).toBe("royal-flush");
  });

  test("7-card hand: finds hidden flush", () => {
    const hand = evaluateHand(cards("Ad", "10d", "7d", "4d", "2d", "Ks", "Qh"));
    expect(hand.rank).toBe("flush");
  });

  test("ace-high flush beats king-high flush", () => {
    const aceFlush = evaluateHand(cards("Ad", "10d", "7d", "4d", "2d"));
    const kingFlush = evaluateHand(cards("Kd", "10d", "7d", "4d", "2d"));
    expect(compareHands(aceFlush, kingFlush)).toBeGreaterThan(0);
  });

  test("split pot: identical straights", () => {
    const a = evaluateHand(cards("9h", "8d", "7c", "6s", "5h"));
    const b = evaluateHand(cards("9c", "8h", "7d", "6h", "5s"));
    expect(compareHands(a, b)).toBe(0);
  });
});
