import { expect, it } from "bun:test";
import { getClient } from "../llm-client";

it.each([undefined, "", "   "])("rejects unconfigured LLM credentials (%j)", (apiKey) => {
  const previous = process.env.LLM_API_KEY;
  try {
    if (apiKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = apiKey;

    expect(() => { getClient(); }).toThrow("LLM_API_KEY is not configured");
  } finally {
    if (previous === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = previous;
  }
});
