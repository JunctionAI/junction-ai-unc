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

/** Accept a matching beta invite before the install handler resolves account membership.
    Uninvited identities never receive a new account. */
export async function ensureMerchantAccount(deps: HandlerDeps): Promise<void> {
  if (!deps.userId || !deps.db) return;
  const session = await requireAccountSession();
  if (session instanceof Response && session.status >= 400) throw new Error("private beta account required");
}
