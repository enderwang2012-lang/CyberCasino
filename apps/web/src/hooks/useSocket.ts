"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import type {
  GameEvent,
  TableInfo,
  ServerToClientEvents,
  ClientToServerEvents,
  UserIdentity,
  TableSeat,
  BuiltinPersonalityInfo,
  MatchmakingState,
  MatchmakingError,
  AgentArenaSummary,
} from "@cybercasino/shared";

function getServerUrl() {
  if (process.env.NEXT_PUBLIC_SERVER_URL) {
    const url = process.env.NEXT_PUBLIC_SERVER_URL;
    return url.startsWith("http") ? url : `https://${url}`;
  }
  return "http://localhost:3001";
}

async function fetchJwtToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/token", { credentials: "include" });
    if (!res.ok) return null;
    const data = await res.json();
    return data.token ?? null;
  } catch {
    return null;
  }
}

export function useSocket(
  oauthUserId: string | undefined,
  oauthUserInfo?: { name: string; avatar: string; provider: string },
) {
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const [connected, setConnected] = useState(false);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [tableError, setTableError] = useState<string | null>(null);
  const [tableStarted, setTableStarted] = useState<string | null>(null);
  const [seatUpdates, setSeatUpdates] = useState<{ tableId: string; seats: TableSeat[] } | null>(null);
  const [personalities, setPersonalities] = useState<BuiltinPersonalityInfo[]>([]);
  const [historyTables, setHistoryTables] = useState<TableInfo[]>([]);
  const [deletedAgentId, setDeletedAgentId] = useState<string | null>(null);
  const [matchmakingState, setMatchmakingState] = useState<MatchmakingState>({
    queue: "ranked-default",
    status: "idle",
    queueSize: 0,
    requiredPlayers: 6,
    autoRequeue: false,
  });
  const [matchmakingError, setMatchmakingError] = useState<MatchmakingError | null>(null);
  const [matchedTableId, setMatchedTableId] = useState<string | null>(null);
  const [agentSummary, setAgentSummary] = useState<AgentArenaSummary | null>(null);
  const [agentSummaryLoading, setAgentSummaryLoading] = useState(false);
  const [agentSummaryError, setAgentSummaryError] = useState(false);
  const summaryRequest = useRef(0);
  const liveMatch = useRef<MatchmakingState | null>(null);
  const watchedTable = useRef<string | null>(null);

  const refreshAgentSummary = useCallback(async () => {
    if (!oauthUserId) {
      setAgentSummary(null);
      return;
    }

    const request = ++summaryRequest.current;
    setAgentSummaryLoading(true);
    try {
      const response = await fetch(`/api/agents/summary?userId=${encodeURIComponent(oauthUserId)}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Summary request failed");
      const data = await response.json() as AgentArenaSummary;
      if (request !== summaryRequest.current) return;
      const currentMatch = liveMatch.current ?? data.currentMatch;
      setAgentSummary({
        ...data,
        currentMatch,
        currentMatchStrategyVersion: currentMatch.tableId === data.currentMatch.tableId
          ? data.currentMatchStrategyVersion : undefined,
      });
      setAgentSummaryError(false);
    } catch {
      if (request === summaryRequest.current) setAgentSummaryError(true);
    } finally {
      if (request === summaryRequest.current) setAgentSummaryLoading(false);
    }
  }, [oauthUserId]);

  useEffect(() => {
    liveMatch.current = null;
    setAgentSummary(null);
    void refreshAgentSummary();
    return () => { summaryRequest.current += 1; };
  }, [refreshAgentSummary]);

  useEffect(() => {
    if (!oauthUserId) return;

    let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

    let cancelled = false;

    fetchJwtToken().then((jwt) => {
      if (cancelled) return;

      socket = io(getServerUrl(), {
        withCredentials: true,
        auth: jwt ? { token: jwt } : undefined,
      });
      socketRef.current = socket;

      socket.on("connect", () => {
        setConnected(true);
        socket!.emit("user:register", oauthUserId, oauthUserInfo as any);
        socket!.emit("lobby:join");
        socket!.emit("table:history");
        socket!.emit("matchmaking:status");
        if (watchedTable.current) {
          setEvents([]);
          socket!.emit("table:join", watchedTable.current);
        }
        void refreshAgentSummary();
      });

      socket.on("disconnect", () => setConnected(false));
      socket.on("lobby:tables", (t) => {
        setTables(t);
        socket!.emit("table:history");
        void refreshAgentSummary();
      });
      socket.on("lobby:personalities", (list) => setPersonalities(list));
      socket.on("game:event", (event) => {
        setEvents((prev) => [...prev, event]);
        if (event.type === "tournament-complete") {
          socket!.emit("lobby:join");
          socket!.emit("table:history");
          socket!.emit("matchmaking:status");
          void refreshAgentSummary();
        }
      });
      socket.on("game:reset", () => setEvents([]));

      socket.on("user:registered", (identity: UserIdentity) => {
        setUserId(identity.userId);
      });

      socket.on("agent:deleted", (agentId) => {
        setDeletedAgentId(agentId);
        setAgentSummary((summary) => summary?.agent?.id === agentId ? null : summary);
        void refreshAgentSummary();
      });
      socket.on("agent:created", () => { void refreshAgentSummary(); });
      socket.on("table:error", (error) => setTableError(error));
      socket.on("table:started", (tableId) => setTableStarted(tableId));
      socket.on("table:stopped", () => {
        setTableStarted(null);
        socket!.emit("lobby:join");
        socket!.emit("table:history");
        socket!.emit("matchmaking:status");
        void refreshAgentSummary();
      });
      socket.on("table:seats", (data) => {
        setSeatUpdates(data);
        setTables((previous) => previous.map((table) => table.id === data.tableId
          ? { ...table, seats: data.seats } : table));
      });
      socket.on("table:history", (tables) => setHistoryTables(tables));
      socket.on("matchmaking:state", (state) => {
        const previous = liveMatch.current;
        liveMatch.current = state;
        setMatchmakingState(state);
        setAgentSummary((summary) => summary ? {
          ...summary,
          currentMatch: state,
          currentMatchStrategyVersion: summary.currentMatch.tableId === state.tableId
            ? summary.currentMatchStrategyVersion : undefined,
        } : null);
        if (previous && (previous.status !== state.status || previous.tableId !== state.tableId)) {
          socket!.emit("lobby:join");
          socket!.emit("table:history");
        }
        void refreshAgentSummary();
      });
      socket.on("matchmaking:matched", ({ tableId }) => {
        setMatchmakingError(null);
        setMatchedTableId(tableId);
        void refreshAgentSummary();
      });
      socket.on("matchmaking:error", (error) => setMatchmakingError(error));
    });

    return () => {
      cancelled = true;
      socket?.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [refreshAgentSummary]);

  const joinTable = useCallback((tableId: string) => {
    watchedTable.current = tableId;
    setTableError(null);
    setEvents([]);
    socketRef.current?.emit("table:join", tableId);
  }, []);

  const leaveTable = useCallback((tableId: string) => {
    if (watchedTable.current === tableId) watchedTable.current = null;
    socketRef.current?.emit("table:leave", tableId);
  }, []);

  const sitAtTable = useCallback((tableId: string) => {
    setTableError(null);
    socketRef.current?.emit("table:sit", tableId);
  }, []);

  const sitBuiltin = useCallback((tableId: string, personalityId: string) => {
    setTableError(null);
    socketRef.current?.emit("table:sit-builtin", tableId, personalityId);
  }, []);

  const removeSeat = useCallback((tableId: string, seatIndex: number) => {
    setTableError(null);
    socketRef.current?.emit("table:remove-seat", tableId, seatIndex);
  }, []);

  const clearSeats = useCallback((tableId: string) => {
    socketRef.current?.emit("table:clear-seats", tableId);
  }, []);

  const startGame = useCallback((tableId: string, language?: "zh" | "en") => {
    setTableError(null);
    socketRef.current?.emit("table:start", tableId, language);
  }, []);

  const getHistory = useCallback(() => {
    socketRef.current?.emit("table:history");
  }, []);

  const refreshLobby = useCallback(() => {
    socketRef.current?.emit("lobby:join");
  }, []);

  const joinMatchmaking = useCallback((agentId?: string) => {
    setMatchmakingError(null);
    socketRef.current?.emit("matchmaking:join", agentId);
  }, []);

  const leaveMatchmaking = useCallback(() => {
    setMatchmakingError(null);
    socketRef.current?.emit("matchmaking:leave");
  }, []);

  const refreshMatchmaking = useCallback(() => {
    socketRef.current?.emit("matchmaking:status");
  }, []);

  const clearMatchedTable = useCallback(() => setMatchedTableId(null), []);

  const clearTableError = useCallback(() => setTableError(null), []);

  const deleteAgent = useCallback((agentId: string) => {
    setDeletedAgentId(null);
    socketRef.current?.emit("agent:delete", agentId);
  }, []);

  return {
    connected,
    tables,
    events,
    userId,
    tableError,
    tableStarted,
    seatUpdates,
    personalities,
    historyTables,
    deletedAgentId,
    matchmakingState,
    matchmakingError,
    matchedTableId,
    agentSummary,
    agentSummaryLoading,
    agentSummaryError,
    joinTable,
    leaveTable,
    sitAtTable,
    sitBuiltin,
    removeSeat,
    clearSeats,
    startGame,
    getHistory,
    refreshLobby,
    joinMatchmaking,
    leaveMatchmaking,
    refreshMatchmaking,
    refreshAgentSummary,
    clearMatchedTable,
    clearTableError,
    deleteAgent,
  };
}
