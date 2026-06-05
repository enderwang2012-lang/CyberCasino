"use client";

import { TextStyle } from "pixi.js";
import { useEffect, useRef, useState } from "react";

interface ChipsLabelProps {
  name: string;
  chips: number;
  x: number;
  y: number;
  dim?: boolean;
}

const NAME_STYLE = new TextStyle({ fontFamily: "system-ui", fontSize: 9, fontWeight: "600" });
const CHIPS_STYLE = new TextStyle({ fontFamily: "ui-monospace", fontSize: 8, fill: 0x888888 });

const ROLL_MS = 300;

export function ChipsLabel({ name, chips, x, y, dim = false }: ChipsLabelProps) {
  const [display, setDisplay] = useState(chips);
  const fromRef = useRef(chips);

  useEffect(() => {
    if (chips === display) return;
    const start = performance.now();
    const from = fromRef.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ROLL_MS);
      const ease = 1 - (1 - t) * (1 - t);
      setDisplay(Math.round(from + (chips - from) * ease));
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = chips;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [chips]);

  return (
    <pixiContainer x={x} y={y} alpha={dim ? 0.5 : 1}>
      <pixiText text={name} anchor={{ x: 0.5, y: 0 }} style={NAME_STYLE} />
      <pixiText text={`$${display.toLocaleString()}`} anchor={{ x: 0.5, y: 0 }} y={11} style={CHIPS_STYLE} />
    </pixiContainer>
  );
}