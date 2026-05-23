import type {
  AgentGameView,
  ActionType,
  SkillConfig,
  WebhookRequest,
  WebhookResponse,
} from "@cybercasino/shared";

const WEBHOOK_TIMEOUT_MS = 15_000;

export interface WebhookCallResult {
  success: boolean;
  response?: WebhookResponse;
  error?: string;
}

export async function callWebhook(
  url: string,
  view: AgentGameView,
  validActions: ActionType[],
  callAmount: number,
  minRaise: number,
  stylePrompt: string,
  skill?: SkillConfig,
  strategyHint?: WebhookRequest["strategyHint"],
): Promise<WebhookCallResult> {
  const payload: WebhookRequest = {
    type: "decision",
    gameView: view,
    validActions,
    callAmount,
    minRaise,
    stylePrompt,
    skill,
    strategyHint,
  };

  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Webhook timeout (${WEBHOOK_TIMEOUT_MS}ms)`)), WEBHOOK_TIMEOUT_MS)
    );

    const response = await Promise.race([
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
      timeoutPromise,
    ]);

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const data: WebhookResponse = await response.json();

    if (!data.action || !validActions.includes(data.action)) {
      return { success: false, error: `Invalid action: ${data.action}` };
    }

    return { success: true, response: data };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
