/* SERVER ONLY — turns an InstallResult into the NextResponse the two install routes send,
   and makes sure a signed-in merchant has an account before the flow starts. */

import { NextResponse } from "next/server";
import { requireAccountSession } from "@/lib/db/session";
import type { HandlerDeps } from "./handlers";
import { INSTALL_COOKIE, INSTALL_COOKIE_TTL_MS, INSTALL_ERROR_REDIRECT, INSTALL_PATH, type InstallResult } from "./install";

export function installResponse(result: InstallResult, origin: string): NextResponse {
  if (result.status !== 302) return NextResponse.json({ error: result.error }, { status: result.status });
  const res = NextResponse.redirect(new URL(result.location, origin));
  const base = { httpOnly: true, sameSite: "lax" as const, secure: origin.startsWith("https:"), path: INSTALL_PATH };
  if (result.setCookie) res.cookies.set(INSTALL_COOKIE, result.setCookie, { ...base, maxAge: Math.floor(INSTALL_COOKIE_TTL_MS / 1000) });
  else if (result.clearCookie) res.cookies.set(INSTALL_COOKIE, "", { ...base, maxAge: 0 });
  return res;
}

export const installErrorResponse = (origin: string) => NextResponse.redirect(new URL(INSTALL_ERROR_REDIRECT, origin));

/** A merchant who signed in straight from the magic link has no account yet (the client-side
    bootstrap runs on /app, which they haven't reached). Same path the billing routes use:
    accept any beta invite, else create the account, so handleStart finds a membership. */
export async function ensureMerchantAccount(deps: HandlerDeps): Promise<void> {
  if (!deps.userId || !deps.db) return;
  await requireAccountSession({ createAccount: true });
}
