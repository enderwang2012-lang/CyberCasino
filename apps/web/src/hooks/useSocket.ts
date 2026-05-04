"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import type {
  GameEvent,
  TableInfo,
  ServerToClientEvents,
  ClientToServerEvents,
  AgentConfig,
  UserIdentity,
  TableSeat,
  WebhookPingResult,
} from "@cybercasino/shared";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";
const USER_ID_KEY = "cybercasino-userId";

export function useSocket() {
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const [connected, setConnected] = useState(false);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null);
  const [tableError, setTableError] = useState<string | null>(null);
  const [webhookPingResult, setWebhookPingResult] = useState<WebhookPingResult | null>(null);
  const [tableStarted, setTableStarted] = useState<string | null>(null);
  const [seatUpdates, setSeatUpdates] = useState<{ tableId: string; seats: TableSeat[] } | null>(null);

  useEffect(() => {
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SERVER_URL);
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      const existingId = localStorage.getItem(USER_ID_KEY) ?? undefined;
      socket.emit("user:register", existingId);
      socket.emit("lobby:join");
    });

    socket.on("disconnect", () => setConnected(false));
    socket.on("lobby:tables", (t) => setTables(t));
    socket.on("game:event", (event) => {
      setEvents((prev) => [...prev, event]);
    });

    socket.on("user:registered", (identity: UserIdentity) => {
      setUserId(identity.userId);
      localStorage.setItem(USER_ID_KEY, identity.userId);
      socket.emit("agent:get");
    });

    socket.on("agent:saved", (config) => setAgentConfig(config));
    socket.on("agent:config", (config) => setAgentConfig(config));
    socket.on("agent:webhookPing", (result) => setWebhookPingResult(result));
    socket.on("table:error", (error) => setTableError(error));
    socket.on("table:started", (tableId) => setTableStarted(tableId));
    socket.on("table:stopped", () => setTableStarted(null));
    socket.on("table:seats", (data) => setSeatUpdates(data));

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

  const createTable = useCallback((config: Parameters<ClientToServerEvents["table:create"]>[0]) => {
    setTableError(null);
    socketRef.current?.emit("table:create", config);
  }, []);

  const saveAgent = useCallback((config: Omit<AgentConfig, "id" | "userId" | "webhookVerified">) => {
    socketRef.current?.emit("agent:save", config);
  }, []);

  const testWebhook = useCallback((url: string) => {
    setWebhookPingResult(null);
    socketRef.current?.emit("agent:testWebhook", url);
  }, []);

  const sitAtTable = useCallback((tableId: string) => {
    setTableError(null);
    socketRef.current?.emit("table:sit", tableId);
  }, []);

  const leaveSeat = useCallback((tableId: string) => {
    socketRef.current?.emit("table:leave-seat", tableId);
  }, []);

  const fillAI = useCallback((tableId: string) => {
    socketRef.current?.emit("table:fillAI", tableId);
  }, []);

  const startGame = useCallback((tableId: string) => {
    setTableError(null);
    socketRef.current?.emit("table:start", tableId);
  }, []);

  const stopGame = useCallback((tableId: string) => {
    socketRef.current?.emit("table:stop", tableId);
  }, []);

  const clearTableError = useCallback(() => setTableError(null), []);

  return {
    connected,
    tables,
    events,
    userId,
    agentConfig,
    tableError,
    webhookPingResult,
    tableStarted,
    seatUpdates,
    joinTable,
    leaveTable,
    createTable,
    saveAgent,
    testWebhook,
    sitAtTable,
    leaveSeat,
    fillAI,
    startGame,
    stopGame,
    clearTableError,
  };
}
