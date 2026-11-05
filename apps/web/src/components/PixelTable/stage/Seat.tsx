"use client";

import { useCallback } from "react";
import { TextStyle, type Graphics } from "pixi.js";
import type { SeatState } from "../logic/types";
import { Avatar } from "./Avatar";
import { BetIndicator } from "./BetIndicator";
import { HoleCards } from "./HoleCards";
import { ChipsLabel } from "./ChipsLabel";
import { ThinkingHalo } from "../effects/ThinkingHalo";
import { EmojiBubble } from "../effects/EmojiBubble";
import { AllInFire } from "../effects/AllInFire";
import { WinCelebration } from "../effects/WinCelebration";

interface SeatProps {
  seat: SeatState;
  x: number;
  y: number;
  bubble?: string | null;
  isWinner?: boolean;
  isDealer?: boolean;
  towardX?: number;
  towardY?: number;
}

const AVATAR_SIZE = 32;

export function Seat({
  seat, x, y, bubble = null, isWinner = false, isDealer = false, towardX = 0, towardY = 1,
}: SeatProps) {
  const dim = seat.status === "folded" || seat.status === "out";
  const length = Math.hypot(towardX, towardY) || 1;
  const inwardX = (towardX / length) * 34;
  const inwardY = (towardY / length) * 34;
  return (
    <pixiContainer x={x} y={y} alpha={dim ? 0.45 : 1}>
      <EmojiBubble emoji={bubble} x={0} y={-AVATAR_SIZE / 2 - 22} />
      <BetIndicator amount={seat.currentBet} x={inwardX} y={inwardY} />
      {isDealer && <DealerButton x={inwardX * 0.45 - 16} y={inwardY * 0.45} />}
      <WinCelebration active={isWinner} radius={AVATAR_SIZE / 2} />
      <AllInFire active={seat.status === "all-in"} radius={AVATAR_SIZE / 2} />
      <ThinkingHalo active={seat.status === "thinking"} radius={AVATAR_SIZE / 2 + 3} />
      <Avatar emoji={seat.avatar || "🤖"} status={seat.status} x={0} y={0} size={AVATAR_SIZE} />
      {seat.holeCards && (
        <HoleCards cards={seat.holeCards} x={-inwardX * 0.55} y={-inwardY * 0.2} dim={dim} />
      )}
      <ChipsLabel name={seat.name} chips={seat.chips} x={0} y={AVATAR_SIZE / 2 + 8} dim={dim} />
    </pixiContainer>
  );
}

function DealerButton({ x, y }: { x: number; y: number }) {
  const draw = useCallback((g: Graphics) => {
    g.clear();
    g.circle(0, 0, 7).fill(0xf5f0e6).stroke({ color: 0x1c1c1e, width: 1 });
  }, []);
  return (
    <pixiContainer x={x} y={y}>
      <pixiGraphics draw={draw} />
      <pixiText
        text="D"
        anchor={0.5}
        style={new TextStyle({ fontFamily: "system-ui", fontSize: 9, fontWeight: "700", fill: 0x1c1c1e })}
      />
    </pixiContainer>
  );
}