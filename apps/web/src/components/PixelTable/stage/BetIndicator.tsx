"use client";

import { TextStyle, type Graphics } from "pixi.js";
import { useCallback } from "react";

interface BetIndicatorProps {
  amount: number;
  x: number;
  y: number;
}

const STYLE = new TextStyle({
  fontFamily: "ui-monospace",
  fontSize: 9,
  fontWeight: "700",
  fill: 0xaa0033,
});

export function BetIndicator({ amount, x, y }: BetIndicatorProps) {
  if (amount <= 0) return null;
  const text = `⬆ $${amount.toLocaleString()}`;
  const pad = 4;
  const draw = useCallback((g: Graphics) => {
    g.clear();
    const w = text.length * 6 + pad * 2;
    g.roundRect(-w / 2, -8, w, 16, 8)
      .fill(0xffffff)
      .stroke({ color: 0xff5577, width: 1 });
  }, [text]);

  return (
    <pixiContainer x={x} y={y}>
      <pixiGraphics draw={draw} />
      <pixiText text={text} anchor={0.5} style={STYLE} />
    </pixiContainer>
  );
}