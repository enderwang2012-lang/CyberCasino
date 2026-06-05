"use client";

import { TextStyle } from "pixi.js";

interface ChipsLabelProps {
  name: string;
  chips: number;
  x: number;
  y: number;
  dim?: boolean;
}

const NAME_STYLE = new TextStyle({ fontFamily: "system-ui", fontSize: 9, fontWeight: "600" });
const CHIPS_STYLE = new TextStyle({ fontFamily: "ui-monospace", fontSize: 8, fill: 0x888888 });

export function ChipsLabel({ name, chips, x, y, dim = false }: ChipsLabelProps) {
  return (
    <pixiContainer x={x} y={y} alpha={dim ? 0.5 : 1}>
      <pixiText text={name} anchor={{ x: 0.5, y: 0 }} style={NAME_STYLE} />
      <pixiText text={`$${chips.toLocaleString()}`} anchor={{ x: 0.5, y: 0 }} y={11} style={CHIPS_STYLE} />
    </pixiContainer>
  );
}