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
} from "@cybercasino/shared";

function getServerUrl() {
  if (process.env.NEXT_PUBLIC_SERVER_URL) {
    const url = process.env.NEXT_PUBLIC_SERVER_URL;
    return url.startsWith("http") ? url : `https://${url}`;
  }
  return "http://localhost:3001";
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

  useEffect(() => {
    if (!oauthUserId) return;

    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(getServerUrl(), {
      withCredentials: true,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("user:register", oauthUserId, oauthUserInfo as any);
      socket.emit("lobby:join");
    });

    socket.on("disconnect", () => setConnected(false));
    socket.on("lobby:tables", (t) => setTables(t));
    socket.on("lobby:personalities", (list) => setPersonalities(list));
    socket.on("game:event", (event) => {
      setEvents((prev) => [...prev, event]);
    });
    socket.on("game:reset", () => setEvents([]));

    socket.on("user:registered", (identity: UserIdentity) => {
      setUserId(identity.userId);
    });

    socket.on("agent:deleted", (agentId) => {
      setDeletedAgentId(agentId);
    });
    socket.on("table:error", (error) => setTableError(error));
    socket.on("table:started", (tableId) => setTableStarted(tableId));
    socket.on("table:stopped", () => setTableStarted(null));
    socket.on("table:seats", (data) => setSeatUpdates(data));
    socket.on("table:history", (tables) => setHistoryTables(tables));

    return () => {
      socket.disconnect();
    };
  }, []);

  const joinTable = useCallback((tableId: string) => {
    setEvents([]);
    socketRef.current?.emit("table:join", tableId);
  }, []);

  const leaveTable = useCallback((tableId: string) => {
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
    joinTable,
    leaveTable,
    sitAtTable,
    sitBuiltin,
    removeSeat,
    clearSeats,
    startGame,
    getHistory,
    refreshLobby,
    clearTableError,
    deleteAgent,
  };
}
