import type { Card, Suit, Rank } from "@cybercasino/shared";

const SUITS: Suit[] = ["h", "d", "c", "s"];
const RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export class Deck {
  private cards: Card[] = [];

  constructor() {
    this.reset();
  }

  reset(): void {
    this.cards = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        this.cards.push({ suit, rank });
      }
    }
    this.shuffle();
  }

  shuffle(): void {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  deal(count: number = 1): Card[] {
    if (this.cards.length < count) {
      throw new Error(`Not enough cards: need ${count}, have ${this.cards.length}`);
    }
    return this.cards.splice(0, count);
  }

  get remaining(): number {
    return this.cards.length;
  }
}
