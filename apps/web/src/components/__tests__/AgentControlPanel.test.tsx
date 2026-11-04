import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AgentArenaSummary, AgentConfigV2 } from "@cybercasino/shared";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { AgentControlPanel } from "@/components/AgentControlPanel";

function summary(overrides: Partial<AgentArenaSummary> = {}): AgentArenaSummary {
  return {
    agent: {
      id: "agent-1",
      userId: "user-1",
      name: "Atlas",
      avatar: "🤖",
      strategy: {} as AgentConfigV2["strategy"],
      executionMode: "remote_agent",
      strategyVersion: 4,
      pendingStrategyVersion: 5,
      createdAt: 1,
      updatedAt: 1,
    },
    currentMatch: {
      queue: "ranked-default",
      status: "idle",
      queueSize: 0,
      requiredPlayers: 6,
      autoRequeue: false,
    },
    recentMatches: [],
    ...overrides,
  };
}

function renderPanel(value: AgentArenaSummary | null, overrides: Record<string, unknown> = {}) {
  return render(
    <LanguageProvider>
      <AgentControlPanel
        summary={value}
        loading={false}
        connected
        onAgentSetup={vi.fn()}
        onJoinMatchmaking={overrides.onJoinMatchmaking as (agentId: string) => void ?? vi.fn()}
        onLeaveMatchmaking={overrides.onLeaveMatchmaking as () => void ?? vi.fn()}
        onOpenTable={overrides.onOpenTable as (tableId: string) => void ?? vi.fn()}
      />
    </LanguageProvider>,
  );
}

describe("AgentControlPanel", () => {
  it("offers creation when the user has no Agent", () => {
    renderPanel({ ...summary(), agent: null });

    expect(screen.getByText("先创建一个 Agent，才能进入公共竞技场。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建 Agent" })).toBeInTheDocument();
  });

  it("joins an idle Agent and shows pending strategy activation", async () => {
    const user = userEvent.setup();
    const onJoinMatchmaking = vi.fn();

    renderPanel(summary(), { onJoinMatchmaking });

    expect(screen.getByText("远程 Agent")).toBeInTheDocument();
    expect(screen.getByText("当前生效 v4")).toBeInTheDocument();
    expect(screen.getByText("下一场生效 v5")).toBeInTheDocument();
    expect(screen.getByText(/替换整个策略包前，请先退出匹配/)).toBeInTheDocument();
    expect(screen.getByText(/风格更新将在下一场生效/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "进入匹配" }));
    expect(onJoinMatchmaking).toHaveBeenCalledWith("agent-1");
  });

  it("shows the current match version and stop-after-current action while playing", async () => {
    const user = userEvent.setup();
    const onLeaveMatchmaking = vi.fn();

    renderPanel(summary({
      currentMatch: {
        queue: "ranked-default",
        status: "playing",
        agentId: "agent-1",
        tableId: "table-1",
        queueSize: 0,
        requiredPlayers: 6,
        autoRequeue: true,
      },
      currentMatchStrategyVersion: 4,
    }), { onLeaveMatchmaking });

    expect(screen.getByText("本场冻结 v4")).toBeInTheDocument();
    expect(screen.getByText("当前比赛会继续，完成后不自动进入下一场。")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "停止后续匹配" }));
    expect(onLeaveMatchmaking).toHaveBeenCalledTimes(1);
  });
});
