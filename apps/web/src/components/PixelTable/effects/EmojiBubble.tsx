"use client";

import { TextStyle, type Graphics } from "pixi.js";
import { useEffect, useState, useCallback } from "react";

interface EmojiBubbleProps {
  emoji: string | null;
  x: number;
  y: number;
}

const STAY_MS = 2000;
const POP_MS = 120;
const FADE_MS = 200;
const STYLE = new TextStyle({ fontFamily: "system-ui", fontSize: 13 });

type Phase = "popIn" | "stay" | "fadeOut" | "hidden";

export function EmojiBubble({ emoji, x, y }: EmojiBubbleProps) {
  const [phase, setPhase] = useState<Phase>("hidden");
  const [scale, setScale] = useState(0);
  const [alpha, setAlpha] = useState(1);
  const [shown, setShown] = useState<string | null>(null);

  useEffect(() => {
    if (!emoji) return;
    setShown(emoji);
    setPhase("popIn");
    const t1 = setTimeout(() => setPhase("stay"), POP_MS);
    const t2 = setTimeout(() => setPhase("fadeOut"), POP_MS + STAY_MS);
    const t3 = setTimeout(() => setPhase("hidden"), POP_MS + STAY_MS + FADE_MS);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [emoji]);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - start;
      if (phase === "popIn") {
        const t = Math.min(1, elapsed / POP_MS);
        setScale(t);
      } else if (phase === "fadeOut") {
        const t = Math.min(1, elapsed / FADE_MS);
        setAlpha(1 - t);
      } else if (phase === "stay") {
        setScale(1);
        setAlpha(1);
      } else if (phase === "hidden") {
        setScale(0);
        setAlpha(1);
        setShown(null);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  const drawBg = useCallback((g: Graphics) => {
    g.clear();
    g.roundRect(-12, -10, 24, 20, 6).fill(0xffffff).stroke({ color: 0x333333, width: 1 });
  }, []);

  if (!shown || phase === "hidden") return null;

  return (
    <pixiContainer x={x} y={y} scale={{ x: scale, y: scale }} alpha={alpha}>
      <pixiGraphics draw={drawBg} />
      <pixiText text={shown} anchor={0.5} style={STYLE} />
    </pixiContainer>
  );
}