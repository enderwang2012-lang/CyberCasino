"use client";

import { TextStyle, type Graphics } from "pixi.js";
import { useCallback } from "react";

interface PotDisplayProps {
  amount: number;
  x: number;
  y: number;
  flash?: boolean;
}

const POT_STYLE = new TextStyle({
  fontFamily: "ui-monospace, SFMono-Regular, monospace",
  fontSize: 13,
  fontWeight: "600",
  fill: 0xffd700,
});

export function PotDisplay({ amount, x, y, flash = false }: PotDisplayProps) {
  const text = `💰 POT $${amount.toLocaleString()}`;
  const draw = useCallback((g: Graphics) => {
    g.clear();
    const color = flash ? 0xff3355 : 0x000000;
    const alpha = 0.7;
    g.roundRect(-60, -12, 120, 24, 12).fill({ color, alpha });
  }, [flash]);

  return (
    <pixiContainer x={x} y={y}>
      <pixiGraphics draw={draw} />
      <pixiText text={text} anchor={0.5} style={POT_STYLE} />
    </pixiContainer>
  );
}