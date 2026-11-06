import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { randomUUID } from "node:crypto";
import type {
  AgentGameView,
  AgentDecision,
  ActionType,
  StyleProfile,
  StrategyConfig,
  DecisionContext,
  ExternalAgentMatchResult,
  ProtocolActionAck,
} from "@cybercasino/shared";
import { parseStyleInput, parseStyleUpdate } from "./style-parser";
import {
  actionAckFor,
  actionRejectedFor,
  decisionKey,
  parseActionMessage,
  parseResyncMessage,
  resyncRejectedFor,
  sameAction,
  snapshotMessageFor,
  type AgentSnapshotState,
  type SnapshotSource,
  type ParsedActionMessage,
} from "./external-agent-protocol";
import { MatchResultDeliveryQueue } from "./match-result-delivery";
import { SessionResultStore } from "./session-result-store";
import { matchResultMessageFor, type SessionResultMessage } from "./match-result-message";

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
  agentId: string;
  context: DecisionContext;
  turnToken: string;
  validActions: ActionType[];
  minRaiseTo: number;
  maxRaiseTo: number;
  resolve: (decision: AgentDecision) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  deadlineAt: number;
  yourTurnPayload: Record<string, unknown>;
}

interface AcceptedAction {
  agentId: string;
  action: ParsedActionMessage;
  ack: ProtocolActionAck;
  expiresAt: number;
}

interface AuthenticatedAgent {
  id: string;
  name: string;
}

interface PendingStyleUpdate {
  stylePrompt: string;
  styleProfile: StyleProfile;
}

const MATCH_RESULT_CLOSE_GRACE_MS = 5_000;
const DEFAULT_AUTH_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// WebSocket Agent Manager
// ---------------------------------------------------------------------------

export class WebSocketAgentManager {
  private readonly authTimeoutMs: number;
  private wss: WebSocketServer | null = null;
  private connections = new Map<string, WsAgentConnection>(); // token → connection
  private agentIdToToken = new Map<string, string>(); // agentId → token
  private pendingDecisions = new Map<string, PendingDecision>(); // agentId:table:hand:turn → pending
  private acceptedActions = new Map<string, AcceptedAction>(); // agentId:client_action_id → ack
  private stylePrompts = new Map<string, string>(); // agentId → stylePrompt (persisted)
  private styleProfiles = new Map<string, StyleProfile>(); // agentId → StyleProfile (V2)
  private activeMatchLocks = new Map<string, Set<string>>(); // agentId → table IDs
  private pendingStyleUpdates = new Map<string, PendingStyleUpdate>(); // agentId → next-match style
  private snapshotSources = new Map<string, SnapshotSource>(); // tableId → Agent-scoped snapshot source
  private readonly pendingMatchResults = new MatchResultDeliveryQueue();
  private sessionResults = new SessionResultStore();
  private readonly inFlightMatchResults = new Map<WebSocket, {
    agentId: string;
    results: Map<string, ExternalAgentMatchResult>;
  }>();

  constructor(options: { authTimeoutMs?: number } = {}) {
    this.authTimeoutMs = options.authTimeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS;
  }

  useSessionResultFile(file: string): void {
    this.sessionResults = new SessionResultStore(file);
  }

  // Callback to persist style prompt to DB
  private seasonEntered?: (agentId: string) => boolean;
  private onStyleUpdate?: (agentId: string, style: string, profile: StyleProfile, status: "active" | "pending" | "activate_pending") => void;
  private resolveToken?: (token: string) => AuthenticatedAgent | undefined;

  setSeasonEntered(check: (agentId: string) => boolean): void {
    this.seasonEntered = check;
  }

  setStyleUpdateCallback(cb: (agentId: string, style: string, profile: StyleProfile, status: "active" | "pending" | "activate_pending") => void) {
    this.onStyleUpdate = cb;
  }

  setAuthenticationResolver(cb: (token: string) => AuthenticatedAgent | undefined) {
    this.resolveToken = cb;
  }

  registerSnapshotSource(tableId: string, source: SnapshotSource): void {
    this.snapshotSources.set(tableId, source);
  }

  unregisterSnapshotSource(tableId: string): void {
    this.snapshotSources.delete(tableId);
  }

  loadStylePrompt(agentId: string, style: string, profile?: StyleProfile) {
    this.stylePrompts.set(agentId, style);
    this.styleProfiles.set(agentId, profile ?? parseStyleInput({ text: style }));
  }

  applySeasonStyle(agentId: string, style: string, profile?: StyleProfile): void {
    this.pendingStyleUpdates.delete(agentId);
    this.loadStylePrompt(agentId, style, profile);
    const conn = this.getConnection(agentId);
    if (conn) {
      conn.stylePrompt = style;
      conn.styleProfile = this.styleProfiles.get(agentId);
    }
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
    if (!pending || this.seasonEntered?.(agentId)) return;

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
  ): "applied" | "deferred" | "deferred_season" {
    if (this.isStyleLocked(agentId) || this.seasonEntered?.(agentId)) {
      this.pendingStyleUpdates.set(agentId, { stylePrompt, styleProfile });
      this.onStyleUpdate?.(agentId, stylePrompt, styleProfile, "pending");
      return this.seasonEntered?.(agentId) ? "deferred_season" : "deferred";
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
    if (this.wss) throw new Error("WebSocket server already attached");
    this.wss = new WebSocketServer({ server, path: "/agent", maxPayload: 64 * 1024 });

    this.wss.on("connection", (ws, req) => {
      const ip = req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim()
        ?? req.socket.remoteAddress ?? "unknown";
      console.log(`[ws-agent] new connection from ${ip}`);

      let authenticated = false;
      let connToken = "";
      const authTimer = setTimeout(() => {
        if (!authenticated) ws.close(4004, "Authentication timeout");
      }, this.authTimeoutMs);
      authTimer.unref();

      ws.on("message", (raw) => {
        let msg: any;
        try {
          msg = JSON.parse(raw.toString());
          if (!msg || typeof msg !== "object" || Array.isArray(msg)) throw new Error("Invalid message");
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
          clearTimeout(authTimer);

          // Identity is resolved exclusively from the server-held token.
          const agentId = authenticatedAgent.id;

          // Close existing connection for this token if any
          const existing = this.getConnection(agentId);
          if (existing && existing.ws.readyState === WebSocket.OPEN) {
            existing.ws.close(4001, "Replaced by new connection");
            this.connections.delete(existing.token);
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
            protocol_version: 1,
            agentId,
            name: conn.name,
          }));

          this.sendPendingMatchResults(agentId, ws);

          // On reconnection: resend pending decisions without extending their deadlines.
          for (const pending of this.pendingDecisions.values()) {
            if (pending.agentId !== agentId) continue;
            if (pending.deadlineAt <= Date.now()) continue;
            ws.send(JSON.stringify({
              ...pending.yourTurnPayload,
              type: "pending_decision",
              protocol_version: 1,
            }));
          }
          this.sendSnapshotsForAgent(agentId, ws);

          console.log(`[ws-agent] ${agentId} authenticated`);
          return;
        }

        if (!authenticated) {
          ws.send(JSON.stringify({ type: "error", message: "Not authenticated" }));
          return;
        }
        if (msg.type === "session_result_ack") {
          const agentId = this.connections.get(connToken)?.agentId;
          if (agentId && typeof msg.table_id === "string" && typeof msg.ended_at === "number") {
            this.sessionResults.acknowledge(agentId, msg.table_id, msg.ended_at);
          }
          return;
        }
        // A replaced socket may still deliver buffered messages before close.
        if (this.connections.get(connToken)?.ws !== ws) return;
        const conn = this.connections.get(connToken);
        if (!conn) return;

        // --- action (decision response) ---
        if (msg.type === "action") {
          const conn = this.connections.get(connToken);
          if (!conn) return;

          const parsed = parseActionMessage(msg);
          if (!parsed.ok) {
            ws.send(JSON.stringify(actionRejectedFor({
              clientActionId: typeof msg.client_action_id === "string" ? msg.client_action_id : undefined,
              context: {
                tableId: typeof msg.table_id === "string" ? msg.table_id : undefined,
                handId: typeof msg.hand_id === "string" ? msg.hand_id : undefined,
                turnId: typeof msg.turn_id === "string" ? msg.turn_id : undefined,
              },
              reason: parsed.reason,
              retryable: parsed.retryable,
            })));
            return;
          }

          const action = parsed.action;
          this.pruneAcceptedActions();
          const actionCacheKey = JSON.stringify([conn.agentId, action.client_action_id]);
          const accepted = this.acceptedActions.get(actionCacheKey);
          if (accepted) {
            if (sameAction(accepted.action, action)) {
              ws.send(JSON.stringify(accepted.ack));
              return;
            }
            ws.send(JSON.stringify(actionRejectedFor({
              context: {
                tableId: action.table_id,
                handId: action.hand_id,
                turnId: action.turn_id,
              },
              clientActionId: action.client_action_id,
              reason: "duplicate_action_id",
              retryable: false,
            })));
            return;
          }

          const context: DecisionContext = {
            tableId: action.table_id,
            handId: action.hand_id,
            turnId: action.turn_id,
          };
          const pending = this.pendingDecisions.get(decisionKey(conn.agentId, context));
          if (!pending) {
            ws.send(JSON.stringify(actionRejectedFor({
              context,
              clientActionId: action.client_action_id,
              reason: "unknown_turn",
              retryable: false,
            })));
            return;
          }

          if (action.turn_token !== pending.turnToken) {
            ws.send(JSON.stringify(actionRejectedFor({
              context,
              clientActionId: action.client_action_id,
              reason: "stale_turn_token",
              retryable: false,
            })));
            return;
          }

          if (Date.now() >= pending.deadlineAt) {
            clearTimeout(pending.timer);
            this.pendingDecisions.delete(decisionKey(conn.agentId, context));
            pending.reject(new Error("Decision timeout"));
            ws.send(JSON.stringify(actionRejectedFor({
              context, clientActionId: action.client_action_id,
              reason: "decision_expired", retryable: false,
            })));
            return;
          }

          if (!pending.validActions.includes(action.action)) {
            ws.send(JSON.stringify(actionRejectedFor({
              context,
              clientActionId: action.client_action_id,
              reason: "invalid_action",
              retryable: true,
            })));
            return;
          }

          if (action.action === "raise" && (action.amount! < pending.minRaiseTo
            || action.amount! > pending.maxRaiseTo)) {
            ws.send(JSON.stringify(actionRejectedFor({
              context, clientActionId: action.client_action_id,
              reason: "invalid_amount", retryable: true,
            })));
            return;
          }

          clearTimeout(pending.timer);
          this.pendingDecisions.delete(decisionKey(conn.agentId, context));

          const decision: AgentDecision = {
            action: {
              type: action.action,
              amount: action.action === "raise" ? action.amount : undefined,
            },
            thought: {
              message: action.thought ?? "...",
              confidence: action.confidence ?? 0.5,
              isBluffing: action.isBluffing ?? false,
              thinkingSource: "llm",
            },
            protocol: { ...context, clientActionId: action.client_action_id },
          };

          const ack = actionAckFor(action);
          this.acceptedActions.set(actionCacheKey, {
            agentId: conn.agentId,
            action,
            ack,
            expiresAt: Date.now() + 300_000,
          });
          const agentEntries = [...this.acceptedActions.entries()]
            .filter(([, entry]) => entry.agentId === conn.agentId);
          for (const [key] of agentEntries.slice(0, Math.max(0, agentEntries.length - 1024))) {
            this.acceptedActions.delete(key);
          }
          // Receipt delivery may fail after acceptance. Keep the decision and ACK
          // so the replacement connection can retry the identical action.
          pending.resolve(decision);
          ws.send(JSON.stringify(ack));
          return;
        }

        // --- resync (authoritative table snapshot) ---
        if (msg.type === "resync") {
          const parsed = parseResyncMessage(msg);
          if (!parsed.ok) {
            ws.send(JSON.stringify(resyncRejectedFor({
              tableId: typeof msg.table_id === "string" ? msg.table_id : undefined,
              reason: parsed.reason,
              retryable: parsed.retryable,
            })));
            return;
          }

          const source = this.snapshotSources.get(parsed.request.table_id);
          if (!source) {
            ws.send(JSON.stringify(resyncRejectedFor({
              tableId: parsed.request.table_id,
              reason: "unknown_table",
              retryable: false,
            })));
            return;
          }

          const snapshot = source(conn.agentId);
          if (!snapshot) {
            ws.send(JSON.stringify(resyncRejectedFor({
              tableId: parsed.request.table_id,
              reason: "unknown_table",
              retryable: false,
            })));
            return;
          }

          ws.send(JSON.stringify(this.snapshotForAgent(
            conn.agentId,
            snapshot,
            parsed.request.last_seen_seq,
          )));
          return;
        }

        // --- update_style (supports text, highLevel, profile, or mixed) ---
        if (msg.type === "update_style") {
          const conn = this.connections.get(connToken);
          if (!conn) return;

          const styleInput = parseStyleUpdate(msg);
          if (!styleInput) {
            ws.send(JSON.stringify({ type: "error", message: "Invalid style update" }));
            return;
          }

          // Text, full profile, or highLevel + optional override.
          const styleProfile = parseStyleInput(styleInput);
          const styleText = styleInput.text
            ?? (styleInput.highLevel ? JSON.stringify(styleInput.highLevel)
              : styleInput.profile ? JSON.stringify(styleInput.profile) : "");

          const updateStatus = this.updateStyle(conn.agentId, styleText, styleProfile);
          const responsePayload = updateStatus === "applied"
            ? { type: "style_updated" as const, profile: { ...styleProfile } }
            : {
                type: "style_update_deferred" as const,
                appliesTo: updateStatus === "deferred_season" ? "next_season" as const : "next_match" as const,
                profile: { ...styleProfile },
              };
          const jsonStr = JSON.stringify(responsePayload);
          console.log(`[ws-agent] sending ${responsePayload.type} response:`, jsonStr);
          ws.send(jsonStr);
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
        clearTimeout(authTimer);
        this.requeueMatchResultsForConnection(ws);
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
    const heartbeat = setInterval(() => {
      const now = Date.now();
      this.pruneAcceptedActions();
      for (const [token, conn] of this.connections) {
        if (now - conn.lastHeartbeat > 60_000) {
          console.log(`[ws-agent] agent ${conn.agentId} timed out (no heartbeat)`);
          conn.ws.close(4002, "Heartbeat timeout");
          this.connections.delete(token);
          this.agentIdToToken.delete(conn.agentId);
        }
      }
    }, 30_000);
    heartbeat.unref();
    server.once("close", () => {
      clearInterval(heartbeat);
      for (const pending of this.pendingDecisions.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Agent server closed"));
      }
      this.pendingDecisions.clear();
      this.acceptedActions.clear();
      this.connections.clear();
      this.agentIdToToken.clear();
      this.snapshotSources.clear();
      this.inFlightMatchResults.clear();
      this.wss?.close();
      this.wss = null;
    });

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

  sendSessionResult(agentId: string, message: SessionResultMessage): void {
    this.sessionResults.enqueue(agentId, message);
    const connection = this.getConnection(agentId);
    if (connection && connection.ws.readyState === WebSocket.OPEN) {
      this.sendPendingMatchResults(agentId, connection.ws);
    }
  }

  sendMatchResult(
    agentIds: string[],
    result: Omit<ExternalAgentMatchResult, "type" | "protocol_version">,
  ): void {
    for (const agentId of new Set(agentIds)) {
      this.pendingMatchResults.enqueue([agentId], matchResultMessageFor(result, agentId));
    }
    for (const agentId of new Set(agentIds)) {
      const connection = this.getConnection(agentId);
      if (!connection || connection.ws.readyState !== WebSocket.OPEN) continue;
      this.sendPendingMatchResults(agentId, connection.ws);
    }
  }

  private sendPendingMatchResults(agentId: string, ws: WebSocket): void {
    if (ws.readyState !== WebSocket.OPEN) return;

    for (const message of this.sessionResults.list(agentId)) {
      try {
        ws.send(JSON.stringify(message));
      } catch {
        break;
      }
    }

    const pendingResults = this.pendingMatchResults.drain(agentId);
    for (const message of pendingResults) {
      const inFlight = this.inFlightMatchResults.get(ws) ?? {
        agentId,
        results: new Map<string, ExternalAgentMatchResult>(),
      };
      inFlight.results.set(message.table_id, message);
      this.inFlightMatchResults.set(ws, inFlight);
      try {
        ws.send(JSON.stringify(message), (error) => {
          if (!error) {
            const timer = setTimeout(() => {
              const current = this.inFlightMatchResults.get(ws);
              if (current?.results.get(message.table_id) !== message) return;
              current.results.delete(message.table_id);
              if (current.results.size === 0) this.inFlightMatchResults.delete(ws);
            }, MATCH_RESULT_CLOSE_GRACE_MS);
            timer.unref();
            return;
          }
          const current = this.inFlightMatchResults.get(ws);
          current?.results.delete(message.table_id);
          if (current?.results.size === 0) this.inFlightMatchResults.delete(ws);
          this.pendingMatchResults.enqueue([agentId], message);
          console.error(`[ws-agent] failed to send match result to ${agentId}:`, error);
        });
      } catch (error) {
        const current = this.inFlightMatchResults.get(ws);
        current?.results.delete(message.table_id);
        if (current?.results.size === 0) this.inFlightMatchResults.delete(ws);
        this.pendingMatchResults.enqueue([agentId], message);
        console.error(`[ws-agent] failed to send match result to ${agentId}:`, error);
      }
    }
  }

  private requeueMatchResultsForConnection(ws: WebSocket): void {
    const inFlight = this.inFlightMatchResults.get(ws);
    if (!inFlight) return;
    this.inFlightMatchResults.delete(ws);

    for (const message of inFlight.results.values()) {
      this.pendingMatchResults.enqueue([inFlight.agentId], message);
    }
  }

  private findPendingDecision(agentId: string, tableId: string): PendingDecision | undefined {
    for (const pending of this.pendingDecisions.values()) {
      if (pending.agentId === agentId && pending.context.tableId === tableId) return pending;
    }
    return undefined;
  }

  private snapshotForAgent(
    agentId: string,
    source: AgentSnapshotState,
    requestedSeq?: number,
  ) {
    const pending = this.findPendingDecision(agentId, source.tableId);
    return snapshotMessageFor(
      source,
      agentId,
      requestedSeq,
      pending && pending.deadlineAt > Date.now()
        ? {
            context: pending.context,
            turnToken: pending.turnToken,
            deadlineAt: pending.deadlineAt,
          }
        : undefined,
    );
  }

  private sendSnapshotsForAgent(agentId: string, ws: WebSocket): void {
    for (const source of this.snapshotSources.values()) {
      const snapshot = source(agentId);
      if (!snapshot) continue;
      ws.send(JSON.stringify(this.snapshotForAgent(agentId, snapshot)));
    }
  }

  private pruneAcceptedActions() {
    const now = Date.now();
    for (const [key, accepted] of this.acceptedActions) {
      if (accepted.expiresAt <= now) this.acceptedActions.delete(key);
    }
  }

  cancelTableDecisions(tableId: string) {
    for (const [key, pending] of this.pendingDecisions) {
      if (pending.context.tableId !== tableId) continue;
      clearTimeout(pending.timer);
      this.pendingDecisions.delete(key);
      pending.reject(new Error("Table stopped"));
    }
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
    const resolvedTableId = view.tableId || tableId;
    if (!resolvedTableId || (view.tableId && tableId && view.tableId !== tableId)) {
      return Promise.reject(new Error("Invalid table context"));
    }
    for (const pending of this.pendingDecisions.values()) {
      if (pending.agentId === agentId && pending.context.tableId === resolvedTableId) {
        return Promise.reject(new Error("Decision already pending for this Agent and table"));
      }
    }

    return new Promise((resolve, reject) => {
      const context: DecisionContext = {
        tableId: resolvedTableId,
        handId: view.handId || `${resolvedTableId}:hand-${view.handNumber}`,
        turnId: view.turnId || randomUUID(),
      };
      const key = decisionKey(agentId, context);
      const turnToken = randomUUID();
      const deadlineAt = Date.now() + timeoutMs;
      const maxRaiseTo = view.myBet + view.myChips;
      const minRaiseTo = Math.min(view.currentBet + minRaise, maxRaiseTo);
      const timer = setTimeout(() => {
        this.pendingDecisions.delete(key);
        reject(new Error("Decision timeout"));
      }, timeoutMs);

      this.pendingDecisions.set(key, {
        agentId,
        context,
        turnToken,
        validActions: [...validActions],
        minRaiseTo,
        maxRaiseTo,
        resolve,
        reject,
        timer,
        deadlineAt,
        yourTurnPayload: {},
      });

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
        protocol_version: 1,
        table_id: context.tableId,
        hand_id: context.handId,
        turn_id: context.turnId,
        turn_token: turnToken,
        deadline_at: deadlineAt,
        roomId: context.tableId,
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
        minRaiseTo,
        maxRaiseTo,
        players,
        actionHistory,
        stylePrompt,
        strategy,
      };

      // Store payload for reconnection resync
      const pending = this.pendingDecisions.get(key);
      if (pending) pending.yourTurnPayload = yourTurnMsg;

      try {
        conn.ws.send(JSON.stringify(yourTurnMsg));
      } catch (error) {
        clearTimeout(timer);
        this.pendingDecisions.delete(key);
        reject(error);
      }
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
