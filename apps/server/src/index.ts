import { createServer } from "http";
import { Server } from "socket.io";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import crypto from "node:crypto";
import type { ServerToClientEvents, ClientToServerEvents, BuiltinPersonalityInfo, AgentConfigV2 } from "@cybercasino/shared";
import { TableManager } from "./table-manager";
import { UserStore, AgentStore, GameHistoryStore, initStores } from "./stores";
import { PERSONALITIES } from "./agents/personalities";
import { validateStrategyConfig, validateStrategyPackage, validatePreview, createAgentFromAI } from "./api/agent-create";
import type { CreateAgentRequest } from "./api/agent-create";
import { wsAgentManager } from "./agents/websocket-agent-manager";
import { verifyJwt } from "./auth";

const PORT = parseInt(process.env.PORT ?? "3001");
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me";

// Global exception handlers — log but don't crash
process.on("uncaughtException", (err) => {
  console.error("[FATAL] uncaughtException:", err.stack ?? err.message);
});
process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] unhandledRejection:", reason);
});

function authenticatedUser(req: { headers: { cookie?: string | string[] } }, handshakeAuth?: { token?: string }) {
  const cookie = Array.isArray(req.headers.cookie) ? req.headers.cookie.join(";") : req.headers.cookie;
  const token = handshakeAuth?.token || cookie?.match(/(?:^|;\s*)cybercasino-token=([^;]*)/)?.[1];
  return token ? verifyJwt(token, JWT_SECRET) : null;
}

// Helper: find agent by token (soul key)
function findAgentByToken(token: string, store: AgentStore): AgentConfigV2 | undefined {
  return store.getV2ByToken(token);
}

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
    if (authenticatedUser(req)?.userId !== userId) {
      res.writeHead(401, { "Content-Type": "application/json", ...corsHeaders });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    const agent = agentStore.getV2ByUserId(userId);
    res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify(agent ? { agent } : { agent: null }));
    return;
  }

  // Get all V2 agents for a user
  const listMatch = req.url?.match(/^\/api\/agents\/list\?userId=(.+)$/);
  if (listMatch && req.method === "GET") {
    const userId = decodeURIComponent(listMatch[1]);
    if (authenticatedUser(req)?.userId !== userId) {
      res.writeHead(401, { "Content-Type": "application/json", ...corsHeaders });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    const agents = agentStore.getAllV2ByUserId(userId);
    res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ agents }));
    return;
  }

  // Generate soul URL (unique per agent creation)
  if (req.url === "/api/agents/soul" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const session = authenticatedUser(req);
        if (!session) {
          res.writeHead(401, { "Content-Type": "application/json", ...corsHeaders });
          res.end(JSON.stringify({ error: "Unauthorized" }));
          return;
        }
        const { name, avatar, soulKey: existingSoulKey } = JSON.parse(body);
        const currentAgent = agentStore.getV2ByUserId(session.userId);
        if (currentAgent && !existingSoulKey) {
          res.writeHead(409, { "Content-Type": "application/json", ...corsHeaders });
          res.end(JSON.stringify({ error: "Only one agent is supported", message: "当前账号已有参赛 Agent，请使用现有灵魂链接继续编辑。" }));
          return;
        }
        if (existingSoulKey) {
          const storedAgent = agentStore.getV2ByToken(existingSoulKey);
          const pendingSoul = soulStore.get(existingSoulKey);
          if ((storedAgent && storedAgent.userId !== session.userId)
            || (pendingSoul && pendingSoul.userId !== session.userId)
            || (currentAgent && currentAgent.soulKey !== existingSoulKey)) {
            res.writeHead(403, { "Content-Type": "application/json", ...corsHeaders });
            res.end(JSON.stringify({ error: "Soul link does not belong to this user" }));
            return;
          }
        }
        const key = existingSoulKey || `user-${session.userId}-${crypto.randomBytes(4).toString("hex")}`;
        soulStore.set(key, {
          userId: session.userId, name, avatar: avatar ?? "🤖", createdAt: Date.now(),
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
  const soulMatch = req.url?.match(/^\/api\/agents\/soul\/(user-[a-zA-Z0-9:-]+)$/);
  if (soulMatch && req.method === "GET") {
    const key = soulMatch[1];
    const persistedAgent = agentStore.getV2ByToken(key);
    const soul = soulStore.get(key) ?? (persistedAgent
      ? {
          userId: persistedAgent.userId,
          name: persistedAgent.name,
          avatar: persistedAgent.avatar,
          createdAt: persistedAgent.createdAt,
        }
      : undefined);
    if (!soul) {
      res.writeHead(404, { "Content-Type": "application/json", ...corsHeaders });
      res.end(JSON.stringify({ error: "Soul not found" }));
      return;
    }
    try {
      const promptPath = join(import.meta.dirname, "../src/prompts/agent-creation-prompt.md");
      let template = readFileSync(promptPath, "utf-8");
      const baseUrl = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
      const wsAgentUrl = baseUrl.replace(/^http/, "ws") + "/agent";
      template = template
        .replace(/\{API_BASE_URL\}/g, baseUrl)
        .replace(/\{WS_AGENT_URL\}/g, wsAgentUrl)
        .replace("{API_TOKEN}", key)
        .replace(/\{NAME\}/g, soul.name)
        .replace(/\{AVATAR\}/g, soul.avatar);

      // Check if agent already exists → edit mode
      const existingAgent = persistedAgent ?? agentStore.getV2ByUserId(soul.userId);
      if (existingAgent) {
        const configJson = JSON.stringify(existingAgent.strategyPackage ?? existingAgent.strategy, null, 2);
        const editSection = `## 编辑模式

牌手「${soul.name}」已有完整策略配置，你不需要从零创建。

以下是当前策略包（旧牌手可能显示为待升级的策略配置）：

\`\`\`json
${configJson}
\`\`\`

**你的任务：**
1. 先快速总结当前牌手的风格特点（2-3 句）
2. 然后问用户想怎么调整："想怎么改？比如调整松紧度、改变某个位置的起手牌范围、修改性格/语气、或者降低犯错率？"

改动时**在现有策略基础上生成下一版 Strategy Package**，不要重新设计。用户没说改的部分保持原样，并在 manifest 中递增 version、填写 basedOnVersion。`;
        template = template.replace("{CONFIG_CONTEXT}", editSection);
      } else {
        template = template.replace("{CONFIG_CONTEXT}", "");
      }

      // Append a brief note about open ranked competition.
      const executionModeNote = `

---

## 排名赛说明

默认使用认证 WebSocket 将牌局视图发送给你的外部 Agent，由它自主返回动作；提交的 \`Strategy Package v1\` 同时作为未连接或超时时的平台 fallback。你也可以显式选择 \`verified_package\`，完全由平台执行策略包。WebSocket 不作为开赛前强制在线检查，未连接时 fallback 的结果仍计入排名。
`;
      template += executionModeNote;

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
        let { config, strategyPackage, executionMode, preview, soulKey, skillId } = parsed as CreateAgentRequest & { soulKey?: string; skillId?: string };
        // Fallback: extract soul key from Authorization header (AI sends token there)
        if (!soulKey && req.headers.authorization?.startsWith("Bearer ")) {
          soulKey = req.headers.authorization.slice(7);
        }

        const configResult = strategyPackage
          ? validateStrategyPackage(strategyPackage)
          : config
            ? validateStrategyConfig(config)
            : { valid: false, errors: ["config 或 strategyPackage 必须提供一个"] };
        if (!configResult.valid) {
          res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders });
          res.end(JSON.stringify({ error: "Invalid strategy config", details: configResult.errors }));
          return;
        }
        if (executionMode && executionMode !== "remote_agent" && executionMode !== "verified_package") {
          res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders });
          res.end(JSON.stringify({ error: "Invalid executionMode" }));
          return;
        }

        const previewResult = validatePreview(preview);
        if (!previewResult.valid) {
          res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders });
          res.end(JSON.stringify({ error: "Invalid preview", details: previewResult.errors }));
          return;
        }

        // The capability token must have been issued by the platform or
        // belong to an existing stored agent. Never infer identity from text.
        let userId: string | undefined;
        let finalPreview = preview;
        if (soulKey) {
          const soul = soulStore.get(soulKey);
          if (soul) {
            userId = soul.userId;
            finalPreview = { ...preview, name: soul.name, avatar: soul.avatar };
          } else {
            userId = agentStore.getV2ByToken(soulKey)?.userId;
          }
        }
        if (!userId) {
          res.writeHead(401, { "Content-Type": "application/json", ...corsHeaders });
          res.end(JSON.stringify({ error: "Invalid soul token" }));
          return;
        }

        const existingAgent = soulKey ? agentStore.getV2ByToken(soulKey) : undefined;
        const currentAgent = agentStore.getV2ByUserId(userId);
        if (currentAgent && !existingAgent) {
          res.writeHead(409, { "Content-Type": "application/json", ...corsHeaders });
          res.end(JSON.stringify({
            error: "Only one agent is supported",
            message: "当前账号已有参赛 Agent，请基于现有灵魂链接提交新策略版本。",
          }));
          return;
        }
        if (existingAgent && tableManager.isAgentPlaying(existingAgent.id)) {
          res.writeHead(409, { "Content-Type": "application/json", ...corsHeaders });
          res.end(JSON.stringify({
            error: "Agent is currently competing",
            message: "比赛进行中不能修改该 Agent 的策略；请在比赛结束后提交新版本。",
          }));
          return;
        }
        const agent = createAgentFromAI(userId, { config, strategyPackage, executionMode, preview: finalPreview }, () => agentStore.nextV2Id(), soulKey, skillId, existingAgent);
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

    // Live table: reconstruct from memory
    if (table && table.getStatus() === "finished") {
      const replayData = table.getReplayData();
      res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
      res.end(JSON.stringify(replayData));
      return;
    }

    // Archived: check persistent storage (stored as ReplayData)
    const archived = gameHistoryStore.get(tableId);
    if (archived) {
      res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
      res.end(JSON.stringify(archived.events));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ error: "Table not found or not finished" }));
    return;
  }

  if (req.url === "/api/leaderboard" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ standings: gameHistoryStore.getLeaderboard() }));
    return;
  }

  // --- External Agent: Create agent and generate soul link ---
  if (req.url === "/api/external-agent/create" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const session = authenticatedUser(req);
        if (!session) {
          res.writeHead(401, { "Content-Type": "application/json", ...corsHeaders });
          res.end(JSON.stringify({ error: "Unauthorized" }));
          return;
        }
        if (agentStore.getV2ByUserId(session.userId)) {
          res.writeHead(409, { "Content-Type": "application/json", ...corsHeaders });
          res.end(JSON.stringify({ error: "Only one agent is supported", message: "当前账号已有参赛 Agent。" }));
          return;
        }
        const { name, avatar } = JSON.parse(body);
        const agentId = agentStore.nextV2Id();
        const token = `cc_${crypto.randomBytes(16).toString("hex")}`;
        const now = Date.now();

        const agent: AgentConfigV2 = {
          id: agentId,
          userId: session.userId,
          name: name ?? "My Agent",
          avatar: avatar ?? "🤖",
          strategy: { skillId: "tight-aggressive", preflop: {} as any, postflop: [] },
          executionMode: "remote_agent",
          strategyVersion: 1,
          soulKey: token,
          stylePrompt: "",
          createdAt: now,
          updatedAt: now,
        };
        agentStore.saveV2(agent);

        const baseUrl = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
        const wsUrl = baseUrl.replace(/^http/, "ws") + "/agent";
        const apiUrl = baseUrl + "/api/agent";

        const instructions = `你是一个扑克 Agent。通过 WebSocket 连接到 CyberCasino 打德州扑克。

## 连接协议
1. 连接 ${wsUrl}
2. 发送认证：{"type":"authenticate","token":"${token}"}
3. 等待 {"type":"authenticated"} 确认

## 风格设置
通过对话了解玩家的风格偏好，然后发送 update_style 设置风格。
比赛开始后，本场使用的 platform fallback prompt 会被冻结。此时发送 update_style 会保存为下一场配置，并收到 style_update_deferred，不改变正在进行的比赛。

支持三种格式：

### 格式 A：高层参数（推荐，简单）
{"type":"update_style","highLevel":{"tightness":0.6,"aggression":0.7,"bluffFrequency":0.3,"valueOrientation":0.5,"adaptability":0.5}}

### 格式 B：精确 10 维（进阶）
{"type":"update_style","profile":{"preflopLooseness":0.5,"aggression":0.6,"bluffAppetite":0.3,"valueThinness":0.5,"cbetPressure":0.5,"defenseStickiness":0.5,"sizingPressure":0.5,"trapTendency":0.3,"adaptationRate":0.5,"varianceTolerance":0.5}}

### 格式 C：混合
{"type":"update_style","highLevel":{"tightness":0.5},"override":{"trapTendency":0.9}}

### 格式 D：纯文本（向后兼容）
{"type":"update_style","style":"激进型，喜欢bluff"}

## 回合决策
当收到 {"type":"your_turn",...} 消息时，调用你的 LLM 分析牌局，返回：
{"type":"action","action":"raise","amount":400,"thought":"你的分析","isBluffing":false}

## 查询历史
GET ${apiUrl}/hands?limit=20 (Header: Authorization: Bearer ${token})

## 查询统计
GET ${apiUrl}/stats (Header: Authorization: Bearer ${token})`;

        const soulLink = JSON.stringify({
          token,
          wss: wsUrl,
          api: apiUrl,
          instructions,
        }, null, 2);

        res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
        res.end(JSON.stringify({
          agentId,
          token,
          soulLink,
          soulLinkBase64: Buffer.from(soulLink).toString("base64"),
        }));
      } catch (err) {
        console.error("[api] external agent create error:", err);
        res.writeHead(500, { "Content-Type": "application/json", ...corsHeaders });
        res.end(JSON.stringify({ error: "Failed to create agent" }));
      }
    });
    return;
  }

  // --- External Agent: Query hand history ---
  const agentHandsMatch = req.url?.match(/^\/api\/agent\/hands(?:\?(.+))?$/);
  if (agentHandsMatch && req.method === "GET") {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
      res.writeHead(401, { "Content-Type": "application/json", ...corsHeaders });
      res.end(JSON.stringify({ error: "Missing authorization" }));
      return;
    }

    // Find agent by soul key
    const agent = findAgentByToken(token, agentStore);
    if (!agent) {
      res.writeHead(404, { "Content-Type": "application/json", ...corsHeaders });
      res.end(JSON.stringify({ error: "Agent not found" }));
      return;
    }

    const params = new URLSearchParams(agentHandsMatch[1] ?? "");
    const roomId = params.get("roomId");
    const limit = parseInt(params.get("limit") ?? "20");

    const allHistory = gameHistoryStore.getAll();
    const hands = allHistory
      .filter(h => !roomId || h.info.id === roomId)
      .filter(h => h.events.players.some((player) => player.id === agent.id))
      .flatMap(h => h.events.hands.map((hand) => ({
            ...hand,
            tableId: h.info.id,
            tableName: h.info.name,
          })))
      .slice(0, limit);

    res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ hands }));
    return;
  }

  // --- External Agent: Query stats ---
  if (req.url === "/api/agent/stats" && req.method === "GET") {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
      res.writeHead(401, { "Content-Type": "application/json", ...corsHeaders });
      res.end(JSON.stringify({ error: "Missing authorization" }));
      return;
    }

    const agent = findAgentByToken(token, agentStore);
    if (!agent) {
      res.writeHead(404, { "Content-Type": "application/json", ...corsHeaders });
      res.end(JSON.stringify({ error: "Agent not found" }));
      return;
    }

    const allHistory = gameHistoryStore.getAll();
    let totalHands = 0;
    let wins = 0;
    let tournaments = 0;
    let tournamentWins = 0;

    for (const h of allHistory) {
      if (!h.events.players.some((player) => player.id === agent.id)) continue;
      tournaments++;
      totalHands += h.events.hands.length;
      for (const hand of h.events.hands) {
        if (hand.winners.some((winner) => winner.playerId === agent.id)) wins++;
      }
      if (h.events.rankings.some((result) => result.playerId === agent.id && result.position === 1)) tournamentWins++;
    }
    const standing = gameHistoryStore.getLeaderboard().find((entry) => entry.agentId === agent.id);

    res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({
      agentId: agent.id,
      name: agent.name,
      totalHands,
      wins,
      winRate: totalHands > 0 ? wins / totalHands : 0,
      tournaments,
      tournamentWins,
      rating: standing?.rating ?? 1000,
      activeStrategyVersion: agent.strategyVersion ?? agent.strategyPackage?.manifest.version,
      stylePrompt: agent.stylePrompt ?? "",
    }));
    return;
  }

  res.writeHead(404, corsHeaders);
  res.end();
});
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: process.env.CORS_ORIGIN ?? "http://localhost:3000", credentials: true },
  // Prevent Engine.IO from destroying WebSocket upgrade sockets on non-/socket.io/ paths.
  // Our ws library (at /agent) handles its own upgrades; Engine.IO's 1s destroyUpgrade
  // timeout could race with the ws handshake.
  destroyUpgrade: false,
});

// Attach WebSocket server for external agents
wsAgentManager.attach(httpServer);
wsAgentManager.setStyleUpdateCallback((agentId, style, profile, status) => {
  agentStore.updateStylePrompt(agentId, style, profile, status);
});

const tableManager = new TableManager();
const userStore = new UserStore();
const agentStore = new AgentStore();
const gameHistoryStore = new GameHistoryStore();
tableManager.setHistoryStore(gameHistoryStore);
wsAgentManager.setAuthenticationResolver((token) => {
  const agent = findAgentByToken(token, agentStore);
  if (!agent || agent.executionMode !== "remote_agent") return undefined;
  wsAgentManager.loadStylePrompt(agent.id, agent.stylePrompt ?? "", agent.styleProfile);
  return { id: agent.id, name: agent.name };
});

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

function createNextRankedTable(): void {
  const newTable = tableManager.ensurePresetTable();
  wireTableEvents(newTable.id);
  broadcastLobby();
}

function wireTableEvents(tableId: string) {
  const table = tableManager.getTable(tableId);
  if (!table) return;

  table.onLiveEvent((event) => {
    io.to(`table:${tableId}`).emit("game:event", event);
  });

  table.onEvent((event) => {
    if (event.type === "tournament-complete") {
      void tableManager.archiveFinishedTable(tableId).then((archived) => {
        if (!archived) return;
        io.to(`table:${tableId}`).emit("game:reset");
        for (const completedEvent of table.getEventHistory()) {
          io.to(`table:${tableId}`).emit("game:event", completedEvent);
        }
        createNextRankedTable();
      }).catch((err) => {
        console.error(`[table:${tableId}] failed to persist completed match:`, err);
        io.to(`table:${tableId}`).emit("table:error", "比赛结果保存失败，本场暂未计入排名，请稍后重试。");
        createNextRankedTable();
      });
    }
  });
}

function abortFailedTable(tableId: string, err: unknown): void {
  console.error(`[table:${tableId}] error:`, err);
  tableManager.getTable(tableId)?.stop();
  io.to(`table:${tableId}`).emit("table:error", "比赛异常终止，本场不计入排名，请返回大厅重新加入。");
  io.to(`table:${tableId}`).emit("table:stopped", tableId);
  tableManager.removeTable(tableId);
  createNextRankedTable();
}

// Create initial preset table on startup
const initialRankedTable = tableManager.ensurePresetTable();
wireTableEvents(initialRankedTable.id);

io.on("connection", (socket) => {
  console.log(`[connect] ${socket.id}`);

  socket.on("user:register", (userId, userInfo) => {
    const session = authenticatedUser({ headers: { cookie: socket.handshake.headers.cookie } }, socket.handshake.auth);
    if (!userId || !session || session.userId !== userId) {
      socket.emit("table:error", "登录身份校验失败，请重新登录");
      return;
    }

    let identity = userStore.get(userId);
    if (!identity && (userId.startsWith("github:") || userId.startsWith("google:"))) {
      identity = {
        userId,
        name: session.name,
        avatar: session.avatar,
        provider: session.provider as "github" | "google",
        createdAt: Date.now(),
      };
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

  socket.on("agent:delete", (agentId) => {
    const userId = socketUserMap.get(socket.id);
    if (!userId) { socket.emit("table:error", "Not registered"); return; }
    if (tableManager.isAgentPlaying(agentId)) {
      socket.emit("table:error", "比赛进行中不能删除正在参赛的 Agent");
      return;
    }
    agentStore.deleteV2(userId, agentId);
    socket.emit("agent:deleted", agentId);
  });

  // --- Lobby ---
  socket.on("lobby:join", () => {
    socket.join("lobby");
    socket.emit("lobby:tables", tableManager.getHomepageTables());
    socket.emit("lobby:personalities", personalitiesInfo);
  });

  // --- Table lifecycle ---
  socket.on("table:join", (tableId) => {
    const prevRooms = [...socket.rooms].filter(r => r.startsWith("table:"));
    console.log(`[table:join] ${socket.id} joining ${tableId}, prev rooms: ${prevRooms.join(",") || "none"}`);

    // Leave any previously joined table rooms to prevent event leakage
    for (const room of socket.rooms) {
      if (room.startsWith("table:")) socket.leave(room);
    }

    // 先 reset 清客户端 buffer，再推送新牌桌事件
    socket.emit("game:reset");

    const table = tableManager.getTable(tableId);
    if (!table) {
      const replay = gameHistoryStore.get(tableId)?.events;
      const eventCount = replay?.timeline?.length ?? 0;
      console.log(`[table:join] ${tableId} not in memory, sending ${eventCount} history events`);
      for (const event of replay?.timeline ?? []) {
        socket.emit("game:event", event);
      }
      return;
    }
    console.log(`[table:join] ${tableId} found in memory, status=${table.getStatus()}`);
    socket.join(`table:${tableId}`);
    if (table.getStatus() === "playing") {
      const events = table.getLiveEventHistory();
      console.log(`[table:join] sending ${events.length} live events`);
      for (const event of events) {
        socket.emit("game:event", event);
      }
    } else if (table.getStatus() === "finished") {
      const events = table.getEventHistory();
      console.log(`[table:join] sending ${events.length} finished events`);
      for (const event of events) {
        socket.emit("game:event", event);
      }
    }
  });

  socket.on("table:leave", (tableId) => {
    console.log(`[table:leave] ${socket.id} leaving ${tableId}, rooms: ${[...socket.rooms].join(",")}`);
    socket.leave(`table:${tableId}`);
    socket.emit("lobby:tables", tableManager.getHomepageTables());
  });

  socket.on("table:sit", (tableId) => {
    const userId = socketUserMap.get(socket.id);
    if (!userId) { socket.emit("table:error", "Not registered"); return; }

    const v2Config = agentStore.getV2ByUserId(userId);
    if (!v2Config) { socket.emit("table:error", "No agent configured"); return; }

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
    const executionMode = v2Config.executionMode === "verified_package" ? "verified_package" : "remote_agent";
    if (!table.sit(v2Config, executionMode, v2Config.strategyVersion ?? v2Config.strategyPackage?.manifest.version)) {
      socket.emit("table:error", "Cannot sit (table full or already seated)");
      return;
    }

    tableManager.setAgentV2Config(tableId, userId, v2Config);
    socket.join(`table:${tableId}`);
    broadcastSeats(tableId);
  });

  socket.on("table:sit-builtin", (tableId, personalityId) => {
    const userId = socketUserMap.get(socket.id);
    const table = tableManager.getTable(tableId);
    if (!table) { socket.emit("table:error", "Table not found"); return; }
    if (!table.canManage(userId)) { socket.emit("table:error", "请先让自己的 Agent 入座后再配置牌桌"); return; }

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

    if (seat.agent?.type === "builtin" && table.canManage(userId)) {
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
    const userId = socketUserMap.get(socket.id);
    const table = tableManager.getTable(tableId);
    if (!table) return;
    if (table.getStatus() !== "waiting") return;
    if (!table.canManage(userId)) { socket.emit("table:error", "只有牌桌创建者可以清空座位"); return; }
    table.clearAllSeats();
    broadcastSeats(tableId);
  });

  socket.on("table:start", (tableId, language) => {
    const userId = socketUserMap.get(socket.id);
    const table = tableManager.getTable(tableId);
    if (!table) { socket.emit("table:error", "Table not found"); return; }
    if (!table.canManage(userId)) { socket.emit("table:error", "只有牌桌创建者可以开始排名赛"); return; }

    if (!table.isFull()) {
      socket.emit("table:error", "需要6位玩家才能开始");
      return;
    }

    const v2Configs = tableManager.getAgentV2Configs(tableId);
    const match = table.start(language ?? "zh", v2Configs);
    io.to(`table:${tableId}`).emit("table:started", tableId);
    broadcastLobby();
    match.catch((err) => abortFailedTable(tableId, err));
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

initStores().then(() => {
  agentStore.activatePendingStylesAfterRestart();
  tableManager.loadPersistedHistory();
  httpServer.listen(PORT, () => {
    console.log(`CyberCasino server running on port ${PORT}`);
  });
}).catch((err) => {
  console.error("[startup] Failed to initialize stores:", err);
  process.exit(1);
});
