import { afterEach, describe, expect, it } from "bun:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { STYLE_DEFAULTS } from "@cybercasino/shared";
import { WebSocketAgentManager } from "../websocket-agent-manager";
import { parseStyleUpdate } from "../style-parser";
import { AgentClient, createAgentHarness } from "../../test-utils/ws-agent-client";

const harnesses: Awaited<ReturnType<typeof createAgentHarness>>[] = [];
afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close();
});

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

describe("connection authentication", () => {
  it("closes sockets that never authenticate and keeps authenticated ones", async () => {
    // Not the shared harness: Bun never completes http.Server#close after a
    // server-initiated WebSocket close, so this server is left to the process.
    const manager = new WebSocketAgentManager({ authTimeoutMs: 50 });
    manager.setAuthenticationResolver((token) => ({ id: token, name: token }));
    const server = createServer();
    manager.attach(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/agent`;

    const idle = new WebSocket(url);
    const closeCode = new Promise<number>((resolve) => idle.once("close", (code) => resolve(code)));
    const client = new AgentClient(new WebSocket(url));
    await new Promise((resolve) => client.ws.once("open", resolve));
    client.send({ type: "authenticate", token: "test-agent-1" });
    await client.next("authenticated");

    expect(await closeCode).toBe(4004);
    await Bun.sleep(100);
    expect(client.ws.readyState).toBe(WebSocket.OPEN);
    await client.disconnect();
    server.unref();
  });
});

describe("update_style validation", () => {
  it.each([
    [{ style: "激进型" }, true],
    [{ highLevel: { aggression: 0.8 }, override: { trapTendency: 0.4 } }, true],
    [{ profile: { aggression: 0.7 } }, true],
    [{ style: 5 }, false],
    [{ style: "x".repeat(2001) }, false],
    [{ highLevel: { aggression: "abc" } }, false],
    [{ highLevel: "aggressive" }, false],
    [{ profile: { aggression: Number.NaN } }, false],
    [{ profile: { unknownKnob: 0.5 } }, false],
    [{ override: {} }, false],
    [{}, false],
  ])("accepts only well-formed style payloads (%#)", (message, valid) => {
    expect(parseStyleUpdate(message) !== undefined).toBe(valid);
  });

  it("rejects a malformed update without persisting it", async () => {
    const manager = new WebSocketAgentManager();
    const saved: string[] = [];
    manager.setStyleUpdateCallback((_agentId, style) => saved.push(style));
    const harness = await createAgentHarness(manager);
    harnesses.push(harness);
    const client = await harness.connect();
    await client.next("authenticated");

    client.send({ type: "update_style", highLevel: { aggression: "abc" } });
    expect(await client.next("error")).toMatchObject({ message: "Invalid style update" });
    expect(saved).toEqual([]);
  });
});
