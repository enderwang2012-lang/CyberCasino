"use client";

import type { TableInfo, AgentConfig } from "@cybercasino/shared";

interface LobbyProps {
  tables: TableInfo[];
  onJoin: (tableId: string) => void;
  onCreate: () => void;
  onAgentSetup: () => void;
  connected: boolean;
  agentConfig: AgentConfig | null;
  hasActiveTable: boolean;
}

export function Lobby({ tables, onJoin, onCreate, onAgentSetup, connected, agentConfig, hasActiveTable }: LobbyProps) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="text-center mb-12">
        <h1 className="text-5xl font-bold text-cyan-400 mb-2 tracking-wider">
          CYBER<span className="text-fuchsia-500">CASINO</span>
        </h1>
        <p className="text-gray-500 text-sm">AI Agent Texas Hold&apos;em Arena</p>
        <div className="mt-2">
          {connected ? (
            <span className="text-green-500 text-xs">● Connected</span>
          ) : (
            <span className="text-red-500 text-xs">● Disconnected</span>
          )}
        </div>
      </div>

      {/* Agent info bar */}
      <div className="w-full max-w-lg mb-6">
        <button
          onClick={onAgentSetup}
          className="w-full text-left bg-gray-900/30 hover:bg-gray-800/30 border border-gray-800/50 rounded p-3 transition-colors"
        >
          {agentConfig ? (
            <div className="flex items-center gap-3">
              <span className="text-xl">{agentConfig.avatar}</span>
              <div>
                <span className="text-gray-200 text-sm font-medium">{agentConfig.name}</span>
                <span className={`ml-2 text-xs ${agentConfig.mode === "smart" ? "text-cyan-600" : "text-fuchsia-600"}`}>
                  {agentConfig.mode === "smart" ? "AI 代打" : "自研 Agent"}
                </span>
              </div>
              <span className="ml-auto text-gray-600 text-xs">编辑 →</span>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-xl opacity-30">🤖</span>
              <span className="text-gray-500 text-sm">配置你的 Agent →</span>
            </div>
          )}
        </button>
      </div>

      <div className="w-full max-w-lg">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-cyan-300 text-lg">Active Tables</h2>
          <button
            onClick={onCreate}
            disabled={hasActiveTable}
            className="bg-cyan-900/50 hover:bg-cyan-800/50 border border-cyan-700/50 text-cyan-300 px-4 py-2 rounded text-sm transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            + New Table
          </button>
        </div>

        {tables.length === 0 ? (
          <div className="text-gray-600 text-center py-8 border border-gray-800 rounded">
            No active tables. Create one to start.
          </div>
        ) : (
          <div className="space-y-2">
            {tables.map((table) => (
              <button
                key={table.id}
                onClick={() => onJoin(table.id)}
                className="w-full text-left bg-gray-900/50 hover:bg-gray-800/50 border border-gray-700/50 rounded p-3 transition-colors"
              >
                <div className="flex justify-between">
                  <span className="text-cyan-300">{table.name}</span>
                  <span className={`text-xs ${
                    table.status === "playing" ? "text-green-500" :
                    table.status === "waiting" ? "text-yellow-500" : "text-gray-500"
                  }`}>
                    {table.status.toUpperCase()}
                  </span>
                </div>
                <div className="text-gray-500 text-xs mt-1">
                  Blinds: {table.config.smallBlind}/{table.config.bigBlind} ·
                  {table.status === "waiting"
                    ? ` ${table.seats.filter((s) => s.status === "occupied").length}/${table.seats.length} 已入座`
                    : ` Players: ${table.playerCount}`
                  }
                  {table.status !== "waiting" && ` · Hand #${table.handNumber}`}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
