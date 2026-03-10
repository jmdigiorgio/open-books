/**
 * Tool schemas sent to OpenRouter so the LLM can call our DB read/write functions.
 *
 * Each entry follows the OpenAI/OpenRouter tool-calling format:
 *   { type: "function", function: { name, description, parameters } }
 *
 * parameters uses standard JSON Schema.
 */

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/* ------------------------------------------------------------------ */
/*  READ tools                                                         */
/* ------------------------------------------------------------------ */

const readIncome: ToolDefinition = {
  type: "function",
  function: {
    name: "read_income",
    description:
      "Read recent income rows from the database. Use to check how similar transactions were classified before.",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max rows to return (default 20, max 100).",
        },
      },
      required: [],
    },
  },
};

const readExpenses: ToolDefinition = {
  type: "function",
  function: {
    name: "read_expenses",
    description:
      "Read recent expense rows from the database. Use to check how similar transactions were classified before.",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max rows to return (default 20, max 100).",
        },
      },
      required: [],
    },
  },
};

const readUncategorized: ToolDefinition = {
  type: "function",
  function: {
    name: "read_uncategorized",
    description:
      "Read recent uncategorized rows from the database. Use to see which transactions are still unresolved.",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max rows to return (default 20, max 100).",
        },
      },
      required: [],
    },
  },
};

/* ------------------------------------------------------------------ */
/*  WRITE tools                                                        */
/* ------------------------------------------------------------------ */

const insertIncome: ToolDefinition = {
  type: "function",
  function: {
    name: "insert_income",
    description:
      "Classify a transaction as INCOME by inserting a row into the income table.",
    parameters: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Date of the income (YYYY-MM-DD).",
        },
        name: {
          type: "string",
          description: "Payer or source name (e.g. 'Lyft', 'Acme Corp').",
        },
        description: {
          type: "string",
          description:
            "Short IRS-compliant description (e.g. 'Rideshare driver income').",
        },
        amount: {
          type: "number",
          description: "Amount (use the exact value from the transaction).",
        },
        proof: {
          type: "string",
          description: "The transaction_id that this income came from.",
        },
      },
      required: ["date", "name", "description", "amount", "proof"],
    },
  },
};

const insertExpense: ToolDefinition = {
  type: "function",
  function: {
    name: "insert_expense",
    description:
      "Classify a transaction as an EXPENSE (business expense) by inserting a row into the expenses table.",
    parameters: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Date the expense was incurred (YYYY-MM-DD).",
        },
        name: {
          type: "string",
          description:
            "Payee name (e.g. 'TradingView', 'Chevron'). Clean up formatting.",
        },
        description: {
          type: "string",
          description:
            "Short IRS-compliant description of the business purpose.",
        },
        amount: {
          type: "number",
          description: "Amount (use the exact value from the transaction).",
        },
        proof: {
          type: "string",
          description: "The transaction_id that this expense came from.",
        },
      },
      required: ["date", "name", "description", "amount", "proof"],
    },
  },
};

const insertUncategorized: ToolDefinition = {
  type: "function",
  function: {
    name: "insert_uncategorized",
    description:
      "Mark a transaction as UNCATEGORIZED when you cannot confidently classify it as income or expense.",
    parameters: {
      type: "object",
      properties: {
        transaction_id: {
          type: "string",
          description: "The transaction_id.",
        },
        date: {
          type: "string",
          description: "Date of the transaction (YYYY-MM-DD).",
        },
        description: {
          type: "string",
          description: "Description of the transaction.",
        },
        amount: {
          type: "number",
          description: "Amount of the transaction.",
        },
        reason: {
          type: "string",
          description:
            "Brief explanation of why this could not be classified.",
        },
      },
      required: ["transaction_id", "date", "description", "amount", "reason"],
    },
  },
};

/** All tool definitions to register with OpenRouter. */
export const ALL_TOOLS: ToolDefinition[] = [
  readIncome,
  readExpenses,
  readUncategorized,
  insertIncome,
  insertExpense,
  insertUncategorized,
];
