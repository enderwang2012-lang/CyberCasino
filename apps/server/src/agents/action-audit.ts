import type {
  Action,
  ActionType,
  AgentActionAudit,
  AgentDecision,
  AgentGameView,
} from "@cybercasino/shared";

export interface AuditRuntimeContext {
  tableMode: AgentActionAudit["tableMode"];
  executionMode: AgentActionAudit["executionMode"];
  runtime: AgentActionAudit["runtime"];
}

function fallbackAction(validActions: ActionType[]): Action {
  if (validActions.includes("check")) return { type: "check" };
  return { type: "fold" };
}

export function validateAction(
  proposed: Action,
  view: AgentGameView,
  validActions: ActionType[],
  minRaise: number,
): { action: Action; corrections: string[] } {
  const corrections: string[] = [];

  if (!validActions.includes(proposed.type)) {
    corrections.push(`illegal_action:${proposed.type}`);
    return { action: fallbackAction(validActions), corrections };
  }

  if (proposed.type !== "raise") {
    return { action: { type: proposed.type }, corrections };
  }

  const maxTotalBet = view.myBet + view.myChips;
  const minTotalBet = view.currentBet + minRaise;
  let amount = proposed.amount;
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    corrections.push("missing_or_invalid_raise_amount");
    amount = minTotalBet;
  }
  if (amount < minTotalBet && maxTotalBet >= minTotalBet) {
    corrections.push("raise_below_minimum");
    amount = minTotalBet;
  }
  if (amount > maxTotalBet) {
    corrections.push("raise_above_stack");
    amount = maxTotalBet;
  }

  // A short stack may legally move all-in for less than a full minimum raise.
  if (maxTotalBet < minTotalBet) amount = maxTotalBet;
  return { action: { type: "raise", amount: Math.round(amount) }, corrections };
}

export function auditDecision(
  decision: AgentDecision,
  view: AgentGameView,
  validActions: ActionType[],
  minRaise: number,
  context: AuditRuntimeContext,
): AgentDecision {
  const proposedAction = decision.action;
  const validated = validateAction(proposedAction, view, validActions, minRaise);
  const existing = decision.audit;
  const audit: AgentActionAudit = {
    ...existing,
    agentId: view.myId,
    handNumber: view.handNumber,
    street: view.phase === "showdown" ? "river" : view.phase,
    tableMode: context.tableMode,
    executionMode: context.executionMode,
    runtime: context.runtime,
    stateScope: "visible_information_only",
    validActions: [...validActions],
    proposedAction,
    executedAction: validated.action,
    validation: {
      accepted: validated.corrections.length === 0,
      corrections: validated.corrections,
    },
    decidedAt: existing?.decidedAt ?? Date.now(),
  };

  return { ...decision, action: validated.action, audit };
}
