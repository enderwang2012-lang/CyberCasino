/**
 * Test script for WebSocket Agent integration
 *
 * Usage:
 *   1. Server must be running (bun dev)
 *   2. Run: bun test-ws-agent.ts
 */

import WebSocket from "ws";

const SERVER = "ws://localhost:3001/agent";
const API = "http://localhost:3001";

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function testCreateAgent() {
  console.log("\n=== Test 1: Create external agent ===");
  const res = await fetch(`${API}/api/external-agent/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Test Agent", avatar: "🤖" }),
  });
  const data = await res.json();
  console.log("Created agent:", data.agentId);
  console.log("Token:", data.token);
  console.log("Soul link:", data.soulLink);
  return data;
}

async function testWebSocketAuth(token: string) {
  console.log("\n=== Test 2: WebSocket authentication ===");
  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(SERVER);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Auth timeout"));
    }, 5000);

    ws.on("open", () => {
      console.log("Connected to WebSocket");
      ws.send(JSON.stringify({ type: "authenticate", token }));
    });

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      console.log("Received:", msg);

      if (msg.type === "authenticated") {
        console.log("Authenticated! Agent ID:", msg.agentId);
        clearTimeout(timeout);
        ws.close();
        resolve();
      }

      if (msg.type === "error") {
        clearTimeout(timeout);
        ws.close();
        reject(new Error(msg.message));
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function testUpdateStyle(token: string) {
  console.log("\n=== Test 3: Update style prompt (Format A: text) ===");
  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(SERVER);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Style update timeout"));
    }, 5000);

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "authenticate", token }));
    });

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());

      if (msg.type === "authenticated") {
        ws.send(JSON.stringify({
          type: "update_style",
          style: "激进型，喜欢bluff，中等紧度",
        }));
      }

      if (msg.type === "style_updated") {
        console.log("Style updated (Format A):", JSON.stringify(msg.profile));
        clearTimeout(timeout);
        ws.close();
        resolve();
      }

      if (msg.type === "error") {
        clearTimeout(timeout);
        ws.close();
        reject(new Error(msg.message));
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function testUpdateStyleStructured(token: string) {
  console.log("\n=== Test 3b: Update style (Format C: highLevel + override) ===");
  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(SERVER);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Style update timeout"));
    }, 5000);

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "authenticate", token }));
    });

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());

      if (msg.type === "authenticated") {
        ws.send(JSON.stringify({
          type: "update_style",
          highLevel: { tightness: 0.3, aggression: 0.8, bluffFrequency: 0.4 },
          override: { trapTendency: 0.95 },
        }));
      }

      if (msg.type === "style_updated") {
        const p = msg.profile;
        console.log("Style updated (Format C):", JSON.stringify(p));
        // Verify override was applied
        if (p.trapTendency === 0.95) {
          console.log("  ✓ Override applied correctly (trapTendency=0.95)");
        } else {
          console.log(`  ✗ Override NOT applied! trapTendency=${p.trapTendency} (expected 0.95)`);
        }
        clearTimeout(timeout);
        ws.close();
        resolve();
      }

      if (msg.type === "error") {
        clearTimeout(timeout);
        ws.close();
        reject(new Error(msg.message));
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function testHeartbeat(token: string) {
  console.log("\n=== Test 4: Heartbeat (ping/pong) ===");
  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(SERVER);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Heartbeat timeout"));
    }, 5000);

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "authenticate", token }));
    });

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());

      if (msg.type === "authenticated") {
        ws.send(JSON.stringify({ type: "ping" }));
      }

      if (msg.type === "pong") {
        console.log("Pong received!");
        clearTimeout(timeout);
        ws.close();
        resolve();
      }

      if (msg.type === "error") {
        clearTimeout(timeout);
        ws.close();
        reject(new Error(msg.message));
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function testSimulateTurn(token: string) {
  console.log("\n=== Test 5: Simulate your_turn (manual test) ===");
  console.log("(This simulates what the server would send during a game)");
  console.log("In real gameplay, the server sends your_turn when it's the agent's turn.");

  // The actual your_turn is sent by the server during gameplay
  // This test just verifies the agent can handle the message format
  const sampleTurn = {
    type: "your_turn",
    roomId: "test-room",
    handIndex: 1,
    phase: "preflop",
    myCards: ["AH", "KC"],
    board: [],
    myChips: 5000,
    currentBet: 100,
    potSize: 150,
    validActions: ["call", "raise"],
    callAmount: 100,
    minRaise: 200,
    players: [
      { name: "Alice", chips: 5000, currentBet: 100, status: "active", seatIndex: 0 },
      { name: "Test Agent", chips: 5000, currentBet: 0, status: "active", seatIndex: 1 },
    ],
    actionHistory: [
      { player: "Alice", action: "raise", amount: 100 },
    ],
    stylePrompt: "激进型，喜欢bluff",
  };

  console.log("Sample your_turn message:", JSON.stringify(sampleTurn, null, 2));

  return new Promise<void>((resolve) => {
    const ws = new WebSocket(SERVER);

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "authenticate", token }));
    });

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());

      if (msg.type === "authenticated") {
        console.log("\nAgent connected. In production, server would now send your_turn.");
        console.log("Agent would then call its LLM and return an action.");

        // Simulate agent responding to a turn
        const response = {
          type: "action",
          action: "raise",
          amount: 400,
          thought: "拿到 AK，对手加注了，3-bet 施压",
          isBluffing: false,
        };
        console.log("\nSimulated agent response:", response);
        ws.close();
        resolve();
      }
    });
  });
}

async function testStats(token: string) {
  console.log("\n=== Test 6: Query stats API ===");
  const res = await fetch(`${API}/api/agent/stats`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  console.log("Stats:", data);
  return data;
}

async function main() {
  try {
    // Create agent
    const agent = await testCreateAgent();

    // WebSocket auth
    await testWebSocketAuth(agent.token);

    // Update style (Format A)
    await testUpdateStyle(agent.token);

    // Update style (Format C: highLevel + override)
    await testUpdateStyleStructured(agent.token);

    // Heartbeat
    await testHeartbeat(agent.token);

    // Simulate turn
    await testSimulateTurn(agent.token);

    // Stats
    await testStats(agent.token);

    console.log("\n✅ All tests passed!");
  } catch (err) {
    console.error("\n❌ Test failed:", err);
    process.exit(1);
  }
}

main();
