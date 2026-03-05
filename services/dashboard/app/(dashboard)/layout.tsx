import { createHmac } from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  AUTH_COOKIE_NAME,
  AUTH_MESSAGE,
  DEV_FALLBACK_PASSWORD,
} from "@/lib/auth";

/**
 * Protects all routes under (dashboard) (including /). Runs in Node so
 * process.env.DASHBOARD_PASSWORD is read at request time.
 * When DASHBOARD_PASSWORD is unset, uses DEV_FALLBACK_PASSWORD so local login flow is testable.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const password =
    process.env.DASHBOARD_PASSWORD ?? DEV_FALLBACK_PASSWORD;

  const cookieStore = await cookies();
  const cookieToken = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  const expectedToken = createHmac("sha256", password)
    .update(AUTH_MESSAGE)
    .digest("hex");

  if (!cookieToken || cookieToken !== expectedToken) {
    redirect("/login");
  }

  return <>{children}</>;
}
