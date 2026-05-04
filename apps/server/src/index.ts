import { createServer } from "http";
import { Server } from "socket.io";
import type { ServerToClientEvents, ClientToServerEvents } from "@cybercasino/shared";
import { TableManager } from "./table-manager";
import { UserStore, AgentStore } from "./stores";
import { pingWebhook } from "./agents/webhook-ping";

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

const socketUserMap = new Map<string, string>(); // socketId → userId
const userSocketMap = new Map<string, string>(); // userId → socketId (for takeover)

function getClientIp(socket: { handshake: { headers: Record<string, string | string[] | undefined>; address: string } }): string {
  const forwarded = socket.handshake.headers["x-forwarded-for"];
  if (forwarded) {
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(",")[0];
    return first.trim();
  }
  return socket.handshake.address;
}

function broadcastLobby() {
  io.to("lobby").emit("lobby:tables", tableManager.listTables());
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
      broadcastLobby();
    }
  });
}

io.on("connection", (socket) => {
  console.log(`[connect] ${socket.id}`);

  // --- User identity (B: socket takeover — same userId kicks old socket) ---
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
    socket.emit("lobby:tables", tableManager.listTables());
  });

  // --- Table lifecycle ---
  socket.on("table:create", (config) => {
    const userId = socketUserMap.get(socket.id);

    if (!userId) {
      // Legacy auto-start mode (no user registered)
      const table = tableManager.createTable(config, undefined, true);
      wireTableEvents(table.id);
      broadcastLobby();
      table.start().catch((err) => {
        console.error(`[table:${table.id}] error:`, err);
      });
      return;
    }

    if (tableManager.hasActiveTable()) {
      socket.emit("table:error", "Already an active table");
      return;
    }

    const table = tableManager.createTable(config, userId);
    wireTableEvents(table.id);
    broadcastLobby();
  });

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
  });

  socket.on("table:sit", (tableId) => {
    const userId = socketUserMap.get(socket.id);
    if (!userId) { socket.emit("table:error", "Not registered"); return; }

    const agentConfig = agentStore.getByUserId(userId);
    if (!agentConfig) { socket.emit("table:error", "No agent configured"); return; }

    const table = tableManager.getTable(tableId);
    if (!table) { socket.emit("table:error", "Table not found"); return; }

    // (A) Same IP can only occupy 1 seat per table
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

  socket.on("table:leave-seat", (tableId) => {
    const userId = socketUserMap.get(socket.id);
    if (!userId) return;

    const table = tableManager.getTable(tableId);
    if (!table) return;

    table.leaveSeat(userId);
    broadcastSeats(tableId);
  });

  socket.on("table:fillAI", (tableId) => {
    const userId = socketUserMap.get(socket.id);
    const table = tableManager.getTable(tableId);
    if (!table || table.creatorUserId !== userId) {
      socket.emit("table:error", "Only the creator can fill AI");
      return;
    }
    table.fillWithAI();
    broadcastSeats(tableId);
  });

  socket.on("table:start", (tableId) => {
    const userId = socketUserMap.get(socket.id);
    const table = tableManager.getTable(tableId);
    if (!table || table.creatorUserId !== userId) {
      socket.emit("table:error", "Only the creator can start");
      return;
    }

    if (table.getOccupiedCount() < 2) {
      socket.emit("table:error", "Need at least 2 players");
      return;
    }

    io.to(`table:${tableId}`).emit("table:started", tableId);
    broadcastLobby();

    const agentConfigs = tableManager.getAgentConfigs(tableId);
    table.start(agentConfigs).catch((err) => {
      console.error(`[table:${tableId}] error:`, err);
    });
  });

  socket.on("table:stop", (tableId: string) => {
    const uid = socketUserMap.get(socket.id);
    if (!uid) return;
    const table = tableManager.getTable(tableId);
    if (!table) return;
    if (table.creatorUserId !== uid) return;
    tableManager.removeTable(tableId);
    io.to(`table:${tableId}`).emit("table:stopped", tableId);
    broadcastLobby();
  });

  socket.on("disconnect", () => {
    const uid = socketUserMap.get(socket.id);
    socketUserMap.delete(socket.id);
    // Only remove from userSocketMap if this socket is still the active one for that user
    if (uid && userSocketMap.get(uid) === socket.id) {
      userSocketMap.delete(uid);
    }
    console.log(`[disconnect] ${socket.id}`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`CyberCasino server running on port ${PORT}`);
});
