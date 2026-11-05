"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSocket } from "@/hooks/useSocket";
import { Lobby } from "@/components/Lobby";
import { TableView } from "@/components/TableView";
import { AgentSetup } from "@/components/AgentSetup";
import { HistoryPage } from "@/components/HistoryPage";
import { LandingPage } from "@/components/LandingPage";
import type { AgentConfigV2 } from "@cybercasino/shared";

type ViewState = "lobby" | "agent-setup" | "table-live" | "history";

function AuthenticatedApp({ user }: { user: { userId: string; name: string; avatar: string; provider: string } }) {
  const {
    connected, tables, events,
    historyTables, deletedAgentId,
    matchmakingState, matchmakingError, matchedTableId,
    joinTable, leaveTable,
    getHistory, refreshLobby, joinMatchmaking, leaveMatchmaking,
    refreshMatchmaking, refreshAgentSummary, clearMatchedTable, clearTableError, deleteAgent,
    agentSummary, agentSummaryLoading, agentSummaryError,
    tableError,
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

  const [view, setView] = useState<ViewState>("lobby");
  const [activeTableId, setActiveTableId] = useState<string | null>(null);

  const refreshConsole = useCallback(() => {
    refreshLobby();
    getHistory();
    refreshMatchmaking();
    void refreshAgentSummary();
  }, [getHistory, refreshAgentSummary, refreshLobby, refreshMatchmaking]);

  useEffect(() => {
    if (!matchedTableId) return;
    if (activeTableId && activeTableId !== matchedTableId) {
      leaveTable(activeTableId);
    }
    setActiveTableId(matchedTableId);
    joinTable(matchedTableId);
    setView("table-live");
    clearMatchedTable();
  }, [matchedTableId, activeTableId, clearMatchedTable, joinTable, leaveTable]);

  useEffect(() => {
    if (view === "lobby") {
      refreshConsole();
    }
  }, [view, refreshConsole]);

  useEffect(() => {
    if (view !== "lobby") return;

    let disposed = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const visible = () => !disposed && document.visibilityState === "visible";
    const schedule = () => {
      if (visible()) timer = setTimeout(pollSummary, 5000);
    };
    async function pollSummary() {
      if (!visible() || inFlight) return;
      inFlight = true;
      try {
        await refreshAgentSummary();
      } finally {
        inFlight = false;
        schedule();
      }
    }
    function handleVisibilityChange() {
      clearTimeout(timer);
      if (visible()) void pollSummary();
    }

    schedule();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [view, refreshAgentSummary]);

  function handleJoinTable(tableId: string) {
    // Leave current table room first to prevent event leakage
    if (activeTableId && activeTableId !== tableId) {
      leaveTable(activeTableId);
    }

    // Live and historical tables share the spectator view; the server resolves
    // a replay even when history has not arrived yet.
    joinTable(tableId);
    setActiveTableId(tableId);
    setView("table-live");
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

  if (view === "table-live" && activeTableId) {
    const viewingTable = tables.find((t) => t.id === activeTableId)
      ?? historyTables.find((t) => t.id === activeTableId);
    const recentMatch = agentSummary?.recentMatches.find((match) => match.tableId === activeTableId);
    const isFinished = viewingTable?.status === "finished"
      || historyTables.some((t) => t.id === activeTableId)
      || recentMatch !== undefined;
    return (
      <TableView
        key={activeTableId}
        tableId={activeTableId}
        tableName={viewingTable?.name ?? recentMatch?.tableName}
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
      connected={connected}
      agentV2={agentV2}
      matchmakingState={matchmakingState}
      matchmakingError={matchmakingError?.message ?? null}
      onJoinMatchmaking={joinMatchmaking}
      onLeaveMatchmaking={leaveMatchmaking}
      agentSummary={agentSummary}
      agentSummaryLoading={agentSummaryLoading}
      agentSummaryError={agentSummaryError}
      onRefresh={refreshConsole}
      onOpenReplay={handleJoinTable}
      tableError={tableError}
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
