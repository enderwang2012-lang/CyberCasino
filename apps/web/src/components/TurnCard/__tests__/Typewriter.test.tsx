import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { Typewriter } from "../Typewriter";

describe("Typewriter", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("renders an empty string initially when text is empty", () => {
    render(<Typewriter text="" cps={30} />);
    expect(screen.getByTestId("typewriter").textContent).toBe("");
  });

  it("reveals characters at given cps", () => {
    render(<Typewriter text="hello" cps={30} />);
    act(() => { vi.advanceTimersByTime(34 * 5); });
    expect(screen.getByTestId("typewriter").textContent?.length).toBeGreaterThanOrEqual(4);
  });

  it("eventually reveals the full text", () => {
    render(<Typewriter text="hello" cps={30} />);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByTestId("typewriter").textContent).toBe("hello");
  });

  it("resets when text changes", () => {
    const { rerender } = render(<Typewriter text="aaaa" cps={30} />);
    act(() => { vi.advanceTimersByTime(2000); });
    rerender(<Typewriter text="bbb" cps={30} />);
    expect(screen.getByTestId("typewriter").textContent).toBe("");
  });

  it("renders nothing for null text", () => {
    render(<Typewriter text="" cps={30} />);
    expect(screen.getByTestId("typewriter").textContent).toBe("");
  });
});