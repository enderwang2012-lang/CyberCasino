import type {
  Action,
  AgentPlayerView,
  DecisionContext,
  ExternalAgentTableSnapshot,
  GamePhase,
  Pot,
  ProtocolActionAck,
  ProtocolActionMessage,
  ProtocolActionRejected,
  ProtocolActionRejectedReason,
  ProtocolResyncMessage,
  ProtocolResyncRejectedReason,
  ActionType,
} from "@cybercasino/shared";

export type ParsedActionMessage = ProtocolActionMessage;
export type ParsedResyncMessage = ProtocolResyncMessage;

export interface AgentSnapshotAction {
  playerId: string;
  phase: GamePhase;
  action: Action;
}

export interface AgentSnapshotState {
  tableId: string;
  tableSeq: number;
  stateHash: string;
  status: "waiting" | "playing" | "finished";
  handId: string | null;
  handNumber: number;
  phase: GamePhase | null;
  myCards: { rank: number; suit: "h" | "d" | "c" | "s" }[];
  communityCards: { rank: number; suit: "h" | "d" | "c" | "s" }[];
  players: AgentPlayerView[];
  pots: Pot[];
  dealerSeatIndex: number | null;
  currentPlayerId: string | null;
  currentBet: number;
  callAmount: number;
  minRaiseTo: number | null;
  maxRaiseTo: number | null;
  validActions: ActionType[];
  actionHistory: AgentSnapshotAction[];
}

export interface SnapshotSource {
  (agentId: string): AgentSnapshotState | undefined;
}

export interface ActionRejection {
  ok: false;
  reason: ProtocolActionRejectedReason;
  retryable: boolean;
}

export type ParsedActionResult =
  | { ok: true; action: ParsedActionMessage }
  | ActionRejection;

export type ResyncRejection = {
  ok: false;
  reason: ProtocolResyncRejectedReason;
  retryable: boolean;
};

export type ParsedResyncResult =
  | { ok: true; request: ParsedResyncMessage }
  | ResyncRejection;

export interface ActionRejectionInput {
  context?: Partial<DecisionContext>;
  clientActionId?: string;
  reason: ProtocolActionRejectedReason;
  retryable: boolean;
}

const ACTIONS: readonly ActionType[] = ["fold", "check", "call", "raise"];

export function decisionKey(agentId: string, context: DecisionContext): string {
  return JSON.stringify([agentId, context.tableId, context.handId, context.turnId]);
}

export function parseActionMessage(message: unknown): ParsedActionResult {
  if (!message || typeof message !== "object") {
    return { ok: false, reason: "missing_context", retryable: false };
  }

  const candidate = message as Record<string, unknown>;
  const contextFields = ["table_id", "hand_id", "turn_id", "turn_token"];
  if (candidate.type !== "action" || contextFields.some((field) =>
    typeof candidate[field] !== "string" || !candidate[field].trim() || candidate[field].length > 256)) {
    return { ok: false, reason: "missing_context", retryable: false };
  }
  if (typeof candidate.client_action_id !== "string" || !candidate.client_action_id.trim()
    || candidate.client_action_id.length > 256) {
    return { ok: false, reason: "missing_client_action_id", retryable: false };
  }
  if (!ACTIONS.includes(candidate.action as ActionType)) {
    return { ok: false, reason: "invalid_action", retryable: true };
  }
  if (candidate.action === "raise"
    && (typeof candidate.amount !== "number" || !Number.isSafeInteger(candidate.amount) || candidate.amount <= 0)) {
    return { ok: false, reason: "invalid_amount", retryable: true };
  }
  if (candidate.action !== "raise" && candidate.amount !== undefined) {
    return { ok: false, reason: "invalid_amount", retryable: true };
  }
  if ((candidate.thought !== undefined
      && (typeof candidate.thought !== "string" || candidate.thought.length > 4096))
    || (candidate.confidence !== undefined && (typeof candidate.confidence !== "number"
      || !Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1))
    || (candidate.isBluffing !== undefined && typeof candidate.isBluffing !== "boolean")) {
    return { ok: false, reason: "invalid_metadata", retryable: true };
  }

  return {
    ok: true,
    action: {
      type: "action",
      table_id: candidate.table_id as string,
      hand_id: candidate.hand_id as string,
      turn_id: candidate.turn_id as string,
      turn_token: candidate.turn_token as string,
      client_action_id: candidate.client_action_id as string,
      action: candidate.action as ActionType,
      amount: typeof candidate.amount === "number" ? candidate.amount : undefined,
      thought: typeof candidate.thought === "string" ? candidate.thought : undefined,
      confidence: typeof candidate.confidence === "number" ? candidate.confidence : undefined,
      isBluffing: typeof candidate.isBluffing === "boolean" ? candidate.isBluffing : undefined,
    },
  };
}

export function parseResyncMessage(message: unknown): ParsedResyncResult {
  if (!message || typeof message !== "object") {
    return { ok: false, reason: "missing_context", retryable: false };
  }

  const candidate = message as Record<string, unknown>;
  if (candidate.type !== "resync"
    || typeof candidate.table_id !== "string"
    || !candidate.table_id.trim()
    || candidate.table_id.length > 256) {
    return { ok: false, reason: "missing_context", retryable: false };
  }

  if (candidate.last_seen_seq !== undefined
    && (!Number.isSafeInteger(candidate.last_seen_seq) || (candidate.last_seen_seq as number) < 0)) {
    return { ok: false, reason: "invalid_sequence", retryable: true };
  }

  return {
    ok: true,
    request: {
      type: "resync",
      table_id: candidate.table_id,
      ...(candidate.last_seen_seq === undefined
        ? {}
        : { last_seen_seq: candidate.last_seen_seq as number }),
    },
  };
}

export function sameAction(a: ProtocolActionMessage, b: ProtocolActionMessage): boolean {
  return a.table_id === b.table_id
    && a.hand_id === b.hand_id
    && a.turn_id === b.turn_id
    && a.turn_token === b.turn_token
    && a.action === b.action
    && a.amount === b.amount
    && a.thought === b.thought
    && a.confidence === b.confidence
    && a.isBluffing === b.isBluffing;
}

export function actionAckFor(action: ProtocolActionMessage): ProtocolActionAck {
  return {
    type: "action_ack",
    protocol_version: 1,
    table_id: action.table_id,
    hand_id: action.hand_id,
    turn_id: action.turn_id,
    client_action_id: action.client_action_id,
    action: action.action,
    amount: action.amount,
  };
}

export function actionRejectedFor(input: ActionRejectionInput): ProtocolActionRejected {
  return {
    type: "action_rejected",
    protocol_version: 1,
    ...(input.context?.tableId ? { table_id: input.context.tableId } : {}),
    ...(input.context?.handId ? { hand_id: input.context.handId } : {}),
    ...(input.context?.turnId ? { turn_id: input.context.turnId } : {}),
    ...(input.clientActionId ? { client_action_id: input.clientActionId } : {}),
    reason: input.reason,
    retryable: input.retryable,
  };
}

export function resyncRejectedFor(input: {
  tableId?: string;
  reason: ProtocolResyncRejectedReason;
  retryable: boolean;
}): {
  type: "resync_rejected";
  protocol_version: 1;
  table_id?: string;
  reason: ProtocolResyncRejectedReason;
  retryable: boolean;
} {
  return {
    type: "resync_rejected",
    protocol_version: 1,
    ...(input.tableId ? { table_id: input.tableId } : {}),
    reason: input.reason,
    retryable: input.retryable,
  };
}

function cardCode(card: { rank: number; suit: string }): string {
  const names: Record<number, string> = {
    2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8",
    9: "9", 10: "10", 11: "J", 12: "Q", 13: "K", 14: "A",
  };
  return `${names[card.rank] ?? String(card.rank)}${card.suit}`;
}

export function snapshotMessageFor(
  state: AgentSnapshotState,
  agentId: string,
  requestedSeq?: number,
  pending?: {
    context: DecisionContext;
    turnToken: string;
    deadlineAt: number;
  },
): ExternalAgentTableSnapshot {
  const isCurrentActor = state.currentPlayerId === agentId
    && !!pending
    && pending.context.tableId === state.tableId
    && pending.deadlineAt > Date.now();

  return {
    type: "table_snapshot",
    protocol_version: 1,
    table_id: state.tableId,
    table_seq: state.tableSeq,
    state_hash: state.stateHash,
    sync_mode: "full",
    ...(requestedSeq === undefined ? {} : { requested_seq: requestedSeq }),
    unchanged: requestedSeq !== undefined && requestedSeq === state.tableSeq,
    status: state.status,
    hand_id: state.handId,
    hand_number: state.handNumber,
    phase: state.phase,
    my_cards: state.myCards.map(cardCode),
    community_cards: state.communityCards.map(cardCode),
    players: state.players.map((player) => ({
      id: player.id,
      name: player.name,
      avatar: player.avatar,
      chips: player.chips,
      bet: player.bet,
      folded: player.folded,
      allIn: player.allIn,
      seat_index: player.seatIndex,
    })),
    pots: state.pots.map((pot) => ({
      amount: pot.amount,
      eligiblePlayerIds: [...pot.eligiblePlayerIds],
    })),
    dealer_seat_index: state.dealerSeatIndex,
    current_player_id: state.currentPlayerId,
    is_current_actor: isCurrentActor,
    current_bet: state.currentBet,
    call_amount: isCurrentActor ? state.callAmount : 0,
    min_raise_to: isCurrentActor ? state.minRaiseTo : null,
    max_raise_to: isCurrentActor ? state.maxRaiseTo : null,
    valid_actions: isCurrentActor ? [...state.validActions] : [],
    action_history: state.actionHistory.map((entry) => ({
      player_id: entry.playerId,
      phase: entry.phase,
      action: { ...entry.action },
    })),
    ...(isCurrentActor && pending ? {
      turn: {
        turn_id: pending.context.turnId,
        turn_token: pending.turnToken,
        deadline_at: pending.deadlineAt,
      },
    } : {}),
  };
}
