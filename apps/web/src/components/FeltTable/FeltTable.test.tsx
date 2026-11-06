import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { GameEvent, PlayerState } from "@cybercasino/shared";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { FeltTable } from "./FeltTable";

const player = (id: string, name: string, seat: number, chips = 5000): PlayerState => ({
  id, name, avatar: "🤖", chips, holeCards: null, bet: 0, folded: false, allIn: false, seatIndex: seat,
});

describe("FeltTable", () => {
  it("shows the pot, the actor, and face-up cards only after showdown", () => {
    const events: GameEvent[] = [
      {
        type: "hand-start",
        handNumber: 3,
        dealerSeatIndex: 0,
        players: [player("hero", "小帅", 5, 4800), player("preset", "Dwan", 0, 5200)],
      },
      {
        type: "blinds-posted",
        smallBlindPlayerId: "preset",
        bigBlindPlayerId: "hero",
        smallBlind: 50,
        bigBlind: 100,
      },
      {
        type: "action-taken",
        playerId: "preset",
        action: { type: "raise", amount: 300 },
        thought: { message: "先走", confidence: 0.4, isBluffing: false, thinkingSource: "strategy" },
      },
      {
        type: "action-required",
        playerId: "hero",
        validActions: ["fold", "call", "raise"],
        currentBet: 300,
        minRaise: 100,
        callAmount: 200,
      },
    ];

    const { rerender } = render(
      <LanguageProvider>
        <FeltTable events={events} />
      </LanguageProvider>,
    );

    expect(screen.getByText("底池")).toBeInTheDocument();
    expect(screen.getAllByText("小帅").length).toBeGreaterThan(1);
    expect(screen.getByText("思考中")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "正在思考" })).toBeInTheDocument();
    expect(screen.queryByText("先走")).not.toBeInTheDocument();
    expect(screen.getByText("D")).toBeInTheDocument();
    expect(screen.queryByText("A")).not.toBeInTheDocument();

    rerender(
      <LanguageProvider>
        <FeltTable events={[
          ...events,
          {
            type: "ai:thought",
            playerId: "hero",
            thought: { message: "牌面够强", confidence: 0.7, isBluffing: false, thinkingSource: "strategy" },
            action: { type: "call" },
          },
        ]} />
      </LanguageProvider>,
    );

    expect(screen.getByText("思考中")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "正在思考" })).not.toBeInTheDocument();
    expect(screen.getByText("牌面够强")).toBeInTheDocument();
    expect(screen.queryByText("先走")).not.toBeInTheDocument();
    expect(screen.queryByText(/跟注/)).not.toBeInTheDocument();

    rerender(
      <LanguageProvider>
        <FeltTable events={[
          ...events,
          {
            type: "showdown",
            results: [{
              playerId: "hero",
              holeCards: [{ rank: 14, suit: "h" }, { rank: 13, suit: "d" }],
              bestHand: [],
              handRank: "pair",
              handName: "Pair",
            }],
          },
        ]} />
      </LanguageProvider>,
    );

    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText(/摊牌/)).toBeInTheDocument();
    expect(screen.getByText("盲注 100")).toBeInTheDocument();
  });

  it("shows every dealt hole card on the live table, including a folded hand", () => {
    const events: GameEvent[] = [
      {
        type: "hand-start",
        handNumber: 8,
        dealerSeatIndex: 0,
        players: [player("hero", "小帅", 5), player("preset", "Dwan", 0)],
      },
      {
        type: "cards-dealt",
        hands: {
          hero: [{ rank: 14, suit: "h" }, { rank: 13, suit: "d" }],
          preset: [{ rank: 7, suit: "c" }, { rank: 2, suit: "s" }],
        },
      },
      {
        type: "action-taken",
        playerId: "preset",
        action: { type: "fold" },
        thought: { message: "走了", confidence: 0.4, isBluffing: false, thinkingSource: "strategy" },
      },
    ];

    render(
      <LanguageProvider>
        <FeltTable events={events} />
      </LanguageProvider>,
    );

    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("K")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("弃牌")).toBeInTheDocument();
  });

  it("uses text for fold and all-in, and drops a finished street's raise", () => {
    const thought = { message: "go", confidence: 0.5, isBluffing: false, thinkingSource: "strategy" as const };
    const events: GameEvent[] = [
      {
        type: "hand-start",
        handNumber: 4,
        dealerSeatIndex: 0,
        players: [player("folded", "Sashimi", 1, 2000), player("shover", "盖哥", 2, 300), player("winner", "小帅", 5, 4000)],
      },
      { type: "action-taken", playerId: "folded", action: { type: "fold" }, thought },
      { type: "action-taken", playerId: "shover", action: { type: "raise", amount: 300 }, allIn: true, thought },
      { type: "action-taken", playerId: "winner", action: { type: "call" }, thought },
      { type: "phase-change", phase: "flop", communityCards: [{ rank: 2, suit: "s" }, { rank: 6, suit: "s" }, { rank: 2, suit: "c" }] },
      { type: "hand-complete", winners: [{ playerId: "winner", amount: 800, potIndex: 0 }], players: [] },
    ];

    render(
      <LanguageProvider>
        <FeltTable events={events} />
      </LanguageProvider>,
    );

    expect(screen.getByText("弃牌")).toBeInTheDocument();
    expect(screen.getByText("全下 300")).toBeInTheDocument();
    expect(screen.getByText("赢得 800")).toBeInTheDocument();
    expect(screen.queryByText(/加注/)).not.toBeInTheDocument();
    expect(screen.queryByText(/跟注/)).not.toBeInTheDocument();
  });
});
