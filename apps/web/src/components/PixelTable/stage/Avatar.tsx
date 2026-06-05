"use client";

import { TextStyle, type Graphics } from "pixi.js";
import { useCallback } from "react";
import type { SeatStatus } from "../logic/types";

interface AvatarProps {
  emoji: string;
  status: SeatStatus;
  x: number;
  y: number;
  size?: number;
}

const EMOJI_STYLE = new TextStyle({ fontFamily: "system-ui", fontSize: 16 });

export function Avatar({ emoji, status, x, y, size = 32 }: AvatarProps) {
  const r = size / 2;

  const draw = useCallback((g: Graphics) => {
    g.clear();
    let fillColor = 0xffe0bd;
    let alpha = 1;
    if (status === "folded") alpha = 0.4;
    if (status === "out") fillColor = 0xbbbbbb;
    g.circle(0, 0, r).fill({ color: fillColor, alpha }).stroke({ color: 0x333333, width: 1.5 });
  }, [status, r]);

  const textAlpha = status === "folded" ? 0.4 : status === "out" ? 0.5 : 1;

  return (
    <pixiContainer x={x} y={y}>
      <pixiGraphics draw={draw} />
      <pixiText text={emoji} anchor={0.5} style={EMOJI_STYLE} alpha={textAlpha} />
    </pixiContainer>
  );
}