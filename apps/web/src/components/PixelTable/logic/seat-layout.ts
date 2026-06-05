export interface StageDim {
  width: number;
  height: number;
  marginY?: number;
}

export interface SeatPosition {
  x: number;
  y: number;
}

export function computeSeatPositions({ width, height, marginY = 30 }: StageDim): SeatPosition[] {
  const cx = width / 2;
  const cy = height / 2;
  const rx = Math.min(width * 0.32, 110);
  const ry = Math.min(height * 0.34, 150);

  return [
    { x: cx, y: cy - ry - marginY },
    { x: cx - rx, y: cy - ry / 2.5 },
    { x: cx + rx, y: cy - ry / 2.5 },
    { x: cx - rx, y: cy + ry / 2.5 },
    { x: cx + rx, y: cy + ry / 2.5 },
    { x: cx, y: cy + ry + marginY },
  ];
}

export function computeTableEllipse({ width, height }: StageDim) {
  const cx = width / 2;
  const cy = height / 2;
  const rx = Math.min(width * 0.32, 110);
  const ry = Math.min(height * 0.34, 150);
  return { cx, cy, rx, ry };
}