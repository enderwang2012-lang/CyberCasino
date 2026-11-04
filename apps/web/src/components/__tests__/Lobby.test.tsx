import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AgentConfigV2, MatchmakingState } from "@cybercasino/shared";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { Lobby } from "@/components/Lobby";

function agent(): AgentConfigV2 {
  return {
    id: "agent-1",
    userId: "user-1",
    name: "Atlas",
    avatar: "🤖",
    strategy: {} as AgentConfigV2["strategy"],
    executionMode: "remote_agent",
    strategyVersion: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

function state(overrides: Partial<MatchmakingState> = {}): MatchmakingState {
  return {
    queue: "ranked-default",
    status: "idle",
    queueSize: 0,
    requiredPlayers: 6,
    autoRequeue: false,
    ...overrides,
  };
}

function renderLobby(matchmakingState: MatchmakingState, overrides: Record<string, unknown> = {}) {
  return render(
    <LanguageProvider>
      <Lobby
        tables={[]}
        onJoin={vi.fn()}
        onAgentSetup={vi.fn()}
        onHistory={vi.fn()}
        onClearSeats={vi.fn()}
        connected
        agentV2={agent()}
        matchmakingState={matchmakingState}
        matchmakingError={null}
        onJoinMatchmaking={(agentId) => (overrides.onJoinMatchmaking as (agentId: string) => void)?.(agentId)}
        onLeaveMatchmaking={() => (overrides.onLeaveMatchmaking as () => void)?.()}
      />
    </LanguageProvider>,
  );
}

describe("Lobby matchmaking controls", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ standings: [] }),
    }));
  });

  it("shows the join action for an idle configured Agent", () => {
    renderLobby(state());

    expect(screen.getByRole("button", { name: /进入匹配/ })).toBeInTheDocument();
  });

  it("shows queue position and a leave action while queued", () => {
    renderLobby(state({
      status: "queued",
      agentId: "agent-1",
      position: 3,
      queueSize: 5,
      autoRequeue: true,
    }));

    expect(screen.getByText(/排队第 3 位/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /退出匹配/ })).toBeInTheDocument();
  });

  it("calls join and leave callbacks from the primary control", async () => {
    const user = userEvent.setup();
    const onJoinMatchmaking = vi.fn();
    const onLeaveMatchmaking = vi.fn();

    renderLobby(state(), { onJoinMatchmaking });
    await user.click(screen.getByRole("button", { name: /进入匹配/ }));
    expect(onJoinMatchmaking).toHaveBeenCalledWith("agent-1");

    renderLobby(state({
      status: "queued",
      agentId: "agent-1",
      position: 1,
      queueSize: 1,
      autoRequeue: true,
    }), { onLeaveMatchmaking });
    await user.click(screen.getByRole("button", { name: /退出匹配/ }));
    expect(onLeaveMatchmaking).toHaveBeenCalledTimes(1);
  });

  it("shows the table status after the Agent has been matched", () => {
    renderLobby(state({
      status: "playing",
      agentId: "agent-1",
      tableId: "table-9",
      queueSize: 0,
      autoRequeue: true,
    }));

    expect(screen.getByText(/比赛进行中/)).toBeInTheDocument();
    expect(screen.getByText(/table-9/)).toBeInTheDocument();
  });
});
