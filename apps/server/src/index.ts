import { createServer } from "http";
import { Server } from "socket.io";
import type { ServerToClientEvents, ClientToServerEvents, BuiltinPersonalityInfo } from "@cybercasino/shared";
import { TableManager } from "./table-manager";
import { UserStore, AgentStore } from "./stores";
import { pingWebhook } from "./agents/webhook-ping";
import { PERSONALITIES } from "./agents/personalities";

const PORT = parseInt(process.env.PORT ?? "3001");

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  res.writeHead(404);
  res.end();
});
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: "*" },
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

  socket.on("user:register", (existingUserId) => {
    const identity = userStore.register(existingUserId ?? undefined);
    const uid = identity.userId;

    const oldSocketId = userSocketMap.get(uid);
    if (oldSocketId && oldSocketId !== socket.id) {
      const oldSocket = io.sockets.sockets.get(oldSocketId);
      if (oldSocket) {
        oldSocket.emit("table:error", "你的账号在另一个窗口登录，当前连接已断开");
        oldSocket.disconnect(true);
      }
    }

    socketUserMap.set(socket.id, uid);
    userSocketMap.set(uid, socket.id);
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

  socket.on("table:start", (tableId) => {
    const table = tableManager.getTable(tableId);
    if (!table) { socket.emit("table:error", "Table not found"); return; }

    if (!table.isFull()) {
      socket.emit("table:error", "需要6位玩家才能开始");
      return;
    }

    io.to(`table:${tableId}`).emit("table:started", tableId);
    broadcastLobby();

    const agentConfigs = tableManager.getAgentConfigs(tableId);
    table.start(agentConfigs).catch((err) => {
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
