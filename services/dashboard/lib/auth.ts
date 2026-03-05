/**
 * Shared auth constants. Cookie value is HMAC(password, AUTH_MESSAGE) so we never send the password to the client.
 */

export const AUTH_COOKIE_NAME = "ob_auth";
/** Fixed message used when signing the auth cookie so token is deterministic and verifiable. */
export const AUTH_MESSAGE = "open-books-dashboard-auth";

/** When DASHBOARD_PASSWORD is unset (e.g. local dev), this password is accepted so you can test the login flow. Never used in production if env is set. */
export const DEV_FALLBACK_PASSWORD = "dev";
