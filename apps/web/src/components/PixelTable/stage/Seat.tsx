"use client";

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
}

const AVATAR_SIZE = 32;

export function Seat({ seat, x, y, bubble = null, isWinner = false }: SeatProps) {
  const dim = seat.status === "folded" || seat.status === "out";
  return (
    <pixiContainer x={x} y={y}>
      {/* 头顶 emoji 气泡 */}
      <EmojiBubble emoji={bubble} x={0} y={-AVATAR_SIZE / 2 - 30} />
      {/* 下注金额标签 */}
      <BetIndicator amount={seat.currentBet} x={0} y={-AVATAR_SIZE / 2 - 16} />
      {/* 赢家庆祝 */}
      <WinCelebration active={isWinner} radius={AVATAR_SIZE / 2} />
      {/* All-in 火焰粒子 */}
      <AllInFire active={seat.status === "all-in"} radius={AVATAR_SIZE / 2} />
      {/* 思考者金色脉冲 */}
      <ThinkingHalo active={seat.status === "thinking"} radius={AVATAR_SIZE / 2} />
      {/* 头像 */}
      <Avatar emoji={seat.avatar || "🤖"} status={seat.status} x={0} y={0} size={AVATAR_SIZE} />
      {/* 手牌 */}
      <HoleCards cards={seat.holeCards} x={0} y={AVATAR_SIZE / 2 + 12} dim={dim} />
      {/* 昵称 + 筹码 */}
      <ChipsLabel name={seat.name} chips={seat.chips} x={0} y={AVATAR_SIZE / 2 + 24} dim={dim} />
    </pixiContainer>
  );
}