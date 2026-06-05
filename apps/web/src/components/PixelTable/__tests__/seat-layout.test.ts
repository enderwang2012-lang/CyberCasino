import { describe, it, expect } from "vitest";
import { computeSeatPositions } from "../logic/seat-layout";

describe("computeSeatPositions", () => {
  const dim = { width: 300, height: 500, marginY: 30 };

  it("returns 6 positions", () => {
    const ps = computeSeatPositions(dim);
    expect(ps).toHaveLength(6);
  });

  it("seat 0 is above seat 5 (vertical ellipse)", () => {
    const ps = computeSeatPositions(dim);
    expect(ps[0].y).toBeLessThan(ps[5].y);
    expect(Math.abs(ps[0].x - ps[5].x)).toBeLessThan(1);  // same vertical
  });

  it("left seats x < right seats x", () => {
    const ps = computeSeatPositions(dim);
    expect(ps[1].x).toBeLessThan(ps[2].x);
    expect(ps[3].x).toBeLessThan(ps[4].x);
  });

  it("table center is at width/2", () => {
    const ps = computeSeatPositions(dim);
    expect(ps[0].x).toBeCloseTo(150, 0);
  });
});