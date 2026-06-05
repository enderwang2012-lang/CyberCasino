import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";

vi.mock("@pixi/react", () => ({
  extend: () => {},
  Application: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "pixi-app" }, children),
}));

import { PixiStage } from "../stage/PixiStage";

describe("PixiStage", () => {
  it("renders an Application root", () => {
    render(
      React.createElement(
        PixiStage,
        { width: 300, height: 400 },
        React.createElement("div", { "data-testid": "child" }, "child"),
      ),
    );
    expect(screen.getByTestId("pixi-app")).toBeInTheDocument();
  });
});