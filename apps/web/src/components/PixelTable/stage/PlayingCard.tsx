"use client";

import { TextStyle, type Graphics } from "pixi.js";
import { useEffect, useRef, useState, useCallback } from "react";
import type { Card } from "@cybercasino/shared";

interface PlayingCardProps {
  card: Card | null;
  x: number;
  y: number;
  width: number;
  faceDown?: boolean;
}

const FLIP_MS = 300;

const FACE_STYLE = new TextStyle({ fontFamily: "ui-monospace", fontSize: 11, fontWeight: "700" });
const FACE_RED_STYLE = new TextStyle({ fontFamily: "ui-monospace", fontSize: 11, fontWeight: "700", fill: 0xc00020 });

function rankLabel(r: number): string {
  if (r === 14) return "A";
  if (r === 13) return "K";
  if (r === 12) return "Q";
  if (r === 11) return "J";
  return String(r);
}

const SUIT_GLYPH: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };
const RED_SUITS = new Set(["h", "d"]);

export function PlayingCard({ card, x, y, width, faceDown = false }: PlayingCardProps) {
  const height = Math.round(width * 1.4);
  const [progress, setProgress] = useState(card ? 1 : 0);
  const lastCard = useRef<Card | null>(null);
  const target = card && !faceDown ? 1 : 0;

  useEffect(() => {
    if (lastCard.current === card && progress === target) return;
    lastCard.current = card;
    const start = performance.now();
    const from = progress;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / FLIP_MS);
      setProgress(from + (target - from) * t);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [card, faceDown, target]);

  const scaleX = Math.abs(progress * 2 - 1);
  const showFront = progress >= 0.5;
  const isRed = card && RED_SUITS.has(card.suit);

  const drawBg = useCallback((g: Graphics) => {
    g.clear();
    if (showFront && card) {
      g.roundRect(-width / 2, -height / 2, width, height, 3)
        .fill(0xffffff)
        .stroke({ color: 0x222222, width: 0.5 });
    } else {
      g.roundRect(-width / 2, -height / 2, width, height, 3)
        .fill(0x3a3a8a)
        .stroke({ color: 0xffffff, width: 0.5 });
    }
  }, [card, showFront, width, height]);

  return (
    <pixiContainer x={x} y={y} scale={{ x: scaleX, y: 1 }}>
      <pixiGraphics draw={drawBg} />
      {showFront && card && (
        <>
          <pixiText
            text={rankLabel(card.rank)}
            anchor={{ x: 0, y: 0 }}
            x={-width / 2 + 2}
            y={-height / 2 + 2}
            style={isRed ? FACE_RED_STYLE : FACE_STYLE}
          />
          <pixiText
            text={SUIT_GLYPH[card.suit]}
            anchor={0.5}
            style={isRed ? FACE_RED_STYLE : FACE_STYLE}
          />
        </>
      )}
    </pixiContainer>
  );
}