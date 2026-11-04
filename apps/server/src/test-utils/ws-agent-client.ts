import { createServer } from "node:http";
import type { Socket } from "node:net";
import { WebSocket, type RawData } from "ws";
import { WebSocketAgentManager } from "../agents/websocket-agent-manager";

export type WireMessage = Record<string, any>;

// Buffer immediately: authenticated + pending_decision can arrive in one frame.
export class AgentClient {
  private messages: WireMessage[] = [];
  private waiters: Array<{
    type: string;
    resolve: (message: WireMessage) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(readonly ws: WebSocket) {
    ws.on("message", (raw: RawData) => {
      const message = JSON.parse(raw.toString());
      const index = this.waiters.findIndex((waiter) => waiter.type === message.type);
      if (index < 0) {
        this.messages.push(message);
      } else {
        const [waiter] = this.waiters.splice(index, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      }
    });
    ws.on("error", (error) => this.rejectWaiters(error));
    ws.on("close", () => this.rejectWaiters(new Error("Client closed")));
  }

  private rejectWaiters(error: Error) {
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  send(message: unknown) {
    this.ws.send(JSON.stringify(message));
  }

  next(type: string, timeoutMs = 2000): Promise<WireMessage> {
    const index = this.messages.findIndex((message) => message.type === type);
    if (index >= 0) return Promise.resolve(this.messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = {
        type, resolve, reject,
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter((entry) => entry !== waiter);
          reject(new Error(`Timed out waiting for ${type}`));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  async disconnect() {
    if (this.ws.readyState === WebSocket.CLOSED) return;
    const closed = new Promise<void>((resolve) => this.ws.once("close", () => resolve()));
    this.ws.terminate();
    await closed;
  }
}

export async function createAgentHarness(manager = new WebSocketAgentManager()) {
  const server = createServer();
  const clients: AgentClient[] = [];
  const sockets = new Set<Socket>();
  // Reference clients connect via URL and are not in the harness client list.
  server.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  manager.setAuthenticationResolver((token) =>
    /^test-agent-\d+$/.test(token) ? { id: token, name: token } : undefined);
  manager.attach(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing server address");
  const url = `ws://127.0.0.1:${address.port}/agent`;

  return {
    manager,
    url,
    async connect(token = "test-agent-1") {
      const ws = new WebSocket(url);
      const client = new AgentClient(ws);
      clients.push(client);
      await new Promise<void>((resolve, reject) => {
        ws.once("error", reject);
        ws.once("open", () => {
          ws.off("error", reject);
          resolve();
        });
      });
      client.send({ type: "authenticate", token });
      return client;
    },
    async close() {
      for (const client of clients) await client.disconnect();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export function actionFor(turn: WireMessage, overrides: WireMessage = {}): WireMessage {
  return {
    type: "action",
    table_id: turn.table_id,
    hand_id: turn.hand_id,
    turn_id: turn.turn_id,
    turn_token: turn.turn_token,
    client_action_id: `${turn.turn_id}:action`,
    action: "call",
    ...overrides,
  };
}
