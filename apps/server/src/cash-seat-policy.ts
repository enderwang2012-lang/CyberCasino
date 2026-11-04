export const CASH_MIN_PLAYERS = 2;
export const CASH_MAX_PLAYERS = 6;

export interface CashSeat {
  agentId: string;
  kind: "user" | "preset";
  userId?: string;
}

export interface CashTableSnapshot {
  id: string;
  seats: CashSeat[];
}

export interface WaitingAgent {
  userId: string;
  agentId: string;
  enteredAt: number;
  kind: "user" | "preset";
}

export interface SeatMove {
  tableId: string;
  sit: WaitingAgent[];
  standAgentIds: string[];
  open: boolean;
}

export function planCashSeats(input: {
  tables: CashTableSnapshot[];
  waitingUsers: WaitingAgent[];
  idlePresets: WaitingAgent[];
}): SeatMove[] {
  const seatedIds = new Set(input.tables.flatMap((table) => table.seats.map((seat) => seat.agentId)));
  const presets: WaitingAgent[] = [];
  for (const preset of input.idlePresets) {
    if (preset.kind !== "preset" || seatedIds.has(preset.agentId)) continue;
    if (presets.some((item) => item.agentId === preset.agentId)) continue;
    presets.push(preset);
  }
  const users = input.waitingUsers
    .filter((agent) => agent.kind === "user" && !seatedIds.has(agent.agentId))
    .sort((a, b) => a.enteredAt - b.enteredAt || a.agentId.localeCompare(b.agentId));

  const tables = input.tables.map((table) => ({
    id: table.id,
    seats: table.seats.map((seat) => ({ ...seat })),
    sit: [] as WaitingAgent[],
    standAgentIds: [] as string[],
  }));
  const moves: SeatMove[] = [];
  const flush = (table: typeof tables[number]) => {
    if (table.sit.length === 0 && table.standAgentIds.length === 0) return;
    moves.push({
      tableId: table.id,
      sit: table.sit.splice(0),
      standAgentIds: table.standAgentIds.splice(0),
      open: false,
    });
  };

  for (const waiting of users) {
    const openSeat = [...tables]
      .sort((a, b) => b.seats.length - a.seats.length)
      .find((table) => table.seats.length < CASH_MAX_PLAYERS);
    if (openSeat) {
      openSeat.seats.push({ agentId: waiting.agentId, kind: "user", userId: waiting.userId });
      openSeat.sit.push(waiting);
      flush(openSeat);
      continue;
    }

    const host = [...tables]
      .sort((a, b) => {
        const count = (table: typeof tables[number]) => table.seats.filter((seat) => seat.kind === "user").length;
        return count(b) - count(a);
      })
      .find((table) => table.seats.some((seat) => seat.kind === "preset"));
    if (!host) continue;
    const index = host.seats.findIndex((seat) => seat.kind === "preset");
    const [standing] = host.seats.splice(index, 1);
    host.standAgentIds.push(standing.agentId);
    presets.unshift({
      userId: `builtin:${standing.agentId}`,
      agentId: standing.agentId,
      enteredAt: 0,
      kind: "preset",
    });
    host.seats.push({ agentId: waiting.agentId, kind: "user", userId: waiting.userId });
    host.sit.push(waiting);
    flush(host);
  }

  const seatedAfter = new Set(tables.flatMap((table) => table.seats.map((seat) => seat.agentId)));
  const unmet = users.filter((agent) => !seatedAfter.has(agent.agentId));
  if (unmet.length > 0 && unmet.length + presets.length >= CASH_MIN_PLAYERS) {
    const sit = [...unmet];
    while (sit.length < CASH_MAX_PLAYERS && presets.length > 0) sit.push(presets.shift()!);
    moves.push({ tableId: "", sit, standAgentIds: [], open: true });
  }

  for (const table of [...tables].sort((a, b) => b.seats.length - a.seats.length)) {
    while (table.seats.length < CASH_MAX_PLAYERS && presets.length > 0) {
      const next = presets.shift()!;
      table.seats.push({ agentId: next.agentId, kind: "preset" });
      table.sit.push(next);
    }
    flush(table);
  }

  const anyUser = tables.some((table) => table.seats.some((seat) => seat.kind === "user")) || unmet.length > 0;
  if (!anyUser && tables.length === 0 && presets.length >= CASH_MIN_PLAYERS) {
    moves.push({
      tableId: "",
      sit: presets.splice(0, CASH_MAX_PLAYERS),
      standAgentIds: [],
      open: false,
    });
    moves[moves.length - 1].open = true;
  }

  return moves;
}
