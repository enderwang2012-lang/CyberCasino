import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { AgentArenaSummary, TableInfo } from "@cybercasino/shared";
import Home from "@/app/page";
import { useSocket } from "@/hooks/useSocket";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { HeaderProvider } from "@/contexts/HeaderContext";
import type { TableView } from "@/components/TableView";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ loading: false, user: { userId: "user-1", name: "User", avatar: "U", provider: "github" } }),
}));
vi.mock("@/hooks/useSocket", () => ({ useSocket: vi.fn() }));
// The canvas renderer is outside the page routing contract. Preserve state to
// detect a missing table key when matchmaking switches directly between tables.
vi.mock("@/components/TableView", async () => {
  const { useState } = await import("react");
  return {
    TableView: (props: ComponentProps<typeof TableView>) => {
      const [mountedTable] = useState(props.tableId);
      return <div>
        <span>{props.tableName}</span>
        <span>{props.isFinished ? "finished" : "live"}</span>
        <span>mounted:{mountedTable}</span>
        <button onClick={props.onLeave}>Return to console</button>
      </div>;
    },
  };
});

const summary: AgentArenaSummary = {
  agent: {
    id: "atlas", userId: "user-1", name: "Atlas", avatar: "A",
    strategy: { preflop: {} as any, postflop: [] }, createdAt: 1, updatedAt: 1,
  },
  currentMatch: { queue: "ranked-default", status: "idle", queueSize: 0, requiredPlayers: 6, autoRequeue: false },
  recentMatches: [{
    tableId: "archived", tableName: "Old Arena", position: 2, totalPlayers: 6,
    handsPlayed: 19, totalHands: 20, strategyVersion: 3, replayAvailable: true,
  }],
};

let socket: ReturnType<typeof useSocket>;
function page() {
  return <LanguageProvider><HeaderProvider><Home /></HeaderProvider></LanguageProvider>;
}

describe("Agent console page routing", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ agent: summary.agent, standings: [] }) }));
    socket = {
      connected: true, tables: [], events: [], userId: "user-1", tableError: null,
      tableStarted: null, seatUpdates: null, personalities: [], historyTables: [], deletedAgentId: null,
      matchmakingState: summary.currentMatch, matchmakingError: null, matchedTableId: null,
      agentSummary: summary, agentSummaryLoading: false, agentSummaryError: false,
      joinTable: vi.fn(), leaveTable: vi.fn(), sitAtTable: vi.fn(), sitBuiltin: vi.fn(),
      removeSeat: vi.fn(), clearSeats: vi.fn(), startGame: vi.fn(), getHistory: vi.fn(),
      refreshLobby: vi.fn(), joinMatchmaking: vi.fn(), leaveMatchmaking: vi.fn(),
      refreshMatchmaking: vi.fn(), refreshAgentSummary: vi.fn().mockResolvedValue(undefined),
      clearMatchedTable: vi.fn(), clearTableError: vi.fn(), deleteAgent: vi.fn(),
    };
    vi.mocked(useSocket).mockImplementation(() => socket);
  });

  it("opens a recent replay absent from both table lists as finished and refreshes on return", async () => {
    const user = userEvent.setup();
    render(page());
    await user.click(screen.getByRole("button", { name: "查看完整回放" }));
    expect(socket.joinTable).toHaveBeenCalledWith("archived");
    expect(screen.getByText("finished")).toBeInTheDocument();
    expect(screen.getByText("Old Arena")).toBeInTheDocument();
    vi.mocked(socket.refreshLobby).mockClear();
    vi.mocked(socket.refreshAgentSummary).mockClear();
    vi.mocked(socket.getHistory).mockClear();
    vi.mocked(socket.refreshMatchmaking).mockClear();
    await user.click(screen.getByRole("button", { name: "Return to console" }));
    expect(socket.leaveTable).toHaveBeenCalledWith("archived");
    expect(socket.refreshLobby).toHaveBeenCalled();
    expect(socket.refreshAgentSummary).toHaveBeenCalled();
    expect(socket.getHistory).toHaveBeenCalled();
    expect(socket.refreshMatchmaking).toHaveBeenCalled();
  });

  it("resets table-local state when the next match is announced", async () => {
    socket.matchedTableId = "match-a";
    vi.mocked(socket.clearMatchedTable).mockImplementation(() => { socket.matchedTableId = null; });
    const view = render(page());
    expect(screen.getByText("mounted:match-a")).toBeInTheDocument();
    socket.matchedTableId = "match-b";
    await act(async () => view.rerender(page()));
    expect(screen.getByText("mounted:match-b")).toBeInTheDocument();
    expect(socket.leaveTable).toHaveBeenCalledWith("match-a");
    expect(screen.getByText("live")).toBeInTheDocument();
  });

  it("opens a history table absent from active tables as finished", async () => {
    socket.historyTables = [{
      id: "history-only", name: "Historical Arena", status: "finished",
      seats: [], handNumber: 20, playerCount: 6,
      config: { name: "Historical Arena", mode: "ranked", smallBlind: 10, bigBlind: 20, startingChips: 1000, maxPlayers: 6 },
    } satisfies TableInfo];
    render(page());
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /历史牌局/ }));
    await user.click(screen.getByRole("button", { name: /Historical Arena/ }));
    expect(screen.getByText("finished")).toBeInTheDocument();
    expect(screen.getByText("Historical Arena")).toBeInTheDocument();
  });

  it("refreshes summary when returning from Agent management", async () => {
    render(page());
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "管理 Agent" }));
    await waitFor(() => expect(screen.getByText("我的 AI 牌手")).toBeInTheDocument());
    vi.mocked(socket.refreshAgentSummary).mockClear();
    await user.click(screen.getByRole("button", { name: /返回/ }));
    expect(socket.refreshAgentSummary).toHaveBeenCalled();
  });

  it("polls only summary while the console is visible and cleans up on navigation and unmount", async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const rendered = render(page());
    await act(async () => {});
    vi.mocked(socket.refreshAgentSummary).mockClear();
    vi.mocked(socket.getHistory).mockClear();
    vi.mocked(socket.refreshLobby).mockClear();
    vi.mocked(socket.refreshMatchmaking).mockClear();

    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(socket.refreshAgentSummary).toHaveBeenCalledTimes(1);
    expect(socket.getHistory).not.toHaveBeenCalled();
    expect(socket.refreshLobby).not.toHaveBeenCalled();
    expect(socket.refreshMatchmaking).not.toHaveBeenCalled();

    visibility.mockReturnValue("hidden");
    fireEvent(document, new Event("visibilitychange"));
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(socket.refreshAgentSummary).toHaveBeenCalledTimes(1);

    visibility.mockReturnValue("visible");
    await act(async () => { fireEvent(document, new Event("visibilitychange")); });
    const resumedCalls = vi.mocked(socket.refreshAgentSummary).mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(socket.refreshAgentSummary).toHaveBeenCalledTimes(resumedCalls + 1);

    fireEvent.click(screen.getByRole("button", { name: /历史牌局/ }));
    vi.mocked(socket.refreshAgentSummary).mockClear();
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(socket.refreshAgentSummary).not.toHaveBeenCalled();

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /返回/ })); });
    vi.mocked(socket.refreshAgentSummary).mockClear();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(socket.refreshAgentSummary).toHaveBeenCalledTimes(1);
    rendered.unmount();
    vi.mocked(socket.refreshAgentSummary).mockClear();
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(socket.refreshAgentSummary).not.toHaveBeenCalled();
  });

  it("does not overlap slow periodic summary requests and resumes polling after completion", async () => {
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    render(page());
    await act(async () => {});
    let finish!: () => void;
    vi.mocked(socket.refreshAgentSummary).mockClear().mockImplementationOnce(
      () => new Promise<void>((resolve) => { finish = resolve; }),
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(socket.refreshAgentSummary).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(socket.refreshAgentSummary).toHaveBeenCalledTimes(2);
  });
});
