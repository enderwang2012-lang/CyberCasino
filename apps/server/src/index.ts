import { createServer } from "http";
import { Server } from "socket.io";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ServerToClientEvents, ClientToServerEvents, BuiltinPersonalityInfo } from "@cybercasino/shared";
import { TableManager } from "./table-manager";
import { UserStore, AgentStore } from "./stores";
import { pingWebhook } from "./agents/webhook-ping";
import { PERSONALITIES } from "./agents/personalities";
import { validateStrategyConfig, validatePreview, createAgentFromAI } from "./api/agent-create";
import type { CreateAgentRequest } from "./api/agent-create";

const PORT = parseInt(process.env.PORT ?? "3001");

const httpServer = createServer((req, res) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  // AI Agent Creation prompt
  if (req.url?.startsWith("/api/agents/creation-prompt") && req.method === "GET") {
    try {
      const promptPath = join(import.meta.dirname, "../src/prompts/agent-creation-prompt.md");
      const template = readFileSync(promptPath, "utf-8");
      const baseUrl = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
      const url = new URL(req.url, `http://localhost:${PORT}`);
      const token = url.searchParams.get("token") || "{API_TOKEN}";
      const prompt = template
        .replace("{API_BASE_URL}", baseUrl)
        .replace("{API_TOKEN}", token);
      res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8", ...corsHeaders });
      res.end(prompt);
    } catch (err) {
      console.error("[api] creation-prompt error:", err);
      res.writeHead(500, { "Content-Type": "application/json", ...corsHeaders });
      res.end(JSON.stringify({ error: "Failed to load prompt" }));
    }
    return;
  }

  // AI Agent Creation endpoint
  if (req.url === "/api/agents/create-by-ai" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body);
        const { config, preview } = parsed as CreateAgentRequest;

        const configResult = validateStrategyConfig(config);
        if (!configResult.valid) {
          res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders });
          res.end(JSON.stringify({ error: "Invalid strategy config", details: configResult.errors }));
          return;
        }

        const previewResult = validatePreview(preview);
        if (!previewResult.valid) {
          res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders });
          res.end(JSON.stringify({ error: "Invalid preview", details: previewResult.errors }));
          return;
        }

        const agent = createAgentFromAI(parsed.userId ?? "anonymous", { config, preview }, () => agentStore.nextV2Id());
        agentStore.saveV2(agent);

        res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
        res.end(JSON.stringify({
          agentId: agent.id,
          status: "active",
          previewUrl: `/agents/${agent.id}`,
        }));
      } catch (err) {
        console.error("[api] create-by-ai error:", err);
        res.writeHead(500, { "Content-Type": "application/json", ...corsHeaders });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    });
    return;
  }

  const replayMatch = req.url?.match(/^\/api\/replay\/(.+)$/);
  if (replayMatch && req.method === "GET") {
    const tableId = replayMatch[1];
    const table = tableManager.getTable(tableId);
    if (!table || table.getStatus() !== "finished") {
      res.writeHead(404, { "Content-Type": "application/json", ...corsHeaders });
      res.end(JSON.stringify({ error: "Table not found or not finished" }));
      return;
    }
    const replayData = table.getReplayData();
    res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify(replayData));
    return;
  }

  res.writeHead(404, corsHeaders);
  res.end();
});
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: process.env.CORS_ORIGIN ?? "*" },
});

const tableManager = new TableManager();
const userStore = new UserStore();
const agentStore = new AgentStore();

const socketUserMap = new Map<string, string>();
const userSocketMap = new Map<string, string>();

const personalitiesInfo: BuiltinPersonalityInfo[] = PERSONALITIES.map((p) => ({
  id: p.id,
  name: p.name,
  avatar: p.avatar,
  style: p.style,
}));

function getClientIp(socket: { handshake: { headers: Record<string, string | string[] | undefined>; address: string } }): string {
  const forwarded = socket.handshake.headers["x-forwarded-for"];
  if (forwarded) {
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(",")[0];
    return first.trim();
  }
  return socket.handshake.address;
}

function broadcastLobby() {
  io.to("lobby").emit("lobby:tables", tableManager.getHomepageTables());
}

function broadcastSeats(tableId: string) {
  const table = tableManager.getTable(tableId);
  if (table) {
    io.to(`table:${tableId}`).emit("table:seats", { tableId, seats: table.getSeats() });
    broadcastLobby();
  }
}

function wireTableEvents(tableId: string) {
  const table = tableManager.getTable(tableId);
  if (!table) return;

  table.onEvent((event) => {
    if (event.type === "action-required") return;
    io.to(`table:${tableId}`).emit("game:event", event);
    if (event.type === "tournament-complete") {
      tableManager.archiveFinishedTable(tableId);
      const newTable = tableManager.ensurePresetTable();
      wireTableEvents(newTable.id);
      broadcastLobby();
    }
  });
}

// Create initial preset table on startup
const initialTable = tableManager.ensurePresetTable();
wireTableEvents(initialTable.id);

io.on("connection", (socket) => {
  console.log(`[connect] ${socket.id}`);

  socket.on("user:register", (userId, userInfo) => {
    if (!userId) { socket.emit("table:error", "请先登录"); return; }

    let identity = userStore.get(userId);
    if (!identity && userInfo && (userId.startsWith("github:") || userId.startsWith("google:"))) {
      identity = { userId, name: userInfo.name, avatar: userInfo.avatar, provider: userInfo.provider, createdAt: Date.now() };
      userStore.upsert(identity);
    }
    if (!identity) { socket.emit("table:error", "用户不存在，请重新登录"); return; }

    const oldSocketId = userSocketMap.get(userId);
    if (oldSocketId && oldSocketId !== socket.id) {
      const oldSocket = io.sockets.sockets.get(oldSocketId);
      if (oldSocket) {
        oldSocket.emit("table:error", "你的账号在另一个窗口登录，当前连接已断开");
        oldSocket.disconnect(true);
      }
    }

    socketUserMap.set(socket.id, userId);
    userSocketMap.set(userId, socket.id);
    socket.emit("user:registered", identity);
    socket.emit("lobby:personalities", personalitiesInfo);
  });

  // --- Agent config ---
  socket.on("agent:save", (partial) => {
    const userId = socketUserMap.get(socket.id);
    if (!userId) { socket.emit("table:error", "Not registered"); return; }
    const config = agentStore.save(userId, partial);
    socket.emit("agent:saved", config);
  });

  socket.on("agent:get", () => {
    const userId = socketUserMap.get(socket.id);
    if (!userId) { socket.emit("agent:config", null); return; }
    socket.emit("agent:config", agentStore.getByUserId(userId) ?? null);
  });

  socket.on("agent:testWebhook", async (url) => {
    const userId = socketUserMap.get(socket.id);
    const result = await pingWebhook(url);
    if (result.success && userId) {
      agentStore.markWebhookVerified(userId);
    }
    socket.emit("agent:webhookPing", result);
  });

  // --- Lobby ---
  socket.on("lobby:join", () => {
    socket.join("lobby");
    socket.emit("lobby:tables", tableManager.getHomepageTables());
    socket.emit("lobby:personalities", personalitiesInfo);
  });

  // --- Table lifecycle ---
  socket.on("table:join", (tableId) => {
    const table = tableManager.getTable(tableId);
    if (!table) return;
    socket.join(`table:${tableId}`);
    for (const event of table.getEventHistory()) {
      socket.emit("game:event", event);
    }
    console.log(`[${socket.id}] joined table ${tableId}`);
  });

  socket.on("table:leave", (tableId) => {
    socket.leave(`table:${tableId}`);
    socket.emit("lobby:tables", tableManager.getHomepageTables());
  });

  socket.on("table:sit", (tableId) => {
    const userId = socketUserMap.get(socket.id);
    if (!userId) { socket.emit("table:error", "Not registered"); return; }

    const agentConfig = agentStore.getByUserId(userId);
    if (!agentConfig) { socket.emit("table:error", "No agent configured"); return; }

    const table = tableManager.getTable(tableId);
    if (!table) { socket.emit("table:error", "Table not found"); return; }

    const myIp = getClientIp(socket);
    const seats = table.getSeats();
    for (const seat of seats) {
      if (seat.agent?.userId && seat.agent.userId !== userId) {
        const otherSocketId = userSocketMap.get(seat.agent.userId);
        if (otherSocketId) {
          const otherSocket = io.sockets.sockets.get(otherSocketId);
          if (otherSocket && getClientIp(otherSocket) === myIp) {
            socket.emit("table:error", "同一网络只能入座一个位置");
            return;
          }
        }
      }
    }

    if (!table.sit(agentConfig)) {
      socket.emit("table:error", "Cannot sit (table full or already seated)");
      return;
    }

    tableManager.setAgentConfig(tableId, userId, agentConfig);
    socket.join(`table:${tableId}`);
    broadcastSeats(tableId);
  });

  socket.on("table:sit-builtin", (tableId, personalityId) => {
    const table = tableManager.getTable(tableId);
    if (!table) { socket.emit("table:error", "Table not found"); return; }

    if (!table.sitBuiltin(personalityId)) {
      socket.emit("table:error", "Cannot place AI (already seated or table full)");
      return;
    }

    socket.join(`table:${tableId}`);
    broadcastSeats(tableId);
  });

  socket.on("table:remove-seat", (tableId, seatIndex) => {
    const userId = socketUserMap.get(socket.id);
    const table = tableManager.getTable(tableId);
    if (!table) { socket.emit("table:error", "Table not found"); return; }

    const seats = table.getSeats();
    const seat = seats[seatIndex];
    if (!seat || seat.status === "empty") return;

    if (seat.agent?.type === "builtin") {
      table.removeSeat(seatIndex);
      broadcastSeats(tableId);
    } else if (seat.agent?.userId === userId) {
      table.removeSeat(seatIndex);
      broadcastSeats(tableId);
    } else {
      socket.emit("table:error", "只能移除自己的 AI");
    }
  });

  socket.on("table:clear-seats", (tableId) => {
    const table = tableManager.getTable(tableId);
    if (!table) return;
    if (table.getStatus() !== "waiting") return;
    table.clearAllSeats();
    broadcastSeats(tableId);
  });

  socket.on("table:start", (tableId, language) => {
    const table = tableManager.getTable(tableId);
    if (!table) { socket.emit("table:error", "Table not found"); return; }

    if (!table.isFull()) {
      socket.emit("table:error", "需要6位玩家才能开始");
      return;
    }

    io.to(`table:${tableId}`).emit("table:started", tableId);
    broadcastLobby();

    const agentConfigs = tableManager.getAgentConfigs(tableId);
    table.start(agentConfigs, language ?? "zh").catch((err) => {
      console.error(`[table:${tableId}] error:`, err);
    });
  });

  socket.on("table:history", () => {
    socket.emit("table:history", tableManager.getHistoryTables());
  });

  socket.on("disconnect", () => {
    const uid = socketUserMap.get(socket.id);
    socketUserMap.delete(socket.id);
    if (uid && userSocketMap.get(uid) === socket.id) {
      userSocketMap.delete(uid);
    }
    console.log(`[disconnect] ${socket.id}`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`CyberCasino server running on port ${PORT}`);
});
