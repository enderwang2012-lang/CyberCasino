"use client";

import type { Card } from "@cybercasino/shared";
import { PlayingCard } from "./PlayingCard";

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
      <PlayingCard
        card={cards?.[0] ?? null}
        x={-(cardWidth + gap) / 2}
        y={0}
        width={cardWidth}
        faceDown={!cards}
      />
      <PlayingCard
        card={cards?.[1] ?? null}
        x={(cardWidth + gap) / 2}
        y={0}
        width={cardWidth}
        faceDown={!cards}
      />
    </pixiContainer>
  );
}