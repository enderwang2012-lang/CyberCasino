"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { type Graphics } from "pixi.js";

interface WinCelebrationProps {
  active: boolean;
  radius: number;
}

interface Coin {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

const COUNT = 30;
const LIFE_MS = 1500;

export function WinCelebration({ active, radius }: WinCelebrationProps) {
  const [coins, setCoins] = useState<Coin[]>([]);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!active) {
      startedRef.current = false;
      setCoins([]);
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;

    const seed: Coin[] = Array.from({ length: COUNT }, () => ({
      x: (Math.random() - 0.5) * radius,
      y: 0,
      vx: (Math.random() - 0.5) * 1.2,
      vy: -2 - Math.random() * 1.5,
      life: 0,
    }));
    setCoins(seed);

    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = (now - start) / LIFE_MS;
      if (t >= 1) { setCoins([]); return; }
      setCoins((prev) =>
        prev.map((c) => ({
          ...c,
          x: c.x + c.vx,
          y: c.y + c.vy + 0.06 * (now - start),
          life: t,
        })),
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, radius]);

  const draw = useCallback((g: Graphics) => {
    g.clear();
    // 冠光光环
    if (active) {
      g.circle(0, -radius - 8, 4).fill({ color: 0xffd700, alpha: 0.9 });
      g.poly([
        -8, -radius - 4,
        -4, -radius - 14,
        0,  -radius - 6,
        4,  -radius - 14,
        8,  -radius - 4,
      ]).fill({ color: 0xffd700, alpha: 0.9 });
    }
    // 金币粒子
    coins.forEach((c) => {
      const alpha = 1 - c.life;
      g.circle(c.x, c.y, 2).fill({ color: 0xffd700, alpha });
    });
  }, [active, coins, radius]);

  if (!active && coins.length === 0) return null;
  return <pixiGraphics draw={draw} />;
}