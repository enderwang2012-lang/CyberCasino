"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSocket } from "@/hooks/useSocket";
import { Lobby } from "@/components/Lobby";
import { TableView } from "@/components/TableView";
import { AgentSetup } from "@/components/AgentSetup";
import { TableWaitingRoom } from "@/components/TableWaitingRoom";
import { HistoryPage } from "@/components/HistoryPage";
import { LandingPage } from "@/components/LandingPage";

type ViewState = "lobby" | "agent-setup" | "table-waiting" | "table-live" | "history";

function AuthenticatedApp({ user }: { user: { userId: string; name: string; avatar: string; provider: string } }) {
  const {
    connected, tables, events, agentConfig,
    tableError, webhookPingResult, tableStarted, seatUpdates,
    personalities, historyTables,
    joinTable, leaveTable, saveAgent, testWebhook,
    sitAtTable, sitBuiltin, removeSeat, clearSeats,
    startGame, getHistory, refreshLobby, clearTableError,
  } = useSocket(user.userId, { name: user.name, avatar: user.avatar, provider: user.provider });

  const [view, setView] = useState<ViewState>("lobby");
  const [activeTableId, setActiveTableId] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState<ViewState>("lobby");

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
    const table = tables.find((t) => t.id === tableId);
    if (!table) return;

    if (table.status === "waiting") {
      setActiveTableId(tableId);
      joinTable(tableId);
      setView("table-waiting");
    } else {
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

  function handleAgentSetup(from: ViewState = "lobby") {
    setReturnTo(from);
    setView("agent-setup");
  }

  function handleAgentSetupBack() {
    setView(returnTo);
  }

  function handleHistory() {
    getHistory();
    setView("history");
  }

  if (view === "agent-setup") {
    return (
      <AgentSetup
        agentConfig={agentConfig}
        webhookPingResult={webhookPingResult}
        onSave={(config) => {
          saveAgent(config);
          setView(returnTo);
        }}
        onTestWebhook={testWebhook}
        onBack={handleAgentSetupBack}
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
        agentConfig={agentConfig}
        personalities={personalities}
        onSitSelf={() => sitAtTable(activeTableId)}
        onSitBuiltin={(personalityId) => sitBuiltin(activeTableId, personalityId)}
        onRemoveSeat={(seatIndex) => removeSeat(activeTableId, seatIndex)}
        onStart={() => startGame(activeTableId)}
        onBack={handleLeave}
        onAgentSetup={() => handleAgentSetup("table-waiting")}
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
        defaultTab={isFinished ? "leaderboard" : "live"}
        isFinished={isFinished}
      />
    );
  }

  return (
    <Lobby
      tables={tables}
      onJoin={handleJoinTable}
      onAgentSetup={() => handleAgentSetup("lobby")}
      onHistory={handleHistory}
      onClearSeats={clearSeats}
      connected={connected}
      agentConfig={agentConfig}
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