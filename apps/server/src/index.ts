import { createServer } from "http";
import { Server } from "socket.io";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import crypto from "node:crypto";
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

  // Get user's existing V2 agent
  const mineMatch = req.url?.match(/^\/api\/agents\/mine\?userId=(.+)$/);
  if (mineMatch && req.method === "GET") {
    const userId = decodeURIComponent(mineMatch[1]);
    const agent = agentStore.getV2ByUserId(userId);
    res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify(agent ? { agent } : { agent: null }));
    return;
  }

  // Get all V2 agents for a user
  const listMatch = req.url?.match(/^\/api\/agents\/list\?userId=(.+)$/);
  if (listMatch && req.method === "GET") {
    const userId = decodeURIComponent(listMatch[1]);
    const agents = agentStore.getAllV2ByUserId(userId);
    res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ agents }));
    return;
  }

  // Generate soul URL (permanent per user — deterministic key)
  if (req.url === "/api/agents/soul" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const { userId, name, avatar } = JSON.parse(body);
        const key = `user-${userId ?? "anonymous"}`;
        soulStore.set(key, {
          userId: userId ?? "anonymous", name, avatar: avatar ?? "🤖", createdAt: Date.now(),
        });
        const baseUrl = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
        res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
        res.end(JSON.stringify({ soulUrl: `${baseUrl}/api/agents/soul/${key}`, key }));
      } catch (err) {
        console.error("[api] soul generate error:", err);
        res.writeHead(500, { "Content-Type": "application/json", ...corsHeaders });
        res.end(JSON.stringify({ error: "Failed to generate soul" }));
      }
    });
    return;
  }

  // Serve soul prompt to AI (permanent URL — always valid)
  const soulMatch = req.url?.match(/^\/api\/agents\/soul\/(user-[a-zA-Z0-9:]+)$/);
  if (soulMatch && req.method === "GET") {
    const key = soulMatch[1];
    const soul = soulStore.get(key);
    if (!soul) {
      res.writeHead(404, { "Content-Type": "application/json", ...corsHeaders });
      res.end(JSON.stringify({ error: "Soul not found" }));
      return;
    }
    try {
      const promptPath = join(import.meta.dirname, "../src/prompts/agent-creation-prompt.md");
      let template = readFileSync(promptPath, "utf-8");
      const baseUrl = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
      template = template
        .replace(/\{API_BASE_URL\}/g, baseUrl)
        .replace("{API_TOKEN}", key)
        .replace(/\{NAME\}/g, soul.name)
        .replace(/\{AVATAR\}/g, soul.avatar);

      // Check if agent already exists → edit mode
      const existingAgent = agentStore.getV2ByUserId(soul.userId);
      if (existingAgent) {
        const configJson = JSON.stringify(existingAgent.strategy, null, 2);
        const editSection = `## 编辑模式

牌手「${soul.name}」已有完整策略配置，你不需要从零创建。

以下是当前配置：

\`\`\`json
${configJson}
\`\`\`

**你的任务：**
1. 先快速总结当前牌手的风格特点（2-3 句）
2. 然后问用户想怎么调整："想怎么改？比如调整松紧度、改变某个位置的起手牌范围、修改性格/语气、或者降低犯错率？"

改动时**在现有配置基础上修改**，不要重新设计。用户没说改的部分保持原样。`;
        template = template.replace("{CONFIG_CONTEXT}", editSection);
      } else {
        template = template.replace("{CONFIG_CONTEXT}", "");
      }

      res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8", ...corsHeaders });
      res.end(template);
    } catch (err) {
      console.error("[api] soul serve error:", err);
      res.writeHead(500, { "Content-Type": "application/json", ...corsHeaders });
      res.end(JSON.stringify({ error: "Failed to serve soul prompt" }));
    }
    return;
  }

  // Legacy: AI Agent Creation prompt (kept for backwards compat)
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
        let { config, preview, soulKey } = parsed as CreateAgentRequest & { soulKey?: string };
        // Fallback: extract soul key from Authorization header (AI sends token there)
        if (!soulKey && req.headers.authorization?.startsWith("Bearer ")) {
          soulKey = req.headers.authorization.slice(7);
        }

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

        // Resolve userId from soul key or request body
        let userId = parsed.userId ?? "anonymous";
        let finalPreview = preview;
        if (soulKey) {
          // soulKey is now "user-{userId}" — extract userId directly
          if (soulKey.startsWith("user-")) {
            userId = soulKey.slice(5);
          }
          const soul = soulStore.get(soulKey);
          if (soul) {
            userId = soul.userId;
            finalPreview = { ...preview, name: soul.name, avatar: soul.avatar };
          }
        }

        const agent = createAgentFromAI(userId, { config, preview: finalPreview }, () => agentStore.nextV2Id());
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

// Soul store: key → { userId, name, avatar, createdAt, agent?, existingConfig? }
const soulStore = new Map<string, { userId: string; name: string; avatar: string; createdAt: number }>();

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

    // Check v2 (AI-created StrategyAgent) first, then v1 (webhook mode)
    const v2Config = agentStore.getV2ByUserId(userId);
    const v1Config = agentStore.getByUserId(userId);
    if (!v2Config && !v1Config) { socket.emit("table:error", "No agent configured"); return; }

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

    // Build a seat-compatible config (identity fields only)
    const seatConfig = v2Config
      ? { id: v2Config.id, name: v2Config.name, avatar: v2Config.avatar, userId, stylePrompt: "", webhookVerified: true }
      : v1Config!;

    if (!table.sit(seatConfig)) {
      socket.emit("table:error", "Cannot sit (table full or already seated)");
      return;
    }

    if (v2Config) {
      tableManager.setAgentV2Config(tableId, userId, v2Config);
    }
    if (v1Config) {
      tableManager.setAgentConfig(tableId, userId, v1Config);
    }
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
    const v2Configs = tableManager.getAgentV2Configs(tableId);
    table.start(agentConfigs, language ?? "zh", v2Configs).catch((err) => {
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
