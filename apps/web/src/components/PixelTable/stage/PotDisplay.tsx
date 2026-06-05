"use client";

import { TextStyle, type Graphics } from "pixi.js";
import { useEffect, useState, useCallback } from "react";

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
  const [t, setT] = useState(0);

  useEffect(() => {
    if (!flash) { setT(0); return; }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const elapsed = (now - start) / 1500;
      if (elapsed >= 1) { setT(0); return; }
      setT(elapsed);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [flash]);

  // 3 次脉冲：sin(t * 3π) → 3 个峰，取绝对值
  const pulse = flash ? Math.abs(Math.sin(t * Math.PI * 3)) : 0;

  const text = `💰 POT $${amount.toLocaleString()}`;
  const draw = useCallback((g: Graphics) => {
    g.clear();
    const bgColor = pulse > 0.1 ? 0xff3355 : 0x000000;
    const alpha = 0.7 + 0.2 * pulse;
    g.roundRect(-60, -12, 120, 24, 12).fill({ color: bgColor, alpha });
  }, [pulse]);

  return (
    <pixiContainer x={x} y={y}>
      <pixiGraphics draw={draw} />
      <pixiText text={text} anchor={0.5} style={POT_STYLE} />
    </pixiContainer>
  );
}