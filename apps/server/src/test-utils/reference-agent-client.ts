import { randomUUID } from "node:crypto";
import { WebSocket, type RawData } from "ws";
import type {
  ActionType,
  ExternalAgentMatchResult,
  ProtocolActionMessage,
} from "@cybercasino/shared";
import { AgentClient, actionFor, type WireMessage } from "./ws-agent-client";

export interface ReferenceTurn extends Pick<ProtocolActionMessage,
  "table_id" | "hand_id" | "turn_id" | "turn_token"> {
  type: "your_turn" | "pending_decision";
  protocol_version: 1;
  deadline_at: number;
  validActions: ActionType[];
  minRaiseTo: number;
  maxRaiseTo: number;
}

export type ReferenceDecision = Pick<ProtocolActionMessage,
  "action" | "amount" | "thought" | "confidence" | "isBluffing">;

export interface ReferenceAgentClientOptions {
  heartbeatIntervalMs?: number;
}

/**
 * Local reference harness: callers drive reconnects and decisions explicitly.
 * Messages use the existing Protocol v1 buffer; results are not durable storage.
 */
export class ReferenceAgentClient {
  authenticated?: { type: "authenticated"; protocol_version: 1; agentId: string; name: string };
  readonly results = new Map<string, ExternalAgentMatchResult>();
  private transport?: AgentClient;
  private heartbeat?: ReturnType<typeof setInterval>;
  private readonly pending = new Map<string, ProtocolActionMessage>();

  private constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly heartbeatIntervalMs: number,
  ) {}

  static async connect(url: string, token: string, options: ReferenceAgentClientOptions = {}) {
    const interval = options.heartbeatIntervalMs ?? 30_000;
    if (!Number.isFinite(interval) || interval <= 0) throw new Error("Invalid heartbeat interval");
    const client = new ReferenceAgentClient(url, token, interval);
    await client.reconnect();
    return client;
  }

  next<T extends WireMessage = WireMessage>(type: string, timeoutMs = 2_000): Promise<T> {
    if (!this.transport) return Promise.reject(new Error("Reference Agent is not connected"));
    return this.transport.next(type, timeoutMs) as Promise<T>;
  }

  respondToTurn(turn: ReferenceTurn, choice?: ReferenceDecision): ProtocolActionMessage {
    if (!this.transport || !this.authenticated) throw new Error("Reference Agent is not connected");
    if (turn.protocol_version !== 1 || turn.deadline_at <= Date.now()) {
      throw new Error("Unsupported or expired turn");
    }
    let action = [...this.pending.values()].find((candidate) =>
      candidate.table_id === turn.table_id && candidate.hand_id === turn.hand_id
      && candidate.turn_id === turn.turn_id && candidate.turn_token === turn.turn_token);
    if (!action) {
      const fallbackAction = (["check", "call", "fold"] as const)
        .find((type) => turn.validActions.includes(type));
      if (!choice && !fallbackAction) {
        throw new Error("No legal reference action");
      }
      const decision: ReferenceDecision = choice ?? { action: fallbackAction! };
      if (!decision.action || !turn.validActions.includes(decision.action)) {
        throw new Error("No legal reference action");
      }
      if (decision.action === "raise"
        && (!Number.isSafeInteger(decision.amount) || decision.amount! < turn.minRaiseTo
          || decision.amount! > turn.maxRaiseTo)) {
        throw new Error("Raise must be an integer within raise-to bounds");
      }
      if (decision.action !== "raise" && decision.amount !== undefined) {
        throw new Error("Only raises carry an amount");
      }
      action = actionFor(turn, {
        ...decision,
        client_action_id: randomUUID(),
      }) as ProtocolActionMessage;
      this.pending.set(action.client_action_id, action);
    }
    this.transport.send(action);
    // Callers cannot mutate the private retry payload.
    return { ...action };
  }

  async reconnect(): Promise<void> {
    await this.close();
    const ws = new WebSocket(this.url);
    const transport = new AgentClient(ws); // Buffer before open/authentication.
    this.transport = transport;
    ws.on("message", (raw: RawData) => {
      const message = JSON.parse(raw.toString()) as WireMessage;
      if (message.type === "action_ack" || message.type === "action_rejected") {
        this.pending.delete(message.client_action_id);
      } else if (message.type === "match_result" && message.protocol_version === 1) {
        const result = message as ExternalAgentMatchResult;
        this.results.set(result.table_id, result);
        for (const [id, action] of this.pending) {
          if (action.table_id === result.table_id) this.pending.delete(id);
        }
      }
    });
    ws.once("close", () => {
      this.stopHeartbeat();
      this.authenticated = undefined;
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        ws.once("error", onError);
        ws.once("open", () => {
          ws.off("error", onError);
          resolve();
        });
      });
      transport.send({ type: "authenticate", token: this.token });
      const auth = await transport.next("authenticated");
      if (auth.protocol_version !== 1) throw new Error("Unsupported protocol");
      this.authenticated = auth as NonNullable<ReferenceAgentClient["authenticated"]>;
      this.heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) transport.send({ type: "ping" });
      }, this.heartbeatIntervalMs);
      this.heartbeat.unref();
      for (const action of this.pending.values()) transport.send(action);
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async close(): Promise<void> {
    this.stopHeartbeat();
    this.authenticated = undefined;
    await this.transport?.disconnect();
    this.transport = undefined;
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }
}
