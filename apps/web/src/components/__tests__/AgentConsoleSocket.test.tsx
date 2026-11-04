import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentArenaSummary, MatchmakingState } from "@cybercasino/shared";
import { useSocket } from "@/hooks/useSocket";

const transport = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => void>(),
  emit: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("socket.io-client", () => ({
  io: () => ({
    on: (name: string, handler: (...args: any[]) => void) => transport.handlers.set(name, handler),
    emit: transport.emit,
    disconnect: transport.disconnect,
  }),
}));

const idle: MatchmakingState = {
  queue: "ranked-default", status: "idle", queueSize: 0, requiredPlayers: 6, autoRequeue: false,
};
const initial: AgentArenaSummary = {
  agent: {
    id: "atlas", userId: "github:test", name: "Atlas", avatar: "A",
    strategy: { preflop: {} as any, postflop: [] },
    strategyVersion: 2, executionMode: "remote_agent", createdAt: 1, updatedAt: 1,
  },
  currentMatch: idle,
  recentMatches: [],
};

function receive(name: string, value?: unknown) {
  act(() => transport.handlers.get(name)?.(value));
}

describe("Agent console socket refresh", () => {
  beforeEach(() => {
    transport.handlers.clear();
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      ok: true,
      json: async () => url.includes("/auth/token") ? { token: null } : initial,
    })));
  });

  it("keeps newer matchmaking state while a summary request is in flight", async () => {
    const { result } = renderHook(() => useSocket("github:test"));
    await waitFor(() => expect(result.current.agentSummary?.agent?.id).toBe("atlas"));
    let resolve!: (response: Response | PromiseLike<Response>) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((done) => { resolve = done; }) as Promise<Response>);
    let pending!: Promise<void>;
    act(() => { pending = result.current.refreshAgentSummary(); });
    const playing: MatchmakingState = { ...idle, status: "playing", tableId: "new-match", autoRequeue: true };
    receive("matchmaking:state", playing);
    await act(async () => {
      resolve({ ok: true, json: async () => initial } as Response);
      await pending;
    });
    expect(result.current.agentSummary?.currentMatch.status).toBe("playing");
    expect(result.current.agentSummary?.currentMatch.tableId).toBe("new-match");
  });

  it("refreshes history and summary after a lobby archive broadcast", async () => {
    const { result } = renderHook(() => useSocket("github:test"));
    await waitFor(() => expect(result.current.agentSummary).not.toBeNull());
    const completed = {
      ...initial,
      recentMatches: [{
        tableId: "done", tableName: "Finished", position: 1, totalPlayers: 6,
        handsPlayed: 20, totalHands: 20, replayAvailable: true,
      }],
    };
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => completed } as Response);
    transport.emit.mockClear();
    receive("lobby:tables", []);
    await waitFor(() => expect(result.current.agentSummary?.recentMatches[0]?.tableId).toBe("done"));
    expect(transport.emit).toHaveBeenCalledWith("table:history");
  });

  it("retains the Agent on HTTP failure and exposes a retryable error", async () => {
    const { result } = renderHook(() => useSocket("github:test"));
    await waitFor(() => expect(result.current.agentSummary?.agent?.id).toBe("atlas"));
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
    await act(async () => { await result.current.refreshAgentSummary(); });
    expect(result.current.agentSummary?.agent?.id).toBe("atlas");
    expect(result.current.agentSummaryError).toBe(true);
    await act(async () => { await result.current.refreshAgentSummary(); });
    expect(result.current.agentSummaryError).toBe(false);
  });

  it("keeps a matchmaking error visible when the server follows it with state", async () => {
    const { result } = renderHook(() => useSocket("github:test"));
    await waitFor(() => expect(transport.handlers.has("matchmaking:error")).toBe(true));
    const error = { code: "match_start_failed", message: "Match start failed" };
    const playing: MatchmakingState = { ...idle, status: "playing", tableId: "table-1", autoRequeue: true };
    receive("matchmaking:error", error);
    receive("matchmaking:state", playing);
    expect(result.current.matchmakingError).toEqual(error);
    expect(result.current.matchmakingState.tableId).toBe("table-1");
  });

  it("uses leave for stop-after-current and refreshes all console sources on completion", async () => {
    const { result } = renderHook(() => useSocket("github:test"));
    await waitFor(() => expect(transport.handlers.has("game:event")).toBe(true));
    act(() => result.current.leaveMatchmaking());
    expect(transport.emit).toHaveBeenCalledWith("matchmaking:leave");
    transport.emit.mockClear();
    receive("game:event", { type: "tournament-complete", rankings: [] });
    await waitFor(() => expect(transport.emit).toHaveBeenCalledWith("lobby:join"));
    expect(transport.emit).toHaveBeenCalledWith("table:history");
    expect(transport.emit).toHaveBeenCalledWith("matchmaking:status");
    await waitFor(() => expect(result.current.agentSummaryLoading).toBe(false));
  });

  it("coalesces a burst of lobby broadcasts into one round of refreshes", async () => {
    const { result } = renderHook(() => useSocket("github:test"));
    await waitFor(() => expect(result.current.agentSummaryLoading).toBe(false));
    await waitFor(() => expect(transport.handlers.has("lobby:tables")).toBe(true));
    vi.mocked(fetch).mockClear();
    transport.emit.mockClear();
    for (let i = 0; i < 5; i++) receive("lobby:tables", []);
    receive("game:event", { type: "tournament-complete", rankings: [] });
    await waitFor(() => expect(transport.emit).toHaveBeenCalledWith("matchmaking:status"));
    await waitFor(() => expect(result.current.agentSummaryLoading).toBe(false));
    const emitted = transport.emit.mock.calls.map(([name]) => name);
    expect(emitted.filter((name) => name === "table:history")).toHaveLength(1);
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/api/agents/summary")))
      .toHaveLength(1);
  });

  it("preserves error followed by the same state, then clears it on a successful match", async () => {
    const { result } = renderHook(() => useSocket("github:test"));
    await waitFor(() => expect(result.current.agentSummaryLoading).toBe(false));
    await act(async () => {
      receive("matchmaking:state", idle);
      receive("matchmaking:error", { code: "match_start_failed", message: "Start failed" });
      receive("matchmaking:state", idle);
    });
    expect(result.current.matchmakingError?.message).toBe("Start failed");
    await act(async () => {
      receive("matchmaking:matched", { tableId: "new-match", agentId: "atlas" });
    });
    expect(result.current.matchmakingError).toBeNull();
    expect(result.current.matchedTableId).toBe("new-match");
  });
});
