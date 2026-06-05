import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createBubbleScheduler } from "../logic/animation-scheduler";

describe("createBubbleScheduler", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("emits immediately for first request", () => {
    const cb = vi.fn();
    const s = createBubbleScheduler(800, cb);
    s.request("p1", "🔥");
    expect(cb).toHaveBeenCalledWith("p1", "🔥");
  });

  it("queues second request within guard period", () => {
    const cb = vi.fn();
    const s = createBubbleScheduler(800, cb);
    s.request("p1", "🔥");
    s.request("p1", "💪");
    expect(cb).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(800);
    expect(cb).toHaveBeenCalledWith("p1", "💪");
  });

  it("emits immediately if requests are for different players", () => {
    const cb = vi.fn();
    const s = createBubbleScheduler(800, cb);
    s.request("p1", "🔥");
    s.request("p2", "😅");
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("collapses queued bursts (only keeps the last per player)", () => {
    const cb = vi.fn();
    const s = createBubbleScheduler(800, cb);
    s.request("p1", "🔥");   // emit immediately
    s.request("p1", "💪");   // queue
    s.request("p1", "⚡");   // replace queued
    vi.advanceTimersByTime(800);
    expect(cb).toHaveBeenLastCalledWith("p1", "⚡");
    expect(cb).toHaveBeenCalledTimes(2);
  });
});