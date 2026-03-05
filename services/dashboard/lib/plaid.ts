/**
 * Plaid API client for server-side use (link token, exchange).
 * Uses PLAID_CLIENT_ID, PLAID_SECRET; basePath set from PLAID_ENV (default sandbox).
 */

import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products,
  type LinkTokenCreateRequest,
  type ItemPublicTokenExchangeRequest,
} from "plaid";

function getBasePath(): string {
  const env = process.env.PLAID_ENV ?? "sandbox";
  // Development uses real banks with Development secret; same host as production.
  if (env === "development") return PlaidEnvironments.production;
  return PlaidEnvironments[env] ?? PlaidEnvironments.sandbox;
}

/**
 * Builds a configured Plaid API client. Call from API routes only (uses env).
 */
export function getPlaidClient(): PlaidApi {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) {
    throw new Error("PLAID_CLIENT_ID and PLAID_SECRET must be set");
  }
  const config = new Configuration({
    username: clientId,
    password: secret,
    basePath: getBasePath(),
  });
  return new PlaidApi(config);
}

/**
 * Creates a link_token for initializing Plaid Link on the frontend.
 * Sends client_id and secret in the request body so Plaid receives them (env: PLAID_CLIENT_ID, PLAID_SECRET).
 */
export async function createLinkToken(): Promise<string> {
  const client = getPlaidClient();
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  const request: LinkTokenCreateRequest = {
    client_id: clientId ?? undefined,
    secret: secret ?? undefined,
    client_name: "OpenBooks",
    language: "en",
    country_codes: [CountryCode.Us],
    user: { client_user_id: "openbooks-single-user" },
    products: [Products.Transactions],
  };
  const res = await client.linkTokenCreate(request);
  const linkToken = res.data.link_token;
  if (!linkToken) throw new Error("No link_token in response");
  return linkToken;
}

/**
 * Exchanges a public_token from Link onSuccess for access_token and item_id.
 * Sends client_id and secret in the request body (same reason as linkTokenCreate).
 */
export async function exchangePublicToken(
  publicToken: string
): Promise<{ accessToken: string; itemId: string }> {
  const client = getPlaidClient();
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  const request: ItemPublicTokenExchangeRequest = {
    client_id: clientId ?? undefined,
    secret: secret ?? undefined,
    public_token: publicToken,
  };
  const res = await client.itemPublicTokenExchange(request);
  return {
    accessToken: res.data.access_token,
    itemId: res.data.item_id,
  };
}
