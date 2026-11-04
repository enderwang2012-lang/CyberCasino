import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AgentMatchSummary } from "@cybercasino/shared";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { AgentMatchHistory } from "@/components/AgentMatchHistory";

const match: AgentMatchSummary = {
  tableId: "table-history-1",
  tableName: "Arena #1",
  finishedAt: new Date("2026-11-02T12:00:00Z").getTime(),
  position: 2,
  totalPlayers: 6,
  handsPlayed: 18,
  totalHands: 24,
  strategyVersion: 4,
  replayAvailable: true,
};

describe("AgentMatchHistory", () => {
  it("opens the full replay using the match table id", async () => {
    const user = userEvent.setup();
    const onOpenReplay = vi.fn();

    render(
      <LanguageProvider>
        <AgentMatchHistory matches={[match]} onOpenReplay={onOpenReplay} />
      </LanguageProvider>,
    );

    expect(screen.getByText("第 2 名")).toBeInTheDocument();
    expect(screen.getByText("本场策略 v4")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "查看完整回放" }));
    expect(onOpenReplay).toHaveBeenCalledWith("table-history-1");
  });

  it("does not offer a replay action when the replay is unavailable", () => {
    render(
      <LanguageProvider>
        <AgentMatchHistory
          matches={[{ ...match, replayAvailable: false }]}
          onOpenReplay={vi.fn()}
        />
      </LanguageProvider>,
    );

    expect(screen.queryByRole("button", { name: "查看完整回放" })).not.toBeInTheDocument();
  });
});
