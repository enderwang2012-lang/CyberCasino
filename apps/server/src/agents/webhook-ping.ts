import type { WebhookPingResult } from "@cybercasino/shared";

export async function pingWebhook(url: string): Promise<WebhookPingResult> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "ping", timestamp: Date.now() }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}` };
    }

    const body = await res.json();
    if (body.status !== "ok") {
      return { success: false, error: `Unexpected response: ${JSON.stringify(body)}` };
    }

    return { success: true, latencyMs: Date.now() - start };
  } catch (err: any) {
    if (err.name === "AbortError") {
      return { success: false, error: "Timeout (10s)" };
    }
    return { success: false, error: err.message ?? String(err) };
  }
}
