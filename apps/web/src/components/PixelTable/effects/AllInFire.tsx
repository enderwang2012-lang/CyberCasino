"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { type Graphics } from "pixi.js";

interface AllInFireProps {
  active: boolean;
  radius: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
}

const PARTICLE_COUNT = 30;
const LIFE_MS = 1500;

export function AllInFire({ active, radius }: AllInFireProps) {
  const [particles, setParticles] = useState<Particle[]>([]);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!active) {
      startedRef.current = false;
      setParticles([]);
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;

    const seed: Particle[] = Array.from({ length: PARTICLE_COUNT }, () => ({
      x: (Math.random() - 0.5) * radius * 1.4,
      y: (Math.random() - 0.5) * 4,
      vx: (Math.random() - 0.5) * 0.4,
      vy: -0.6 - Math.random() * 0.8,
      life: 0,
      size: 2 + Math.random() * 3,
    }));
    setParticles(seed);

    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = (now - start) / LIFE_MS;
      if (t >= 1) {
        setParticles([]);
        return;
      }
      setParticles((prev) =>
        prev.map((p) => ({
          ...p,
          x: p.x + p.vx,
          y: p.y + p.vy,
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
    particles.forEach((p) => {
      const alpha = 1 - p.life;
      const color = p.life < 0.3 ? 0xffaa00 : p.life < 0.7 ? 0xff5520 : 0x442222;
      g.circle(p.x, p.y, p.size * (1 - p.life * 0.5)).fill({ color, alpha });
    });
  }, [particles]);

  if (!active && particles.length === 0) return null;
  return <pixiGraphics draw={draw} />;
}