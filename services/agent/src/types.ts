/**
 * Shared TypeScript types for the agent service.
 */

/** A transaction that has not yet been classified by the agent. */
export interface UnclassifiedTransaction {
  transaction_id: string;
  date: string;       // YYYY-MM-DD
  description: string; // derived: COALESCE(merchant_name, name, original_description, '')
  amount: number;
}

/** The classification decision the agent made for a single transaction. */
export type Decision = "income" | "deduction" | "uncategorized";

/** Counters returned after a full agent run. */
export interface RunResult {
  /** How many transactions the agent attempted to classify. */
  processed: number;
  /** How many were classified as income. */
  income: number;
  /** How many were classified as deductions. */
  deductions: number;
  /** How many remained uncategorized after both passes. */
  uncategorized: number;
  /** How many transactions hit an error during classification. */
  errors: number;
  /** Details for each error (transaction_id + message). */
  errorDetails: Array<{ transaction_id: string; error: string }>;
  /** The id of the agent_runs row created for this run. */
  runId: number;
}

/** Shape of an OpenRouter chat message. */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

/** Shape of a tool_call from the OpenRouter response. */
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

/** OpenRouter chat completion response (subset of fields we use). */
export interface ChatCompletionResponse {
  id: string;
  choices: Array<{
    message: {
      role: "assistant";
      content?: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: string;
  }>;
}
