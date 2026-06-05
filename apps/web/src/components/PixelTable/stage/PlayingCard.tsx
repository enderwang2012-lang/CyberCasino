"use client";

import { type Graphics } from "pixi.js";
import { useCallback } from "react";
import type { Card } from "@cybercasino/shared";

// Minimal placeholder — full flip animation added in Task 9
interface PlayingCardProps {
  card: Card | null;
  x: number;
  y: number;
  width: number;
  faceDown?: boolean;
}

export function PlayingCard({ card, x, y, width, faceDown = false }: PlayingCardProps) {
  const height = Math.round(width * 1.4);
  const showFront = card != null && !faceDown;

  const drawBg = useCallback((g: Graphics) => {
    g.clear();
    if (showFront) {
      g.roundRect(-width / 2, -height / 2, width, height, 3).fill(0xffffff).stroke({ color: 0x222222, width: 0.5 });
    } else {
      g.roundRect(-width / 2, -height / 2, width, height, 3).fill(0x3a3a8a).stroke({ color: 0xffffff, width: 0.5 });
    }
  }, [showFront, width, height]);

  return (
    <pixiContainer x={x} y={y}>
      <pixiGraphics draw={drawBg} />
    </pixiContainer>
  );
}