import OpenAI from "openai";

let client: OpenAI | null = null;

export function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.LLM_API_KEY,
      baseURL: process.env.LLM_BASE_URL || "https://api.deepseek.com",
    });
  }
  return client;
}

export function getModel(): string {
  return process.env.LLM_MODEL || "deepseek-chat";
}
