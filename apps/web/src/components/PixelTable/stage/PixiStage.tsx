"use client";

import { Application, extend } from "@pixi/react";
import { Container, Graphics, Sprite, Text } from "pixi.js";
import { type ReactNode } from "react";

extend({ Container, Graphics, Sprite, Text });

interface PixiStageProps {
  width: number;
  height: number;
  children?: ReactNode;
  background?: number;
}

export function PixiStage({ width, height, children, background = 0xf6f6f7 }: PixiStageProps) {
  return (
    <Application
      width={width}
      height={height}
      background={background}
      antialias={false}
      resolution={typeof window !== "undefined" ? window.devicePixelRatio : 1}
      autoDensity
    >
      {children}
    </Application>
  );
}