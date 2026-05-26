import { describe, expect, it } from "bun:test";
import { STYLE_DEFAULTS } from "@cybercasino/shared";
import { WebSocketAgentManager } from "../websocket-agent-manager";

describe("match style configuration freeze", () => {
  it("defers style changes made during a match until the last active match ends", () => {
    const manager = new WebSocketAgentManager();
    const saved: string[] = [];
    const oldStyle = { ...STYLE_DEFAULTS, aggression: 0.2 };
    const newStyle = { ...STYLE_DEFAULTS, aggression: 0.9 };

    manager.setStyleUpdateCallback((_agentId, style, _profile, status) => saved.push(`${status}:${style}`));
    expect(manager.updateStyle("agent-1", "patient", oldStyle)).toBe("applied");

    manager.lockStyleForMatch("agent-1", "table-1");
    manager.lockStyleForMatch("agent-1", "table-2");
    expect(manager.updateStyle("agent-1", "maximum pressure", newStyle)).toBe("deferred");
    expect(manager.getStylePrompt("agent-1")).toBe("patient");
    expect(manager.getStyleProfile("agent-1")?.aggression).toBe(0.2);
    expect(saved).toEqual(["active:patient", "pending:maximum pressure"]);

    manager.unlockStyleForMatch("agent-1", "table-1");
    expect(manager.getStylePrompt("agent-1")).toBe("patient");

    manager.unlockStyleForMatch("agent-1", "table-2");
    expect(manager.getStylePrompt("agent-1")).toBe("maximum pressure");
    expect(manager.getStyleProfile("agent-1")?.aggression).toBe(0.9);
    expect(saved).toEqual(["active:patient", "pending:maximum pressure", "activate_pending:maximum pressure"]);
  });
});
