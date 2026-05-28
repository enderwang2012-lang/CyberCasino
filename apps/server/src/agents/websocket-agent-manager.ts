import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type {
  AgentGameView,
  AgentDecision,
  ActionType,
  ActionRecord,
  StyleProfile,
  HighLevelStyle,
  StrategyConfig,
} from "@cybercasino/shared";
import type { IPokerAgent } from "./agent-interface";
import { parseStyleToPersonality, parseStyleInput } from "./style-parser";
import { ruleDecide, ruleFallback } from "./rule-engine";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WsAgentConnection {
  ws: WebSocket;
  agentId: string;
  name: string;
  token: string;
  stylePrompt: string;
  styleProfile?: StyleProfile;
  connectedAt: number;
  lastHeartbeat: number;
}

interface PendingDecision {
  resolve: (decision: AgentDecision) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  timeoutMs: number;
  yourTurnPayload: Record<string, unknown>;
}

interface AuthenticatedAgent {
  id: string;
  name: string;
}

interface PendingStyleUpdate {
  stylePrompt: string;
  styleProfile: StyleProfile;
}

// ---------------------------------------------------------------------------
// WebSocket Agent Manager
// ---------------------------------------------------------------------------

export class WebSocketAgentManager {
  private wss: WebSocketServer | null = null;
  private connections = new Map<string, WsAgentConnection>(); // token → connection
  private agentIdToToken = new Map<string, string>(); // agentId → token
  private pendingDecisions = new Map<string, PendingDecision>(); // `${agentId}:${handIndex}` → pending
  private stylePrompts = new Map<string, string>(); // agentId → stylePrompt (persisted)
  private styleProfiles = new Map<string, StyleProfile>(); // agentId → StyleProfile (V2)
  private activeMatchLocks = new Map<string, Set<string>>(); // agentId → table IDs
  private pendingStyleUpdates = new Map<string, PendingStyleUpdate>(); // agentId → next-match style

  // Callback to persist style prompt to DB
  private onStyleUpdate?: (agentId: string, style: string, profile: StyleProfile, status: "active" | "pending" | "activate_pending") => void;
  private resolveToken?: (token: string) => AuthenticatedAgent | undefined;

  setStyleUpdateCallback(cb: (agentId: string, style: string, profile: StyleProfile, status: "active" | "pending" | "activate_pending") => void) {
    this.onStyleUpdate = cb;
  }

  setAuthenticationResolver(cb: (token: string) => AuthenticatedAgent | undefined) {
    this.resolveToken = cb;
  }

  loadStylePrompt(agentId: string, style: string, profile?: StyleProfile) {
    this.stylePrompts.set(agentId, style);
    this.styleProfiles.set(agentId, profile ?? parseStyleInput({ text: style }));
  }

  getStyleProfile(agentId: string): StyleProfile | undefined {
    return this.styleProfiles.get(agentId);
  }

  getStylePrompt(agentId: string): string {
    return this.stylePrompts.get(agentId) ?? "";
  }

  lockStyleForMatch(agentId: string, tableId: string): void {
    const locks = this.activeMatchLocks.get(agentId) ?? new Set<string>();
    locks.add(tableId);
    this.activeMatchLocks.set(agentId, locks);
  }

  unlockStyleForMatch(agentId: string, tableId: string): void {
    const locks = this.activeMatchLocks.get(agentId);
    if (!locks) return;

    locks.delete(tableId);
    if (locks.size > 0) return;
    this.activeMatchLocks.delete(agentId);

    const pending = this.pendingStyleUpdates.get(agentId);
    if (!pending) return;

    this.pendingStyleUpdates.delete(agentId);
    this.applyActiveStyle(agentId, pending.stylePrompt, pending.styleProfile);
    this.onStyleUpdate?.(agentId, pending.stylePrompt, pending.styleProfile, "activate_pending");

    const conn = this.getConnection(agentId);
    if (conn?.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(JSON.stringify({
        type: "style_update_applied",
        appliesTo: "next_match",
        profile: { ...pending.styleProfile },
      }));
    }
  }

  isStyleLocked(agentId: string): boolean {
    return (this.activeMatchLocks.get(agentId)?.size ?? 0) > 0;
  }

  updateStyle(
    agentId: string,
    stylePrompt: string,
    styleProfile: StyleProfile,
  ): "applied" | "deferred" {
    if (this.isStyleLocked(agentId)) {
      this.pendingStyleUpdates.set(agentId, { stylePrompt, styleProfile });
      this.onStyleUpdate?.(agentId, stylePrompt, styleProfile, "pending");
      return "deferred";
    }

    this.applyActiveStyle(agentId, stylePrompt, styleProfile);
    this.onStyleUpdate?.(agentId, stylePrompt, styleProfile, "active");
    return "applied";
  }

  private applyActiveStyle(agentId: string, stylePrompt: string, styleProfile: StyleProfile): void {
    this.stylePrompts.set(agentId, stylePrompt);
    this.styleProfiles.set(agentId, styleProfile);
    const conn = this.getConnection(agentId);
    if (conn) {
      conn.stylePrompt = stylePrompt;
      conn.styleProfile = styleProfile;
    }
  }

  // -----------------------------------------------------------------------
  // Server setup
  // -----------------------------------------------------------------------

  attach(server: Server) {
    this.wss = new WebSocketServer({ server, path: "/agent" });

    this.wss.on("connection", (ws, req) => {
      const ip = req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim()
        ?? req.socket.remoteAddress ?? "unknown";
      console.log(`[ws-agent] new connection from ${ip}`);

      let authenticated = false;
      let connToken = "";

      ws.on("message", (raw) => {
        let msg: any;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
          return;
        }

        // --- authenticate ---
        if (msg.type === "authenticate") {
          if (authenticated) {
            ws.send(JSON.stringify({ type: "error", message: "Already authenticated" }));
            return;
          }

          const token = msg.token;
          if (!token || typeof token !== "string") {
            ws.send(JSON.stringify({ type: "error", message: "Missing token" }));
            return;
          }

          const authenticatedAgent = this.resolveToken?.(token);
          if (!authenticatedAgent) {
            ws.send(JSON.stringify({ type: "error", message: "Invalid agent token" }));
            ws.close(4003, "Authentication failed");
            return;
          }

          connToken = token;
          authenticated = true;

          // Identity is resolved exclusively from the server-held token.
          const agentId = authenticatedAgent.id;

          // Close existing connection for this token if any
          const existing = this.connections.get(token);
          if (existing && existing.ws.readyState === WebSocket.OPEN) {
            existing.ws.close(4001, "Replaced by new connection");
          }

          const conn: WsAgentConnection = {
            ws,
            agentId,
            name: authenticatedAgent.name,
            token,
            stylePrompt: this.stylePrompts.get(agentId) ?? "",
            styleProfile: this.styleProfiles.get(agentId),
            connectedAt: Date.now(),
            lastHeartbeat: Date.now(),
          };
          this.connections.set(token, conn);
          this.agentIdToToken.set(agentId, token);

          ws.send(JSON.stringify({
            type: "authenticated",
            agentId,
            name: conn.name,
          }));

          // On reconnection: resend pending decision with a fresh timeout
          const pending = this.pendingDecisions.get(agentId);
          if (pending) {
            clearTimeout(pending.timer);
            pending.timer = setTimeout(() => {
              this.pendingDecisions.delete(agentId);
              pending.reject(new Error("Decision timeout"));
            }, pending.timeoutMs);
            ws.send(JSON.stringify(pending.yourTurnPayload));
          }

          console.log(`[ws-agent] ${agentId} authenticated`);
          return;
        }

        if (!authenticated) {
          ws.send(JSON.stringify({ type: "error", message: "Not authenticated" }));
          return;
        }

        // --- action (decision response) ---
        if (msg.type === "action") {
          const conn = this.connections.get(connToken);
          if (!conn) return;

          const actionKey = `${conn.agentId}`;
          const pending = this.pendingDecisions.get(actionKey);
          if (!pending) {
            // No pending decision — might be a stale response, ignore
            return;
          }

          clearTimeout(pending.timer);
          this.pendingDecisions.delete(actionKey);

          // Validate action
          const action = msg.action as string;
          if (!["fold", "check", "call", "raise"].includes(action)) {
            pending.reject(new Error(`Invalid action: ${action}`));
            return;
          }

          const decision: AgentDecision = {
            action: {
              type: action as ActionType,
              amount: action === "raise" ? msg.amount : undefined,
            },
            thought: {
              message: msg.thought ?? "...",
              confidence: msg.confidence ?? 0.5,
              isBluffing: msg.isBluffing ?? false,
              thinkingSource: "llm",
            },
          };

          pending.resolve(decision);
          return;
        }

        // --- update_style (supports text, highLevel, profile, or mixed) ---
        if (msg.type === "update_style") {
          const conn = this.connections.get(connToken);
          if (!conn) return;

          let styleText = "";
          let styleProfile: StyleProfile | undefined;

          if (typeof msg.style === "string") {
            // Format A: plain text (backward compatible)
            styleText = msg.style;
            styleProfile = parseStyleInput({ text: styleText });
          } else if (msg.highLevel || msg.profile || msg.override) {
            // Format B/C/D: structured data
            if (msg.profile) {
              // Format B: full profile
              styleProfile = parseStyleInput({ profile: msg.profile });
            } else {
              // Format C: highLevel + optional override
              styleProfile = parseStyleInput({
                highLevel: msg.highLevel,
                override: msg.override,
              });
            }
            styleText = msg.highLevel
              ? JSON.stringify(msg.highLevel)
              : msg.profile
                ? JSON.stringify(msg.profile)
                : "";
          }

          if (styleProfile) {
            const updateStatus = this.updateStyle(conn.agentId, styleText, styleProfile);
            const responsePayload = updateStatus === "deferred"
              ? {
                  type: "style_update_deferred" as const,
                  appliesTo: "next_match" as const,
                  profile: { ...styleProfile },
                }
              : { type: "style_updated" as const, profile: { ...styleProfile } };
            const jsonStr = JSON.stringify(responsePayload);
            console.log(`[ws-agent] sending ${responsePayload.type} response:`, jsonStr);
            ws.send(jsonStr);
          }
          return;
        }

        // --- ping ---
        if (msg.type === "ping") {
          const conn = this.connections.get(connToken);
          if (conn) conn.lastHeartbeat = Date.now();
          ws.send(JSON.stringify({ type: "pong" }));
          return;
        }
      });

      ws.on("close", (code: number, reason: Buffer) => {
        if (connToken) {
          const conn = this.connections.get(connToken);
          if (conn && conn.ws === ws) {
            this.connections.delete(connToken);
            this.agentIdToToken.delete(conn.agentId);
            console.log(`[ws-agent] ${conn.agentId} disconnected code=${code}`);
          }
        }
      });

      ws.on("error", (err) => {
        console.error(`[ws-agent] error:`, err.message);
      });
    });

    // Heartbeat check every 30s
    setInterval(() => {
      const now = Date.now();
      for (const [token, conn] of this.connections) {
        if (now - conn.lastHeartbeat > 60_000) {
          console.log(`[ws-agent] agent ${conn.agentId} timed out (no heartbeat)`);
          conn.ws.close(4002, "Heartbeat timeout");
          this.connections.delete(token);
          this.agentIdToToken.delete(conn.agentId);
        }
      }
    }, 30_000);

    console.log("[ws-agent] WebSocket server attached at /agent");
  }

  // -----------------------------------------------------------------------
  // Connection queries
  // -----------------------------------------------------------------------

  isConnected(agentId: string): boolean {
    const token = this.agentIdToToken.get(agentId);
    if (!token) return false;
    const conn = this.connections.get(token);
    return !!conn && conn.ws.readyState === WebSocket.OPEN;
  }

  getConnection(agentId: string): WsAgentConnection | undefined {
    const token = this.agentIdToToken.get(agentId);
    if (!token) return undefined;
    return this.connections.get(token);
  }

  // -----------------------------------------------------------------------
  // Decision request (called by WebSocketAgent.decide)
  // -----------------------------------------------------------------------

  requestDecision(
    agentId: string,
    view: AgentGameView,
    validActions: ActionType[],
    callAmount: number,
    minRaise: number,
    stylePrompt: string,
    tableId = "",
    timeoutMs = 15_000,
    strategy?: StrategyConfig,
  ): Promise<AgentDecision> {
    const conn = this.connections.get(this.agentIdToToken.get(agentId) ?? "");
    if (!conn || conn.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Agent not connected"));
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingDecisions.delete(agentId);
        reject(new Error("Decision timeout"));
      }, timeoutMs);

      this.pendingDecisions.set(agentId, { resolve, reject, timer, timeoutMs, yourTurnPayload: {} });

      // Build your_turn message
      const potSize = view.pots.reduce((s, p) => s + p.amount, 0);
      const myCards = view.myCards.map(c => `${rankName(c.rank)}${c.suit}`);
      const board = view.communityCards.map(c => `${rankName(c.rank)}${c.suit}`);

      const players = view.players.map(p => ({
        name: p.name,
        chips: p.chips,
        currentBet: p.bet,
        status: p.folded ? "folded" : p.allIn ? "all-in" : "active",
        seatIndex: p.seatIndex,
      }));

      const actionHistory = view.actionHistory.map(a => ({
        player: view.players.find(p => p.id === a.playerId)?.name ?? a.playerId,
        action: a.action.type,
        amount: a.action.amount,
      }));

      const yourTurnMsg = {
        type: "your_turn",
        roomId: tableId,
        handIndex: view.handNumber,
        phase: view.phase,
        myCards,
        board,
        myChips: view.myChips,
        currentBet: view.currentBet,
        potSize,
        validActions,
        callAmount,
        minRaise,
        players,
        actionHistory,
        stylePrompt,
        strategy,
      };

      // Store payload for reconnection resync
      const pending = this.pendingDecisions.get(agentId);
      if (pending) pending.yourTurnPayload = yourTurnMsg;

      conn.ws.send(JSON.stringify(yourTurnMsg));
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rankName(rank: number): string {
  const names: Record<number, string> = {
    2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8",
    9: "9", 10: "10", 11: "J", 12: "Q", 13: "K", 14: "A",
  };
  return names[rank] ?? String(rank);
}

// Singleton
export const wsAgentManager = new WebSocketAgentManager();
