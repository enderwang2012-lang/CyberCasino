"use client";

import type { SeatState } from "../logic/types";
import { Avatar } from "./Avatar";
import { BetIndicator } from "./BetIndicator";
import { HoleCards } from "./HoleCards";
import { ChipsLabel } from "./ChipsLabel";

interface SeatProps {
  seat: SeatState;
  x: number;
  y: number;
}

const AVATAR_SIZE = 32;

export function Seat({ seat, x, y }: SeatProps) {
  const dim = seat.status === "folded" || seat.status === "out";
  return (
    <pixiContainer x={x} y={y}>
      {/* 下注金额标签 */}
      <BetIndicator amount={seat.currentBet} x={0} y={-AVATAR_SIZE / 2 - 16} />
      {/* 头像 */}
      <Avatar emoji={seat.avatar || "🤖"} status={seat.status} x={0} y={0} size={AVATAR_SIZE} />
      {/* 手牌 */}
      <HoleCards cards={seat.holeCards} x={0} y={AVATAR_SIZE / 2 + 12} dim={dim} />
      {/* 昵称 + 筹码 */}
      <ChipsLabel name={seat.name} chips={seat.chips} x={0} y={AVATAR_SIZE / 2 + 24} dim={dim} />
    </pixiContainer>
  );
}