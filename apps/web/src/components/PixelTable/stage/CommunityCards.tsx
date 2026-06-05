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