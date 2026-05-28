"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSocket } from "@/hooks/useSocket";
import { Lobby } from "@/components/Lobby";
import { TableView } from "@/components/TableView";
import { AgentSetup } from "@/components/AgentSetup";
import { TableWaitingRoom } from "@/components/TableWaitingRoom";
import { HistoryPage } from "@/components/HistoryPage";
import { LandingPage } from "@/components/LandingPage";
import { useLanguage } from "@/contexts/LanguageContext";
import type { AgentConfigV2 } from "@cybercasino/shared";

type ViewState = "lobby" | "agent-setup" | "table-waiting" | "table-live" | "history";

function AuthenticatedApp({ user }: { user: { userId: string; name: string; avatar: string; provider: string } }) {
  const {
    connected, tables, events,
    tableError, tableStarted, seatUpdates,
    personalities, historyTables, deletedAgentId,
    joinTable, leaveTable,
    sitAtTable, sitBuiltin, removeSeat, clearSeats,
    startGame, getHistory, refreshLobby, clearTableError, deleteAgent,
  } = useSocket(user.userId, { name: user.name, avatar: user.avatar, provider: user.provider });

  const [agentV2, setAgentV2] = useState<AgentConfigV2 | null>(null);

  const fetchAgentV2 = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/mine?userId=${encodeURIComponent(user.userId)}`);
      const data = await res.json();
      setAgentV2(data.agent ?? null);
    } catch { /* ignore */ }
  }, [user.userId]);

  useEffect(() => { fetchAgentV2(); }, [fetchAgentV2]);

  useEffect(() => {
    if (!deletedAgentId) return;
    setAgentV2((current) => current?.id === deletedAgentId ? null : current);
    void fetchAgentV2();
  }, [deletedAgentId, fetchAgentV2]);

  const { language } = useLanguage();
  const [view, setView] = useState<ViewState>("lobby");
  const [activeTableId, setActiveTableId] = useState<string | null>(null);

  const activeTable = tables.find((t) => t.id === activeTableId);

  useEffect(() => {
    if (tableStarted && tableStarted === activeTableId) {
      joinTable(activeTableId);
      setView("table-live");
    }
  }, [tableStarted, activeTableId, joinTable]);

  useEffect(() => {
    if (seatUpdates && seatUpdates.tableId === activeTableId && activeTable) {
      activeTable.seats = seatUpdates.seats;
    }
  }, [seatUpdates, activeTableId, activeTable]);

  useEffect(() => {
    if (view === "lobby") {
      refreshLobby();
    }
  }, [view, refreshLobby]);

  function handleJoinTable(tableId: string) {
    // Leave current table room first to prevent event leakage
    if (activeTableId && activeTableId !== tableId) {
      leaveTable(activeTableId);
    }

    const table = tables.find((t) => t.id === tableId);
    if (table) {
      if (table.status === "waiting") {
        setActiveTableId(tableId);
        joinTable(tableId);
        setView("table-waiting");
      } else {
        joinTable(tableId);
        setActiveTableId(tableId);
        setView("table-live");
      }
      return;
    }

    // Historical table — not in active tables, join directly for replay
    const hist = historyTables.find((t) => t.id === tableId);
    if (hist) {
      joinTable(tableId);
      setActiveTableId(tableId);
      setView("table-live");
    }
  }

  function handleLeave() {
    if (activeTableId) {
      leaveTable(activeTableId);
    }
    setActiveTableId(null);
    setView("lobby");
    clearTableError();
  }

  function handleAgentSetup() {
    setView("agent-setup");
  }

  function handleAgentSetupBack() {
    setView("lobby");
  }

  function handleHistory() {
    getHistory();
    setView("history");
  }

  if (view === "agent-setup") {
    return (
      <AgentSetup
        userId={user.userId}
        onCreated={() => {
          fetchAgentV2();
          setView("lobby");
        }}
        onBack={handleAgentSetupBack}
        deletedAgentId={deletedAgentId}
        onDeleteAgent={(id) => { deleteAgent(id); }}
      />
    );
  }

  if (view === "history") {
    return (
      <HistoryPage
        tables={historyTables}
        onJoin={handleJoinTable}
        onBack={() => setView("lobby")}
      />
    );
  }

  if (view === "table-waiting" && activeTableId && activeTable) {
    return (
      <TableWaitingRoom
        tableId={activeTableId}
        seats={activeTable.seats}
        userId={user.userId}
        agentV2={agentV2}
        personalities={personalities}
        onSitSelf={() => sitAtTable(activeTableId)}
        onSitBuiltin={(personalityId) => sitBuiltin(activeTableId, personalityId)}
        onRemoveSeat={(seatIndex) => removeSeat(activeTableId, seatIndex)}
        onStart={() => startGame(activeTableId, language)}
        onBack={handleLeave}
        onAgentSetup={handleAgentSetup}
        error={tableError}
      />
    );
  }

  if (view === "table-live" && activeTableId) {
    const viewingTable = tables.find((t) => t.id === activeTableId);
    const isFinished = viewingTable?.status === "finished";
    return (
      <TableView
        tableId={activeTableId}
        tableName={viewingTable?.name}
          events={events}
          onLeave={handleLeave}
        defaultTab={isFinished ? "leaderboard" : "highlights"}
        isFinished={isFinished}
      />
    );
  }

  return (
    <Lobby
      tables={tables}
      onJoin={handleJoinTable}
      onAgentSetup={handleAgentSetup}
      onHistory={handleHistory}
      onClearSeats={clearSeats}
      connected={connected}
      agentV2={agentV2}
    />
  );
}

export default function Home() {
  const { loading, user } = useAuth();

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-surface-elevated flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <LandingPage />;
  }

  return <AuthenticatedApp user={user} />;
}
