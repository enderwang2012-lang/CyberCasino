"use client";

import { Graphics } from "pixi.js";
import { useCallback } from "react";
import type { StageDim } from "../logic/seat-layout";
import { computeTableEllipse } from "../logic/seat-layout";

interface TableProps {
  dim: StageDim;
}

export function Table({ dim }: TableProps) {
  const { cx, cy, rx, ry } = computeTableEllipse(dim);

  const draw = useCallback((g: Graphics) => {
    g.clear();
    // 桌面阴影
    g.ellipse(cx, cy + 8, rx, ry).fill({ color: 0x1a4d2e, alpha: 0.35 });
    // 桌沿
    g.ellipse(cx, cy, rx + 4, ry + 4).fill(0x5a4a3a);
    // 桌面（低饱和绿）
    g.ellipse(cx, cy, rx, ry).fill(0x3d8b6a);
    // 内圈高光
    g.ellipse(cx, cy, rx - 12, ry - 12).stroke({ color: 0x4d9e7a, width: 1, alpha: 0.6 });
  }, [cx, cy, rx, ry]);

  return <pixiGraphics draw={draw} />;
}