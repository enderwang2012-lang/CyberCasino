"use client";

import { useEffect, useState } from "react";
import { type Graphics } from "pixi.js";

interface ThinkingHaloProps {
  active: boolean;
  radius: number;
}

export function ThinkingHalo({ active, radius }: ThinkingHaloProps) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      setPhase(((now - start) / 1400) % 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  if (!active) return null;

  const alpha = 0.4 + 0.4 * Math.sin(phase * Math.PI * 2);
  const expand = 2 + 2 * Math.sin(phase * Math.PI * 2);

  return (
    <pixiGraphics
      draw={(g: Graphics) => {
        g.clear();
        g.circle(0, 0, radius + expand).stroke({ color: 0xffd700, width: 2.5, alpha });
      }}
    />
  );
}