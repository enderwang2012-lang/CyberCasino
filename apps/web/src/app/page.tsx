"use client";

import { useState, useEffect } from "react";
import { useSocket } from "@/hooks/useSocket";
import { Lobby } from "@/components/Lobby";
import { TableView } from "@/components/TableView";
import { AgentSetup } from "@/components/AgentSetup";
import { TableWaitingRoom } from "@/components/TableWaitingRoom";

type ViewState = "lobby" | "agent-setup" | "table-waiting" | "table-live";

export default function Home() {
  const {
    connected, tables, events, userId, agentConfig,
    tableError, webhookPingResult, tableStarted, seatUpdates,
    joinTable, leaveTable, createTable, saveAgent, testWebhook,
    sitAtTable, leaveSeat, fillAI, startGame, clearTableError,
  } = useSocket();

  const [view, setView] = useState<ViewState>("lobby");
  const [activeTableId, setActiveTableId] = useState<string | null>(null);

  const activeTable = tables.find((t) => t.id === activeTableId);
  const hasActiveTable = tables.some((t) => t.status === "waiting" || t.status === "playing");

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

  function handleCreate() {
    createTable({
      name: `Table ${tables.length + 1}`,
      smallBlind: 50,
      bigBlind: 100,
      startingChips: 5000,
      maxPlayers: 6,
    });
  }

  if (view === "agent-setup") {
    return (
      <AgentSetup
        agentConfig={agentConfig}
        webhookPingResult={webhookPingResult}
        onSave={(config) => {
          saveAgent(config);
          setView("lobby");
        }}
        onTestWebhook={testWebhook}
        onBack={() => setView("lobby")}
      />
    );
  }

  if (view === "table-waiting" && activeTableId && activeTable) {
    return (
      <TableWaitingRoom
        tableId={activeTableId}
        seats={activeTable.seats}
        userId={userId}
        agentConfig={agentConfig}
        isCreator={activeTable.creatorUserId === userId}
        onSit={sitAtTable}
        onLeaveSeat={leaveSeat}
        onFillAI={fillAI}
        onStart={startGame}
        onBack={handleLeave}
        error={tableError}
      />
    );
  }

  if (view === "table-live" && activeTableId) {
    return (
      <TableView
        tableId={activeTableId}
        events={events}
        onLeave={handleLeave}
      />
    );
  }

  return (
    <Lobby
      tables={tables}
      onJoin={handleJoinTable}
      onCreate={handleCreate}
      onAgentSetup={() => setView("agent-setup")}
      connected={connected}
      agentConfig={agentConfig}
      hasActiveTable={hasActiveTable}
    />
  );
}
