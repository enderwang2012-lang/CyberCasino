import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { GameEvent } from "@cybercasino/shared";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { Leaderboard } from "@/components/Leaderboard";

const roster = (id: string, name: string): GameEvent => ({
  type: "agent-roster",
  agents: [{ id, name, avatar: "🤖", type: "custom" }],
});

describe("Leaderboard", () => {
  it("uses the latest roster after a player replaces a preset", () => {
    const events: GameEvent[] = [
      {
        type: "agent-roster",
        agents: [{ id: "preset", name: "Dwan", avatar: "👻", type: "builtin" }],
      },
      {
        type: "hand-start",
        handNumber: 1,
        dealerSeatIndex: 0,
        players: [{
          id: "preset", name: "Dwan", avatar: "👻", chips: 5000,
          holeCards: null, bet: 0, folded: false, allIn: false, seatIndex: 0,
        }],
      },
      roster("hero", "小帅"),
      {
        type: "hand-complete",
        winners: [],
        players: [{
          id: "hero", name: "小帅", avatar: "🤖", chips: 5200,
          holeCards: null, bet: 0, folded: false, allIn: false, seatIndex: 0,
        }],
      },
    ];

    render(
      <LanguageProvider>
        <Leaderboard events={events} variant="stacks" />
      </LanguageProvider>,
    );

    expect(screen.getByText("小帅")).toBeInTheDocument();
    expect(screen.queryByText("Dwan")).not.toBeInTheDocument();
    expect(screen.getByText("5,200")).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
});
