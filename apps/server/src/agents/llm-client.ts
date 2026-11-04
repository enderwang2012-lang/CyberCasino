import OpenAI from "openai";

let client: OpenAI | null = null;

export function getClient(): OpenAI {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey?.trim()) throw new Error("LLM_API_KEY is not configured");
  if (!client) {
    client = new OpenAI({
      apiKey,
      baseURL: process.env.LLM_BASE_URL || "https://api.deepseek.com",
    });
  }
  return client;
}

export function getModel(): string {
  return process.env.LLM_MODEL || "deepseek-chat";
}
