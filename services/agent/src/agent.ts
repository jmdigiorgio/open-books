/**
 * Core agent loop: send a conversation to OpenRouter with tool definitions,
 * dispatch any tool_calls the model makes, feed results back, and repeat
 * until the model stops calling tools.
 *
 * This module is model-agnostic — the caller chooses which model slug to use
 * (with or without :online suffix) and passes it in.
 */

import type {
  ChatMessage,
  ChatCompletionResponse,
  ToolCall,
} from "./types.js";
import { ALL_TOOLS } from "./tools/definitions.js";
import { readIncome, readExpenses, readUncategorized } from "./tools/db-read.js";
import {
  insertIncome,
  insertExpense,
  insertUncategorized,
  type InsertIncomeArgs,
  type InsertExpenseArgs,
  type InsertUncategorizedArgs,
} from "./tools/db-write.js";

/** Max iterations of the tool-call loop to prevent runaway conversations. */
const MAX_ITERATIONS = 10;

/** Env-driven delay between OpenRouter requests (rate-limit protection). */
function getRequestDelay(): number {
  return Number(process.env.REQUEST_DELAY_MS) || 500;
}

/** Simple async sleep helper. */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/* ------------------------------------------------------------------ */
/*  Tool dispatcher                                                    */
/* ------------------------------------------------------------------ */

/**
 * Route a tool_call from the model to the actual function, return the
 * stringified result (or an error message the model can read).
 */
async function dispatchTool(call: ToolCall): Promise<string> {
  const { name, arguments: rawArgs } = call.function;
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(rawArgs);
  } catch {
    return JSON.stringify({ error: `Invalid JSON arguments for ${name}` });
  }

  switch (name) {
    case "read_income":
      return readIncome(args as { limit?: number });
    case "read_expenses":
      return readExpenses(args as { limit?: number });
    case "read_uncategorized":
      return readUncategorized(args as { limit?: number });
    case "insert_income":
      return insertIncome(args as unknown as InsertIncomeArgs);
    case "insert_expense":
      return insertExpense(args as unknown as InsertExpenseArgs);
    case "insert_uncategorized":
      return insertUncategorized(args as unknown as InsertUncategorizedArgs);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

/* ------------------------------------------------------------------ */
/*  OpenRouter HTTP call                                               */
/* ------------------------------------------------------------------ */

/**
 * Call OpenRouter's chat completions endpoint once.
 * Handles 429 (rate limit) with exponential backoff (up to 3 retries).
 */
async function callOpenRouter(
  model: string,
  messages: ChatMessage[]
): Promise<ChatCompletionResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  const body = {
    model,
    messages,
    tools: ALL_TOOLS,
    /* Tell the model it may call tools but doesn't have to. */
    tool_choice: "auto",
  };

  let lastError: Error | null = null;

  /* Retry loop for 429s — 3 attempts with exponential backoff. */
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      /* Exponential backoff: 1s, 2s, 4s. */
      const backoff = 1000 * Math.pow(2, attempt - 1);
      console.log(`[agent] 429 backoff: waiting ${backoff}ms (attempt ${attempt + 1}/3)`);
      await sleep(backoff);
    }

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429) {
      lastError = new Error(`OpenRouter 429 rate limited (attempt ${attempt + 1})`);
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenRouter ${res.status}: ${text}`);
    }

    return (await res.json()) as ChatCompletionResponse;
  }

  /* All retries exhausted. */
  throw lastError ?? new Error("OpenRouter request failed after retries");
}

/* ------------------------------------------------------------------ */
/*  Agent loop                                                         */
/* ------------------------------------------------------------------ */

/**
 * Run the agent for a single transaction.
 *
 * @param model   - OpenRouter model slug (e.g. "openai/gpt-4o" or "openai/gpt-4o:online")
 * @param systemMsg - The full system message (prompt + rules)
 * @param userMsg   - The user message describing the transaction to classify
 *
 * Returns the final assistant text (for logging) or null.
 */
export async function runAgentLoop(
  model: string,
  systemMsg: string,
  userMsg: string
): Promise<string | null> {
  /** Running conversation. */
  const messages: ChatMessage[] = [
    { role: "system", content: systemMsg },
    { role: "user", content: userMsg },
  ];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await callOpenRouter(model, messages);
    const choice = response.choices[0];
    if (!choice) throw new Error("OpenRouter returned empty choices");

    const assistantMsg = choice.message;

    /* Add the assistant's response to the conversation history. */
    messages.push(assistantMsg as ChatMessage);

    /* If there are no tool calls, the model is done. */
    if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
      return assistantMsg.content ?? null;
    }

    /* Dispatch every tool call and send results back. */
    for (const tc of assistantMsg.tool_calls) {
      const result = await dispatchTool(tc);
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: result,
      });
    }

    /* Courtesy delay before next OpenRouter request. */
    await sleep(getRequestDelay());
  }

  console.warn("[agent] Hit MAX_ITERATIONS without model finishing");
  return null;
}
