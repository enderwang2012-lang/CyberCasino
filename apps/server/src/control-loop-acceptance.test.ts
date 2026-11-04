import { expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { io, type Socket } from "socket.io-client";
import type { AgentArenaSummary, ExternalAgentMatchResult } from "@cybercasino/shared";
import { signJwt } from "./auth";
import { AgentClient, actionFor, type WireMessage } from "./test-utils/ws-agent-client";
import { ReferenceAgentClient, type ReferenceTurn } from "./test-utils/reference-agent-client";
import { WebSocket } from "ws";

class Inbox {
  private messages: WireMessage[] = [];
  private waiters: Array<{
    accepts: (message: WireMessage) => boolean;
    resolve: (message: WireMessage) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  push(message: WireMessage) {
    const index = this.waiters.findIndex((waiter) => waiter.accepts(message));
    if (index < 0) this.messages.push(message);
    else {
      const [waiter] = this.waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  }

  next(type: string, accepts: (message: WireMessage) => boolean = () => true): Promise<WireMessage> {
    const matches = (message: WireMessage) => message.type === type && accepts(message);
    const index = this.messages.findIndex(matches);
    if (index >= 0) return Promise.resolve(this.messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = {
        accepts: matches, resolve,
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter((item) => item !== waiter);
          reject(new Error(`Timed out waiting for ${type}`));
        }, 10_000),
      };
      this.waiters.push(waiter);
    });
  }

  close() {
    for (const waiter of this.waiters.splice(0)) clearTimeout(waiter.timer);
  }

  discard(type: string) {
    this.messages = this.messages.filter((message) => message.type !== type);
  }
}

it("completes the authenticated HTTP, Socket.IO and external-Agent result loop", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "cybercasino-control-loop-"));
  const serverMessages = new Inbox();
  const socketMessages = new Inbox();
  const secret = "isolated-control-loop-test";
  const userId = "github:control-loop";
  const jwt = signJwt({ userId, name: "Control Loop", avatar: "", provider: "github" }, secret);
  const child = Bun.spawn([process.execPath, "--no-env-file", "src/test-utils/control-loop-server.ts"], {
    cwd: join(import.meta.dirname, ".."),
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      PORT: "0",
      JWT_SECRET: secret,
      DATABASE_URL: "",
      LLM_API_KEY: "",
      OPENAI_API_KEY: "",
      CYBERCASINO_DATA_DIR: dataDir,
    },
    stdout: "pipe",
    stderr: "pipe",
    ipc: (message) => serverMessages.push(message),
  });
  const stdout = new Response(child.stdout).text();
  const stderr = new Response(child.stderr).text();
  let socket: Socket | undefined;
  let control: AgentClient | undefined;
  let reconnected: ReferenceAgentClient | undefined;
  let failure: unknown;
  try {
    const { port } = await serverMessages.next("ready");
    const base = `http://127.0.0.1:${port}`;
    const wsUrl = `ws://127.0.0.1:${port}/agent`;
    const headers = { Cookie: `cybercasino-token=${jwt}`, "Content-Type": "application/json" };
    const summary = async (): Promise<AgentArenaSummary> => {
      const response = await fetch(`${base}/api/agents/summary?userId=${encodeURIComponent(userId)}`, { headers });
      expect(response.status).toBe(200);
      return response.json();
    };

    expect((await fetch(`${base}/api/agents/summary?userId=${userId}`)).status).toBe(401);
    expect((await fetch(`${base}/api/agents/summary?userId=github:another`, { headers })).status).toBe(401);
    expect(await summary()).toMatchObject({
      agent: null, currentMatch: { status: "idle" }, recentMatches: [],
    });

    const created = await fetch(`${base}/api/external-agent/create`, {
      method: "POST", headers, body: JSON.stringify({ name: "Loop Agent", avatar: "A" }),
    });
    expect(created.status).toBe(200);
    const { agentId, token } = await created.json() as { agentId: string; token: string };
    expect((await fetch(`${base}/api/agents/soul/${token}`)).status).toBe(200);

    socket = io(base, { transports: ["websocket"], auth: { token: jwt }, reconnection: false });
    socket.onAny((type: string, payload: unknown) => socketMessages.push({ type, payload }));
    await new Promise<void>((resolve, reject) => {
      socket!.once("connect", resolve);
      socket!.once("connect_error", reject);
    });
    socket.emit("user:register", userId);
    await socketMessages.next("user:registered");
    socket.emit("lobby:join");

    const ws = new WebSocket(wsUrl);
    control = new AgentClient(ws);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    control.send({ type: "authenticate", token });
    expect(await control.next("authenticated")).toMatchObject({ agentId, protocol_version: 1 });

    // Hold the first actual remote decision to inspect the frozen running version.
    const heldTables = new Set<string>();
    const heldTurns = new Map<string, ReferenceTurn>();
    ws.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type !== "your_turn") return;
      if (!heldTables.has(message.table_id)) {
        heldTables.add(message.table_id);
        heldTurns.set(message.table_id, message);
        serverMessages.push({ type: "first_turn", turn: message });
      } else {
        const action = message.validActions.includes("check") ? "check"
          : message.validActions.includes("call") ? "call" : "fold";
        control!.send(actionFor(message, { action }));
      }
    });
    socket.emit("matchmaking:join", agentId);
    const matched = await socketMessages.next("matchmaking:matched");
    const firstTableId = matched.payload.tableId as string;
    await serverMessages.next("first_turn", (event) => event.turn.table_id === firstTableId);
    expect(await summary()).toMatchObject({
      agent: { id: agentId, strategyVersion: 1 },
      externalAgentConnected: true,
      currentMatch: { status: "playing", tableId: firstTableId, autoRequeue: true },
      currentMatchStrategyVersion: 1,
    });
    control.send({ type: "update_style", style: "Play tight with selective aggression" });
    expect(await control.next("style_update_deferred")).toMatchObject({ appliesTo: "next_match" });
    expect(await summary()).toMatchObject({
      agent: { strategyVersion: 1, pendingStrategyVersion: 2 },
      currentMatchStrategyVersion: 1,
    });
    socket.emit("matchmaking:leave");
    await socketMessages.next("matchmaking:state", (event) =>
      event.payload.status === "playing" && event.payload.autoRequeue === false);
    control.send(actionFor(heldTurns.get(firstTableId)!, { action: "fold" }));
    await serverMessages.next("archive_pending", (event) => event.tableId === firstTableId);
    expect((await summary()).recentMatches).toHaveLength(0);
    expect((await fetch(`${base}/api/replay/${firstTableId}`)).status).toBe(404);
    child.send({ type: "release_archive", tableId: firstTableId });

    const firstResult = await control.next("match_result", 10_000) as ExternalAgentMatchResult;
    expect(firstResult).toMatchObject({
      table_id: firstTableId, total_hands: 1, type: "match_result", protocol_version: 1,
    });
    expect(firstResult.players).toHaveLength(6);
    expect(firstResult.players.filter((player) => player.type === "builtin")).toHaveLength(5);
    expect(firstResult.players.every((player) => player.strategyVersion === 1)).toBe(true);
    expect(firstResult.rankings).toHaveLength(6);
    expect(firstResult.replay.hands).toHaveLength(1);
    expect(firstResult.replay.timeline!.length).toBeGreaterThan(0);
    expect(JSON.stringify(firstResult)).not.toContain('"audit":');
    expect(JSON.stringify(firstResult)).not.toContain("turn_token");
    expect(await (await fetch(`${base}/api/replay/${firstTableId}`)).json()).toEqual(firstResult.replay);
    const afterFirst = await summary();
    expect(afterFirst).toMatchObject({
      currentMatch: { status: "idle" },
      agent: { strategyVersion: 2 },
      standing: { agentId, gamesPlayed: 1 },
    });
    expect(afterFirst.recentMatches).toMatchObject([{
      tableId: firstTableId, handsPlayed: 1, totalPlayers: 6,
      strategyVersion: 1, replayAvailable: true,
    }]);

    // The next match uses the activated version; disconnect before its archive completes.
    socket.emit("matchmaking:join", agentId);
    const secondMatch = await socketMessages.next("matchmaking:matched");
    const secondTableId = secondMatch.payload.tableId as string;
    expect(secondTableId).not.toBe(firstTableId);
    await serverMessages.next("first_turn", (event) => event.turn.table_id === secondTableId);
    expect(await summary()).toMatchObject({
      currentMatch: { status: "playing", tableId: secondTableId },
      currentMatchStrategyVersion: 2,
    });
    socket.emit("matchmaking:leave");
    await socketMessages.next("matchmaking:state", (event) =>
      event.payload.tableId === secondTableId && event.payload.autoRequeue === false);
    control.send(actionFor(heldTurns.get(secondTableId)!, { action: "fold" }));
    await serverMessages.next("archive_pending", (event) => event.tableId === secondTableId);
    await control.disconnect();
    socketMessages.discard("matchmaking:state");
    child.send({ type: "release_archive", tableId: secondTableId });
    await socketMessages.next("matchmaking:state", (event) => event.payload.status === "idle");
    const afterSecond = await summary();
    expect(afterSecond.currentMatch.status).toBe("idle");
    expect(afterSecond.recentMatches.map((match) => match.tableId)).toEqual([secondTableId, firstTableId]);
    expect(afterSecond.recentMatches.map((match) => match.strategyVersion)).toEqual([2, 1]);
    expect(afterSecond.standing?.gamesPlayed).toBe(2);

    reconnected = await ReferenceAgentClient.connect(wsUrl, token);
    let secondResult = await reconnected.next<ExternalAgentMatchResult>("match_result", 10_000);
    // A connection closing soon after send can conservatively redeliver an
    // earlier result. The Agent deduplicates by table_id.
    if (secondResult.table_id === firstTableId) {
      secondResult = await reconnected.next<ExternalAgentMatchResult>("match_result", 10_000);
    }
    expect(secondResult.table_id).toBe(secondTableId);
    expect(secondResult.players.find((player) => player.id === agentId)?.strategyVersion).toBe(2);
    expect(await (await fetch(`${base}/api/replay/${secondTableId}`)).json()).toEqual(secondResult.replay);
    expect(reconnected.results.get(secondTableId)).toEqual(secondResult);
    const { standings } = await (await fetch(`${base}/api/leaderboard`)).json() as {
      standings: Array<{ agentId: string; gamesPlayed: number }>;
    };
    expect(standings).toHaveLength(6);
    expect(standings.every((standing) => standing.gamesPlayed === 2)).toBe(true);
    const persisted = JSON.parse(await readFile(join(dataDir, "game_history.json"), "utf8"));
    expect(persisted.map((entry: { info: { id: string } }) => entry.info.id).sort())
      .toEqual([firstTableId, secondTableId].sort());

    socketMessages.discard("lobby:tables");
    socket.emit("lobby:join");
    const lobby = await socketMessages.next("lobby:tables");
    expect(lobby.payload.filter((table: { status: string }) => table.status === "playing")).toHaveLength(0);
  } catch (error) {
    failure = error;
  } finally {
    await reconnected?.close();
    await control?.disconnect();
    socket?.disconnect();
    child.kill();
    await child.exited;
    const logs = `${await stdout}\n${await stderr}`;
    serverMessages.close();
    socketMessages.close();
    await rm(dataDir, { recursive: true, force: true });
    if (failure) {
      console.error(logs);
      throw failure;
    }
  }
}, 45_000);
